#!/usr/bin/env node
/* Checks the motion pipeline that runs on the ESP32-CAM page.
 *
 *   node tools/test_esp32_lab.js
 *
 * assets/esp32-lab.js ports frame_downsampler.cpp and motion_detector.cpp
 * from esp32-cam-motion-detector. The firmware has no committed frames, so
 * this checks the port against hand-computed frames (flat, gradient, one
 * cell changed, two cells changed, the threshold boundary, the first-frame
 * rule, the prev <= 1 guard) and against an independent plain reference
 * over random frames. Exits 1 on any failure.
 */
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'assets', 'esp32-lab.js'));
const W = 800, H = 600, N = L.DST_W * L.DST_H;
let fails = 0, n = 0;
const ok = (cond, what) => { n++; if (!cond) { fails++; console.log('FAIL ' + what); } };

/* independent reference, written from the C++ without looking at the port */
function refDown(src) {
  const out = new Array(N), bw = Math.trunc(W / 16), bh = Math.trunc(H / 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
    let sum = 0;
    for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) sum += src[(y * bh + dy) * W + x * bw + dx];
    out[y * 16 + x] = Math.trunc(sum / (bw * bh));
  }
  return out;
}
function refDetector(threshold) {
  let prev = null;
  return (frame) => {
    if (prev === null) { prev = frame.slice(); return false; }
    let changes = 0;
    for (let i = 0; i < N; i++) { const p = prev[i], d = Math.abs(frame[i] - p); if (Math.fround(d / Math.max(p, 1)) > Math.fround(threshold)) changes++; }
    prev = frame.slice(); return changes >= 2;
  };
}
const flat = (v) => new Uint8Array(W * H).fill(v);
const down = new L.FrameDownsampler(W, H), cells = new Uint16Array(N);
ok(down.blockW === 50 && down.blockH === 50, 'block size 50x50 for 800x600');

/* block means */
down.downsample(flat(200), cells); ok(cells.every((v) => v === 200), 'flat frame gives flat means');
const grad = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) grad[i] = (i % W) * 255 / (W - 1) | 0;
down.downsample(grad, cells); const rg = refDown(grad); ok(cells.every((v, i) => v === rg[i]), 'gradient means match the reference');
ok(cells[0] < cells[15] && cells[0] === cells[16], 'gradient means increase left to right and repeat down the rows');
const tr = flat(0); tr[0] = 255; down.downsample(tr, cells); ok(cells[0] === 0, 'one bright pixel in 2500 truncates to 0 (255/2500), integer division as in the C++');
const tr2 = flat(0); for (let i = 0; i < 2499; i++) tr2[Math.floor(i / 50) * W + (i % 50)] = 255; down.downsample(tr2, cells); ok(cells[0] === 254, '2499 bright pixels of 2500 truncate to 254');

/* the detector, hand-computed */
let det = new L.MotionDetector(0.40);
const f = (v) => new Uint16Array(N).fill(v);
ok(det.detect(f(100)) === false, 'the first frame never detects');
ok(det.detect(f(100)) === false, 'an identical frame is still');
let g = f(100); g[5] = 160; ok(det.detect(g) === false && det.changes === 1, 'one cell changed by 60% is one change, not motion');
g = f(100); g[5] = 90; g[9] = 30; ok(det.detect(g) === true && det.changes === 2, 'two cells changed against the previous frame (cell 5 from 160 down to 90, cell 9 down to 30) is motion');
det = new L.MotionDetector(0.40); det.detect(f(100));
g = f(100); g[0] = 140; g[1] = 140; ok(det.detect(g) === false, 'a change of exactly 40% is not more than the threshold');
det = new L.MotionDetector(0.40); det.detect(f(100));
g = f(100); g[0] = 141; g[1] = 141; ok(det.detect(g) === true, 'a change of 41% is');
det = new L.MotionDetector(0.40); det.detect(f(0));
g = f(0); g[0] = 1; g[1] = 1; ok(det.detect(g) === true, 'from 0 the divisor is clamped to 1, so a change of 1 counts');
det = new L.MotionDetector(0.40); det.detect(f(1));
g = f(1); g[0] = 1; g[1] = 1; ok(det.detect(g) === false, 'and no change from 1 is no change');
det = new L.MotionDetector(0.40); det.detect(f(250)); det.detect(f(250)); g = f(250); g[3] = 100; g[4] = 100; ok(det.detect(g) === true, 'a drop counts the same as a rise');
ok(det.detect(f(250)) === true, 'and the reference is always the previous frame, so going back counts too');
det = new L.MotionDetector(0.40); det.detect(f(100)); det.init(); ok(det.detect(f(10)) === false, 'init() makes the next frame a first frame again');
det = new L.MotionDetector(0.40); det.detect(f(100)); g = f(100); g[0] = 135; g[1] = 135; ok(det.detect(g) === false, '35% is under the default threshold');
det = new L.MotionDetector(0.30); det.detect(f(100)); g = f(100); g[0] = 135; g[1] = 135; ok(det.detect(g) === true, 'and over a 0.30 one');

/* random frames against the reference */
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (const thr of [0.40, 0.25, 0.60]) {
  det = new L.MotionDetector(thr); const ref = refDetector(thr); let agree = 0, motion = 0, T = 300;
  let cur = new Uint16Array(N); for (let i = 0; i < N; i++) cur[i] = Math.floor(rnd() * 256);
  for (let t = 0; t < T; t++) {
    const next = cur.slice(); const k = Math.floor(rnd() * 6); for (let j = 0; j < k; j++) next[Math.floor(rnd() * N)] = Math.floor(rnd() * 256);
    for (let i = 0; i < N; i++) if (rnd() < 0.02) next[i] = Math.max(0, Math.min(255, next[i] + Math.floor(rnd() * 21) - 10));
    const a = det.detect(next), b = ref(next); if (a === b) agree++; if (a) motion++; cur = next;
  }
  ok(agree === T, 'random frames at threshold ' + thr + ': ' + agree + ' of ' + T + ' decisions agree with the reference (' + motion + ' motion)');
}
/* the whole pipeline on image-sized frames */
det = new L.MotionDetector(0.40); const scene = flat(90);
down.downsample(scene, cells); det.detect(cells);
for (let y = 100; y < 300; y++) for (let x = 100; x < 160; x++) scene[y * W + x] = 20; /* a dark figure over cells (2,2),(3,2),(2,3)... */
down.downsample(scene, cells); ok(det.detect(cells) === true && det.changes >= 2, 'a 60x200 dark figure on an 800x600 frame is motion');
down.downsample(scene, cells); ok(det.detect(cells) === false, 'and the same frame again is still');
const lit = flat(90); det = new L.MotionDetector(0.40); down.downsample(lit, cells); det.detect(cells);
lit.fill(100); down.downsample(lit, cells); ok(det.detect(cells) === false && det.changes === 0, 'a whole-frame brightening of 11% is still: the detector is relative, not absolute');
lit.fill(130); down.downsample(lit, cells); ok(det.detect(cells) === false, '30% more is still');
lit.fill(190); down.downsample(lit, cells); ok(det.detect(cells) === true && det.changes === N, 'and 46% more trips every cell: a light switched on is motion to this detector, by design');
console.log(n + ' checks, ' + fails + ' failed');
if (fails) { console.log('FAIL'); process.exit(1); } console.log('ok');
