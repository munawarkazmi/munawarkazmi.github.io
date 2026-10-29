/* The predicates, in the browser.
 *
 * Two ways of answering "does a, b, c turn left or right?", side by side:
 * the naive double-precision formula and the exact integer one, ported
 * from src/predicates.cpp in exact-predicates. The double version is the
 * same IEEE arithmetic in the same operation order, so it gives the same
 * wrong answers here as the C++ build does; the exact version uses BigInt
 * where the C++ uses __int128, with the same enforced coordinate bounds.
 *
 * tools/test_predicates_lab.js runs the repository's committed adversarial
 * corpus through this file and requires, on every case, the committed
 * exact verdict and a wrong float verdict.
 */
(function () {
  'use strict';

  var ORIENT_BOUND = 1n << 60n, INCIRCLE_BOUND = 1n << 28n;

  function BoundError(msg) { this.name = 'BoundError'; this.message = msg; }
  BoundError.prototype = Object.create(Error.prototype);

  function checkBound(p, bound, name) {
    if (p.x > bound || p.x < -bound || p.y > bound || p.y < -bound) {
      throw new BoundError(name + ': coordinate exceeds the proven-exact bound (|coord| <= ' + bound + '); refusing to return an answer');
    }
  }
  function sign(v) { return v > 0n ? 1 : v < 0n ? -1 : 0; }
  function signd(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

  /* ---- exact: BigInt coordinates ---- */
  function orientDet(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
  function orientation(a, b, c) {
    checkBound(a, ORIENT_BOUND, 'orientation'); checkBound(b, ORIENT_BOUND, 'orientation'); checkBound(c, ORIENT_BOUND, 'orientation');
    return sign(orientDet(a, b, c));
  }
  function incircleDet(a, b, c, d) {
    var adx = a.x - d.x, ady = a.y - d.y, bdx = b.x - d.x, bdy = b.y - d.y, cdx = c.x - d.x, cdy = c.y - d.y;
    var al = adx * adx + ady * ady, bl = bdx * bdx + bdy * bdy, cl = cdx * cdx + cdy * cdy;
    return al * (bdx * cdy - bdy * cdx) - bl * (adx * cdy - ady * cdx) + cl * (adx * bdy - ady * bdx);
  }
  function incircle(a, b, c, d) {
    checkBound(a, INCIRCLE_BOUND, 'incircle'); checkBound(b, INCIRCLE_BOUND, 'incircle'); checkBound(c, INCIRCLE_BOUND, 'incircle'); checkBound(d, INCIRCLE_BOUND, 'incircle');
    return sign(incircleDet(a, b, c, d));
  }

  /* ---- naive: each int64 cast to double, then IEEE arithmetic in this order ---- */
  function orientDetFloat(a, b, c) {
    var bax = Number(b.x) - Number(a.x), bay = Number(b.y) - Number(a.y);
    var cax = Number(c.x) - Number(a.x), cay = Number(c.y) - Number(a.y);
    return bax * cay - bay * cax;
  }
  function orientationFloat(a, b, c) { return signd(orientDetFloat(a, b, c)); }
  function incircleDetFloat(a, b, c, d) {
    var adx = Number(a.x) - Number(d.x), ady = Number(a.y) - Number(d.y);
    var bdx = Number(b.x) - Number(d.x), bdy = Number(b.y) - Number(d.y);
    var cdx = Number(c.x) - Number(d.x), cdy = Number(c.y) - Number(d.y);
    var al = adx * adx + ady * ady, bl = bdx * bdx + bdy * bdy, cl = cdx * cdx + cdy * cdy;
    return al * (bdx * cdy - bdy * cdx) - bl * (adx * cdy - ady * cdx) + cl * (adx * bdy - ady * bdx);
  }
  function incircleFloat(a, b, c, d) { return signd(incircleDetFloat(a, b, c, d)); }

  function parseLine(line) {
    var t = line.trim().split(/\s+/).map(function (s) { return BigInt(s); });
    return t;
  }

  var api = { orientation: orientation, orientationFloat: orientationFloat, orientDet: orientDet, orientDetFloat: orientDetFloat,
    incircle: incircle, incircleFloat: incircleFloat, incircleDet: incircleDet, incircleDetFloat: incircleDetFloat,
    BoundError: BoundError, ORIENT_BOUND: ORIENT_BOUND, INCIRCLE_BOUND: INCIRCLE_BOUND, parseLine: parseLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PredicatesLab = api;

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */
  if (typeof document === 'undefined') return;

  function boot() {
    var fig = document.getElementById('predicatesLab'), data = window.PREDICATES_LAB_DATA;
    if (!fig || !data || !window.requestAnimationFrame) return;
    var $ = function (id) { return document.getElementById(id); };
    var stage = $('pl-stage'), canvas = $('pl-canvas'), ctx = canvas.getContext('2d');
    if (!ctx) return;
    var el = { slider: $('pl-case'), which: $('pl-which'), coords: $('pl-coords'), fdet: $('pl-fdet'), fsays: $('pl-fsays'),
      edet: $('pl-edet'), esays: $('pl-esays'), badge: $('pl-badge'), tally: $('pl-tally'), hint: $('pl-hint'), said: $('pl-said'), scale: $('pl-scale') };
    var tabs = fig.querySelectorAll('[data-pred]'), nudges = fig.querySelectorAll('[data-nudge]');
    fig.hidden = false;

    var colour = {}, dpr = 1, pred = 'orientation', cases = [], ix = 0, pts = [], expected = null, own = false;

    function readColours() {
      var cs = getComputedStyle(fig), names = ['panel', 'bg', 'line', 'ink', 'accent', 'warn', 'warn-ink', 'muted', 'ok'];
      for (var i = 0; i < names.length; i++) colour[names[i]] = cs.getPropertyValue('--' + names[i]).trim() || '#888';
    }
    /* the corpus, parsed once, and sorted by how large the coordinates are so the slider reads as a scale */
    function parseAll() {
      var out = {};
      ['orientation', 'incircle'].forEach(function (k) {
        out[k] = data[k].map(function (line) {
          var v = parseLine(line), n = k === 'orientation' ? 3 : 4, p = [];
          for (var i = 0; i < n; i++) p.push({ x: v[2 * i], y: v[2 * i + 1] });
          var mag = 0n; p.forEach(function (q) { var ax = q.x < 0n ? -q.x : q.x, ay = q.y < 0n ? -q.y : q.y; if (ax > mag) mag = ax; if (ay > mag) mag = ay; });
          return { pts: p, expected: Number(v[2 * n]), mag: mag };
        }).sort(function (a, b) { return a.mag < b.mag ? -1 : a.mag > b.mag ? 1 : 0; });
      });
      return out;
    }
    var corpus = parseAll();
    /* the tally the page claims: computed here, now */
    var tally = {};
    ['orientation', 'incircle'].forEach(function (k) {
      var e = 0, f = 0;
      corpus[k].forEach(function (c) {
        var exact = k === 'orientation' ? orientation(c.pts[0], c.pts[1], c.pts[2]) : incircle(c.pts[0], c.pts[1], c.pts[2], c.pts[3]);
        var flt = k === 'orientation' ? orientationFloat(c.pts[0], c.pts[1], c.pts[2]) : incircleFloat(c.pts[0], c.pts[1], c.pts[2], c.pts[3]);
        if (exact === c.expected) e++; if (flt !== c.expected) f++;
      });
      tally[k] = { n: corpus[k].length, exactRight: e, floatWrong: f };
    });

    function log2(v) { return v <= 0n ? 0 : v.toString(2).length - 1; }
    function words(pred, s) {
      if (pred === 'orientation') return s > 0 ? 'turns left (counterclockwise)' : s < 0 ? 'turns right (clockwise)' : 'collinear';
      return s > 0 ? 'd is inside the circle' : s < 0 ? 'd is outside the circle' : 'd is on the circle';
    }
    function fmtFloat(v) {
      if (v === 0) return '0';
      var a = Math.abs(v); if (a >= 1e6 || a < 1e-3) return v.toExponential(3).replace('e+', 'e');
      return String(v);
    }
    function fmtBig(v) { var s = v.toString(); return s.length > 24 ? s.slice(0, 10) + '…' + s.slice(-10) + ' (' + s.replace('-', '').length + ' digits)' : s; }
    function group(v) { return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

    function show() {
      var o = pred === 'orientation', a = pts[0], b = pts[1], c = pts[2], d = pts[3];
      var edet, fdet, es, fs, err = null;
      try {
        if (o) { es = orientation(a, b, c); edet = orientDet(a, b, c); } else { es = incircle(a, b, c, d); edet = incircleDet(a, b, c, d); }
      } catch (e) { if (e instanceof BoundError) err = e; else throw e; }
      if (o) { fs = orientationFloat(a, b, c); fdet = orientDetFloat(a, b, c); } else { fs = incircleFloat(a, b, c, d); fdet = incircleDetFloat(a, b, c, d); }

      var names = o ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'd'];
      el.coords.innerHTML = pts.map(function (p, i) { return '<span><b>' + names[i] + '</b> (' + group(p.x) + ', ' + group(p.y) + ')</span>'; }).join('');
      var mag = 0n; pts.forEach(function (q) { var ax = q.x < 0n ? -q.x : q.x, ay = q.y < 0n ? -q.y : q.y; if (ax > mag) mag = ax; if (ay > mag) mag = ay; });
      el.scale.textContent = 'largest coordinate about 2^' + log2(mag) + (o ? ' (bound 2^60)' : ' (bound 2^28)');

      el.fdet.textContent = fmtFloat(fdet); el.fsays.textContent = words(pred, fs);
      if (err) { el.edet.textContent = 'refused'; el.esays.textContent = 'coordinate exceeds the proven bound, so the exact predicate throws rather than answer'; }
      else { el.edet.textContent = fmtBig(edet); el.esays.textContent = words(pred, es); }
      var wrong = !err && fs !== es;
      fig.classList.toggle('is-wrong', wrong); fig.classList.toggle('is-agree', !err && !wrong); fig.classList.toggle('is-refused', !!err);
      el.badge.textContent = err ? 'Exact: refused. Float: answered anyway.' : wrong ? 'Float is wrong. Exact is right.' : 'Both agree.';
      el.which.textContent = own ? 'Your case' : 'Corpus case ' + (ix + 1) + ' of ' + cases.length;
      var t = tally[pred];
      el.tally.textContent = 'Over all ' + t.n + ' committed ' + (o ? 'orientation' : 'in-circle') + ' cases, computed in this tab just now: exact right on ' + t.exactRight + ', float wrong on ' + t.floatWrong + '.';
      el.said.textContent = el.which.textContent + '. ' + el.badge.textContent + ' Float says ' + el.fsays.textContent + '; exact says ' + el.esays.textContent + '.';
      draw(es, fs, err);
    }

    /* ---- drawing: doubles are fine for a picture, never for the verdict ---- */
    function draw(es, fs, err) {
      var W = canvas.width / dpr, H = canvas.height / dpr, o = pred === 'orientation';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = colour.panel; ctx.fillRect(0, 0, W, H);
      var P = pts.map(function (p) { return { x: Number(p.x), y: Number(p.y) }; });
      var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      P.forEach(function (p) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
      var pad = 40, span = Math.max(maxx - minx, maxy - miny) || 1, k = Math.min(W - 2 * pad, H - 2 * pad) / span;
      var ox = (W - (maxx - minx) * k) / 2, oy = (H - (maxy - miny) * k) / 2;
      var S = P.map(function (p) { return { x: ox + (p.x - minx) * k, y: H - oy - (p.y - miny) * k }; });
      ctx.lineWidth = 1.5; ctx.strokeStyle = colour.line;
      if (o) {
        /* the line through a and b, extended across the frame */
        var dx = S[1].x - S[0].x, dy = S[1].y - S[0].y, L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        ctx.beginPath(); ctx.moveTo(S[0].x - dx * 2000, S[0].y - dy * 2000); ctx.lineTo(S[0].x + dx * 2000, S[0].y + dy * 2000); ctx.stroke();
      } else {
        /* circle through a, b, c */
        var A = P[0], B = P[1], C = P[2], D2 = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
        if (D2 !== 0) {
          var a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
          var ux = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / D2, uy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / D2;
          var r = Math.hypot(A.x - ux, A.y - uy) * k, cx = ox + (ux - minx) * k, cy = H - oy - (uy - miny) * k;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.stroke();
        }
      }
      var names = o ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'd'];
      ctx.font = '12px ' + getComputedStyle(fig).getPropertyValue('--mono');
      S.forEach(function (p, i) {
        var last = i === S.length - 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, last ? 5 : 4, 0, 6.2832);
        ctx.fillStyle = last ? (err ? colour.muted : colour.accent) : colour.ink; ctx.fill();
        ctx.fillStyle = colour.ink; ctx.fillText(names[i], p.x + 8, p.y - 8);
      });
      /* how far the deciding point really is from the line or circle, in the picture's own units */
      var note;
      if (o) {
        var ab = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y), det = Math.abs(Number(orientDet(pts[0], pts[1], pts[2])));
        note = 'c is ' + (det / ab).toExponential(2).replace('e-', 'e-') + ' units from the line ab, which is ' + ((det / ab) * k).toExponential(1) + ' px at this zoom';
      } else note = 'd is where the exact predicate puts it; at this scale the picture cannot show the difference';
      ctx.fillStyle = colour.muted; ctx.fillText(note, 12, H - 12);
    }

    function size() {
      var w = stage.clientWidth; if (!w) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      var h = Math.round(Math.min(360, Math.max(220, w * 0.5)));
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      if (pts.length) show();
    }
    function pick(i) {
      ix = Math.max(0, Math.min(cases.length - 1, i)); own = false;
      pts = cases[ix].pts.map(function (p) { return { x: p.x, y: p.y }; }); expected = cases[ix].expected;
      show();
    }
    function setPred(k) {
      pred = k; cases = corpus[k];
      for (var j = 0; j < tabs.length; j++) tabs[j].setAttribute('aria-pressed', tabs[j].getAttribute('data-pred') === k ? 'true' : 'false');
      el.slider.max = cases.length - 1; el.slider.value = Math.min(ix, cases.length - 1);
      el.hint.textContent = k === 'orientation'
        ? 'Three points, almost in a line: the true determinant is exactly +1 or -1 by construction. Slide through the corpus, or nudge c by one unit at a time.'
        : 'Four points: is d inside the circle through a, b and c? Slide through the corpus, or nudge d by one unit at a time.';
      pick(+el.slider.value);
    }
    el.slider.addEventListener('input', function () { pick(+this.value); });
    for (var t = 0; t < tabs.length; t++) tabs[t].addEventListener('click', function () { setPred(this.getAttribute('data-pred')); });
    for (var n = 0; n < nudges.length; n++) nudges[n].addEventListener('click', function () {
      var d = this.getAttribute('data-nudge').split(','), q = pts[pts.length - 1];
      q.x += BigInt(d[0]); q.y += BigInt(d[1]); own = true; show();
    });
    $('pl-reset').addEventListener('click', function () { pick(ix); });

    if (window.MutationObserver) new MutationObserver(function () { readColours(); if (pts.length) show(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.ResizeObserver) new ResizeObserver(size).observe(stage); else window.addEventListener('resize', size);
    readColours(); size(); setPred('orientation'); ix = Math.floor(corpus.orientation.length * 0.6); el.slider.value = ix; pick(ix);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
