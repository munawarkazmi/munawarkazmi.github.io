/* The detection firmware, in the browser.
 *
 * A port of src/frame_downsampler.cpp and src/motion_detector.cpp from
 * esp32-cam-motion-detector: an 800x600 grayscale frame collapses into
 * 16x12 block means by integer division, and the detector counts cells
 * whose frame-to-frame relative change exceeds the threshold, in float32 as
 * on the device. The first frame never detects; two changed cells or more
 * is motion. The page feeds it the visitor's camera, or a synthetic scene
 * when there is none; the frames never leave the browser.
 *
 * tools/test_esp32_lab.js checks the port against hand-computed cases and
 * an independent reference over random frames.
 */
(function () {
  'use strict';
  var DST_W = 16, DST_H = 12, MIN_CHANGED = 2;

  function FrameDownsampler(srcW, srcH) {
    this.srcW = srcW; this.srcH = srcH;
    this.blockW = Math.floor(srcW / DST_W); this.blockH = Math.floor(srcH / DST_H);
  }
  FrameDownsampler.prototype.downsample = function (src, dst) {
    var W = this.srcW, bw = this.blockW, bh = this.blockH, area = bw * bh;
    for (var y = 0; y < DST_H; y++) for (var x = 0; x < DST_W; x++) {
      var sum = 0, startY = y * bh, startX = x * bw;
      for (var dy = 0; dy < bh; dy++) { var row = (startY + dy) * W + startX; for (var dx = 0; dx < bw; dx++) sum += src[row + dx]; }
      dst[y * DST_W + x] = Math.floor(sum / area);
    }
    return dst;
  };

  function MotionDetector(threshold) {
    this.threshold = Math.fround(threshold === undefined ? 0.40 : threshold);
    this.previous = new Uint16Array(DST_W * DST_H);
    this.firstFrame = true;
    this.changed = new Uint8Array(DST_W * DST_H); /* which cells counted, for the picture */
    this.changes = 0;
  }
  MotionDetector.prototype.init = function () { this.previous.fill(0); this.firstFrame = true; this.changed.fill(0); this.changes = 0; };
  MotionDetector.prototype.detect = function (frame) {
    if (this.firstFrame) { this.previous.set(frame); this.firstFrame = false; this.changed.fill(0); this.changes = 0; return false; }
    var changes = 0;
    for (var i = 0; i < DST_W * DST_H; i++) {
      var prev = this.previous[i], diff = Math.abs(frame[i] - prev);
      var relative = Math.fround(diff / (prev > 1 ? prev : 1));
      this.changed[i] = relative > this.threshold ? 1 : 0;
      if (this.changed[i]) changes++;
    }
    this.previous.set(frame); this.changes = changes;
    return changes >= MIN_CHANGED;
  };

  /* the camera gives the device a grayscale frame; a webcam gives RGB, so
     the page takes Rec. 601 luma, rounded to the nearest integer */
  function luma(rgba, out) { for (var i = 0, j = 0; j < out.length; i += 4, j++) out[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]); return out; }

  var api = { FrameDownsampler: FrameDownsampler, MotionDetector: MotionDetector, luma: luma, DST_W: DST_W, DST_H: DST_H, MIN_CHANGED: MIN_CHANGED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Esp32Lab = api;

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */
  if (typeof document === 'undefined') return;

  function boot() {
    var fig = document.getElementById('esp32Lab'); if (!fig) return;
    var $ = function (id) { return document.getElementById(id); };
    var stage = $('el-stage'), canvas = $('el-canvas'), ctx = canvas.getContext('2d'), video = $('el-video'), thumb = $('el-thumb'), tctx = thumb.getContext('2d');
    var el = { cam: $('el-cam'), synth: $('el-synth'), thr: $('el-thr'), thrOut: $('el-thr-out'), decision: $('el-decision'), decisionText: $('el-decision-text'), cells: $('el-cells'), rate: $('el-rate'), frames: $('el-frames'), hint: $('el-hint'), said: $('el-said') };
    fig.hidden = false;
    var SRC_W = 800, SRC_H = 600, LOOP_DELAY = 150; /* delay(150) at the end of loop() */
    var src = document.createElement('canvas'); src.width = SRC_W; src.height = SRC_H; var sctx = src.getContext('2d', { willReadFrequently: true });
    var gray = new Uint8Array(SRC_W * SRC_H), cells = new Uint16Array(DST_W * DST_H);
    var down = new FrameDownsampler(SRC_W, SRC_H), det = new MotionDetector(0.40);
    var colour = {}, dpr = 1, mode = 'synth', stream = null, frames = 0, lastTick = 0, rateT = 0, rateN = 0, rate = 0, timer = null, lastSaid = '';

    function readColours() {
      var cs = getComputedStyle(fig), names = ['panel', 'bg', 'line', 'ink', 'accent', 'warn', 'muted', 'ok'];
      for (var i = 0; i < names.length; i++) colour[names[i]] = cs.getPropertyValue('--' + names[i]).trim() || '#888';
    }
    function size() {
      var w = stage.clientWidth; if (!w) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = w + 'px'; canvas.style.height = Math.round(w * 0.75) + 'px';
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * 0.75 * dpr);
      render(false);
    }

    /* a synthetic scene for pages without a camera: a lit room, a figure
       that walks across it and stops now and then, and sensor noise */
    var synth = { t: 0, seed: 7 };
    function rnd() { synth.seed = (synth.seed * 1103515245 + 12345) & 0x7fffffff; return synth.seed / 0x7fffffff; }
    function drawSynth(dt) {
      synth.t += dt;
      var phase = synth.t % 9, moving = phase < 6, x = moving ? 100 + (phase / 6) * 600 : 700;
      var g = sctx.createLinearGradient(0, 0, 0, SRC_H); g.addColorStop(0, '#9a9a9a'); g.addColorStop(1, '#3c3c3c');
      sctx.fillStyle = g; sctx.fillRect(0, 0, SRC_W, SRC_H);
      sctx.fillStyle = '#5b5b5b'; sctx.fillRect(0, 420, SRC_W, 180);
      sctx.fillStyle = '#d8d8d8'; sctx.fillRect(560, 120, 140, 110);
      sctx.fillStyle = '#1e1e1e'; sctx.fillRect(x - 28, 250, 56, 200); sctx.beginPath(); sctx.arc(x, 225, 30, 0, 6.2832); sctx.fill();
      var img = sctx.getImageData(0, 0, SRC_W, SRC_H), d = img.data;
      for (var i = 0; i < d.length; i += 4 * 97) { var n = (rnd() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      sctx.putImageData(img, 0, 0);
      return moving;
    }
    function grab() {
      if (mode === 'cam') {
        if (!video.videoWidth) return false;
        var vw = video.videoWidth, vh = video.videoHeight, s = Math.max(SRC_W / vw, SRC_H / vh), dw = vw * s, dh = vh * s;
        sctx.drawImage(video, (SRC_W - dw) / 2, (SRC_H - dh) / 2, dw, dh);
      } else drawSynth(LOOP_DELAY / 1000);
      luma(sctx.getImageData(0, 0, SRC_W, SRC_H).data, gray);
      return true;
    }
    function tick() {
      timer = null;
      var t0 = performance.now();
      if (grab()) {
        down.downsample(gray, cells);
        var motion = det.detect(cells); frames++;
        rateN++; if (t0 - rateT >= 1000) { rate = rateN * 1000 / (t0 - rateT); rateN = 0; rateT = t0; }
        render(motion);
      }
      timer = setTimeout(tick, LOOP_DELAY);
    }
    function render(motion) {
      var W = canvas.width, H = canvas.height, cw = W / DST_W, ch = H / DST_H;
      ctx.fillStyle = colour.panel; ctx.fillRect(0, 0, W, H);
      for (var y = 0; y < DST_H; y++) for (var x = 0; x < DST_W; x++) {
        var v = cells[y * DST_W + x];
        ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; ctx.fillRect(x * cw, y * ch, cw, ch);
      }
      ctx.strokeStyle = colour.line; ctx.lineWidth = dpr; ctx.beginPath();
      for (var i = 1; i < DST_W; i++) { ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, H); }
      for (var j = 1; j < DST_H; j++) { ctx.moveTo(0, j * ch); ctx.lineTo(W, j * ch); }
      ctx.stroke();
      ctx.strokeStyle = colour.warn; ctx.lineWidth = 3 * dpr;
      for (var k = 0; k < det.changed.length; k++) if (det.changed[k]) ctx.strokeRect((k % DST_W) * cw + 1.5 * dpr, Math.floor(k / DST_W) * ch + 1.5 * dpr, cw - 3 * dpr, ch - 3 * dpr);
      ctx.font = (11 * dpr) + 'px ' + (getComputedStyle(fig).getPropertyValue('--mono') || 'monospace'); ctx.fillStyle = colour.ink; ctx.textBaseline = 'top';
      for (var y2 = 0; y2 < DST_H; y2++) for (var x2 = 0; x2 < DST_W; x2++) { var val = cells[y2 * DST_W + x2]; ctx.fillStyle = val > 128 ? '#111' : '#eee'; ctx.fillText(String(val), x2 * cw + 3 * dpr, y2 * ch + 3 * dpr); }
      /* the source, small, so the grid can be read against it */
      tctx.drawImage(src, 0, 0, thumb.width, thumb.height);
      var first = frames <= 1, word = first ? 'First frame' : (motion ? 'Motion' : 'Still');
      el.decision.textContent = word;
      el.decisionText.textContent = first ? 'The first frame only sets the reference; the device never alerts on it.' : (motion ? det.changes + ' cells changed by more than ' + Math.round(det.threshold * 100) + '% against the previous frame, at least ' + MIN_CHANGED + ' needed. The device would raise its alert line now.' : (det.changes === 1 ? 'One cell changed, and one is not enough: a single flickering cell is noise, not motion.' : 'No cell changed by more than ' + Math.round(det.threshold * 100) + '% against the previous frame.'));
      fig.className = fig.className.replace(/\bis-(safe|unsafe)\b/g, '').trim() + (motion ? ' is-unsafe' : ' is-safe');
      el.cells.textContent = det.changes + ' of ' + DST_W * DST_H;
      el.rate.textContent = rate ? rate.toFixed(1) + ' per second' : 'measuring';
      el.frames.textContent = String(frames);
      if (word !== lastSaid) { lastSaid = word; el.said.textContent = word + '. ' + el.decisionText.textContent; }
    }
    function restart() { det.init(); frames = 0; rate = 0; rateN = 0; rateT = performance.now(); lastSaid = ''; }
    function stopCam() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } video.srcObject = null; video.hidden = true; }
    function useSynth(why) {
      stopCam(); mode = 'synth'; el.cam.setAttribute('aria-pressed', 'false'); el.synth.setAttribute('aria-pressed', 'true'); restart();
      el.hint.textContent = (why ? why + ' ' : '') + 'Synthetic scene: a figure crosses a room, stops for three seconds, and crosses again. The detector sees nothing but the 192 block means.';
    }
    function useCam() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { useSynth('This browser offers no camera.'); return; }
      el.hint.textContent = 'Asking the browser for the camera. The frames are processed here and never leave this page.';
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: SRC_W }, height: { ideal: SRC_H }, facingMode: 'environment' }, audio: false }).then(function (s) {
        stream = s; video.srcObject = s; video.hidden = false; mode = 'cam'; el.cam.setAttribute('aria-pressed', 'true'); el.synth.setAttribute('aria-pressed', 'false'); restart();
        el.hint.textContent = 'Your camera, read as 800x600 grayscale and collapsed to 16x12 block means, exactly as the firmware does it. Hold still, then wave: the outlined cells are the ones that counted. Nothing is recorded or sent.';
        return video.play();
      }).catch(function (e) { useSynth(e && e.name === 'NotAllowedError' ? 'Camera permission was declined, which is fine.' : 'No camera could be opened.'); });
    }
    el.cam.addEventListener('click', function () { if (mode !== 'cam') useCam(); });
    el.synth.addEventListener('click', function () { if (mode !== 'synth') useSynth(''); });
    el.thr.addEventListener('input', function () { det.threshold = Math.fround(+this.value); el.thrOut.textContent = (+this.value).toFixed(2); });
    el.thrOut.textContent = '0.40';
    document.addEventListener('visibilitychange', function () { if (document.hidden) { if (timer) clearTimeout(timer); timer = null; } else if (!timer) tick(); });
    window.addEventListener('pagehide', stopCam);
    readColours();
    if (window.MutationObserver) new MutationObserver(function () { readColours(); render(false); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.ResizeObserver) new ResizeObserver(function () { size(); }).observe(stage); else window.addEventListener('resize', size);
    thumb.width = 160; thumb.height = 120;
    useSynth(''); size(); tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
