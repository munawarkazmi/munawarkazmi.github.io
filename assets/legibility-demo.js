/* The hero figure, live.
 *
 * A toy version of the trade-off legible-motion-bench measures, computed in
 * the visitor's browser. It is an illustration and says so on the page: a
 * two-goal observer in the style of Dragan and Srinivasa, path length as the
 * only cost, and curves drawn from a one-parameter family. It is not the
 * benchmark, and none of its numbers are results.
 *
 * What it does compute, it computes for real. The watcher's belief is
 *
 *     P(G | path so far)  ~  exp(-(cost so far + cost to go to G)) / exp(-cost from start to G)
 *
 * normalised over the two goals. The shortest safe path is a shortest path
 * around the keep-out zone. The legible path is the curve, within a length
 * budget, that makes the watcher sure of the true goal soonest, and the
 * recovered path is the best such curve that stays out of the zone.
 *
 * The maths has no DOM in it and is exported for node, so it can be tested
 * without a browser.
 */
(function () {
  'use strict';

  var W = 520, H = 340;      /* the world, in the SVG's own units */
  var EDGE = 18;             /* nothing is placed or planned closer to the frame than this */
  var LAMBDA = 45;           /* how sharply the watcher prefers efficient motion */
  var BUDGET = 1.3;          /* a legible path may be this much longer than the straight line */
  var SURE = 0.9;            /* "sure" means the watcher's belief has reached this and stays there */
  var N = 72;                /* samples along every finished path */

  /* ------------------------------------------------------------------ *
   * Geometry
   * ------------------------------------------------------------------ */
  function dist(p, q) { var dx = p.x - q.x, dy = p.y - q.y; return Math.sqrt(dx * dx + dy * dy); }

  function inflate(r, m) { return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }; }

  function inRect(p, r) { return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h; }

  /* Liang-Barsky. True only when the segment passes through the interior:
     touching a corner or running along an edge does not count as entering. */
  function segHitsRect(p, q, r) {
    var t0 = 0, t1 = 1, dx = q.x - p.x, dy = q.y - p.y;
    var P = [-dx, dx, -dy, dy];
    var Q = [p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y];
    for (var i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] <= 0) return false; continue; }
      var t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 1e-9;
  }

  /* n points equally spaced along a polyline, and its length */
  function resample(pts, n) {
    var cum = [0], i;
    for (i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    var L = cum[cum.length - 1], out = [], j = 1;
    for (i = 0; i < n; i++) {
      var s = L * i / (n - 1);
      while (j < pts.length - 1 && cum[j] < s) j++;
      var seg = cum[j] - cum[j - 1] || 1, t = (s - cum[j - 1]) / seg;
      out.push({ x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t,
                 y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t });
    }
    return { pts: out, len: L };
  }

  function quadratic(S, c, A, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t;
      out.push({ x: a * S.x + b * c.x + d * A.x, y: a * S.y + b * c.y + d * A.y });
    }
    return out;
  }

  /* Does the path ever move away from where it is going? A robot that swings
     past its goal and doubles back is not being clear, it is being odd, and
     a curve family this simple will happily propose it. */
  function overshoots(pts, goal) {
    var s = pts[0], ax = goal.x - s.x, ay = goal.y - s.y, span = Math.hypot(ax, ay) || 1;
    var last = dist(s, goal), along = 0;
    for (var i = 1; i < pts.length; i++) {
      var now = dist(pts[i], goal);
      var prog = ((pts[i].x - s.x) * ax + (pts[i].y - s.y) * ay) / span;
      /* further from the goal than a moment ago, or sliding back along the way there */
      if (now > last + 0.5 || prog < along - 0.3) return true;
      last = now; along = prog;
    }
    return false;
  }

  /* index of the first sample inside the rectangle, or -1 */
  function firstEntry(pts, r) {
    for (var i = 1; i < pts.length; i++) {
      if (segHitsRect(pts[i - 1], pts[i], r)) return i;
    }
    return -1;
  }

  /* ------------------------------------------------------------------ *
   * The watcher
   * ------------------------------------------------------------------ */
  function score(path, S, A, B) {
    var pts = path.pts, n = pts.length, step = path.len / (n - 1);
    var dSA = dist(S, A), dSB = dist(S, B);
    var belief = [], weighted = 0, weights = 0, sureFrom = n;
    for (var i = 0; i < n; i++) {
      var soFar = step * i;
      var a = Math.exp(-(soFar + dist(pts[i], A) - dSA) / LAMBDA);
      var b = Math.exp(-(soFar + dist(pts[i], B) - dSB) / LAMBDA);
      var p = a / (a + b);
      belief.push(p);
      /* Dragan's legibility: belief in the true goal, weighted towards the
         start, because being clear early is the whole point. */
      weighted += p * (n - 1 - i);
      weights += (n - 1 - i);
    }
    for (i = n - 1; i >= 0 && belief[i] >= SURE; i--) sureFrom = i;
    return {
      belief: belief,
      legibility: weighted / weights,
      sureBy: sureFrom < n ? sureFrom / (n - 1) : null   /* null: never sure, even on arrival */
    };
  }

  /* ------------------------------------------------------------------ *
   * The three paths
   * ------------------------------------------------------------------ */
  function shortestSafe(S, A, zone) {
    var z = inflate(zone, 7), block = inflate(zone, 6);
    var nodes = [S,
      { x: z.x, y: z.y }, { x: z.x + z.w, y: z.y },
      { x: z.x + z.w, y: z.y + z.h }, { x: z.x, y: z.y + z.h },
      A];
    var n = nodes.length, best = [], prev = [], done = [], i, j;
    for (i = 0; i < n; i++) { best.push(Infinity); prev.push(-1); done.push(false); }
    best[0] = 0;
    for (;;) {
      var u = -1;
      for (i = 0; i < n; i++) if (!done[i] && (u < 0 || best[i] < best[u])) u = i;
      if (u < 0 || best[u] === Infinity) break;
      done[u] = true;
      if (u === n - 1) break;
      for (j = 0; j < n; j++) {
        if (done[j]) continue;
        var p = nodes[j];
        if (p.x < 2 || p.x > W - 2 || p.y < 2 || p.y > H - 2) continue;
        if (segHitsRect(nodes[u], p, block)) continue;
        var d = best[u] + dist(nodes[u], p);
        if (d < best[j]) { best[j] = d; prev[j] = u; }
      }
    }
    var route = [];
    for (i = n - 1; i >= 0; i = prev[i]) route.unshift(nodes[i]);
    if (route[0] !== S) route = [S, A];   /* boxed in: should not happen inside the drag limits */
    return resample(route, N);
  }

  function solve(world) {
    var S = world.start, A = world.a, B = world.b, zone = world.zone;
    var wall = inflate(zone, 3);

    var short = shortestSafe(S, A, zone);
    var limit = Math.max(BUDGET * dist(S, A), 1.12 * short.len);

    var free = null, freeScore = -1, safe = null, safeScore = -1, chord = dist(S, A);
    for (var cx = EDGE; cx <= W - EDGE; cx += 13) {
      for (var cy = EDGE; cy <= H - EDGE; cy += 13) {
        /* A cheap estimate of the curve's length throws out most of the grid
           before anything is sampled. It is generous: nothing within budget
           is lost to it, and the exact check below still decides. */
        var c = { x: cx, y: cy };
        if ((2 * chord + dist(S, c) + dist(c, A)) / 3 > limit * 1.1) continue;
        var cand = resample(quadratic(S, c, A, 40), 40);
        if (cand.len > limit || overshoots(cand.pts, A)) continue;
        var s = score(cand, S, A, B).legibility;
        if (s > freeScore) { freeScore = s; free = { x: cx, y: cy }; }
        if (s > safeScore && firstEntry(cand.pts, wall) < 0) { safeScore = s; safe = { x: cx, y: cy }; }
      }
    }

    function finish(path, name) {
      var sc = score(path, S, A, B), entry = firstEntry(path.pts, zone);
      return {
        name: name, pts: path.pts, len: path.len,
        ratio: path.len / dist(S, A),
        belief: sc.belief, legibility: sc.legibility, sureBy: sc.sureBy,
        entry: entry, enters: entry >= 0
      };
    }

    var shortOut = finish(short, 'short');
    var freeOut = finish(resample(quadratic(S, free || A, A, 96), N), 'free');
    var safeOut = safe
      ? finish(resample(quadratic(S, safe, A, 96), N), 'safe')
      : finish(short, 'safe');                 /* no clear curve exists: fall back to the safe route */
    safeOut.fallback = !safe;
    safeOut.same = !freeOut.enters;            /* the legible path was already clear of the zone */
    if (safeOut.same) { safeOut = finish(resample(quadratic(S, free, A, 96), N), 'safe'); safeOut.same = true; }
    return { short: shortOut, free: freeOut, safe: safeOut };
  }

  /* May a world be drawn at all? The drag handlers refuse any move that breaks this. */
  function valid(world) {
    var pts = [world.start, world.a, world.b], keep = inflate(world.zone, 12), z = world.zone, i;
    for (i = 0; i < 3; i++) {
      var p = pts[i];
      if (p.x < EDGE || p.x > W - EDGE || p.y < EDGE || p.y > H - EDGE) return false;
      if (inRect(p, keep)) return false;
    }
    if (z.x < EDGE + 14 || z.y < EDGE + 14 || z.x + z.w > W - EDGE - 14 || z.y + z.h > H - EDGE - 14) return false;
    return dist(world.a, world.b) >= 70 && dist(world.start, world.a) >= 150 && dist(world.start, world.b) >= 90;
  }

  /* Does a solved world tell the story? The legible path is tempted through
     the zone, a clear one exists, and the watcher can tell the three apart.
     "New world" keeps drawing until it finds one that does. */
  function story(s) {
    if (!s.free.enters || s.safe.fallback) return false;
    if (s.short.sureBy === null || s.free.sureBy === null || s.safe.sureBy === null) return false;
    return s.short.sureBy - s.free.sureBy >= 0.12 && s.short.sureBy - s.safe.sureBy >= 0.03;
  }

  /* A random world, built so that it probably does: find where the legible
     curve wants to go with nothing in its way, then put the zone there. */
  function dream(random) {
    var rnd = function (lo, hi) { return Math.round(lo + random() * (hi - lo)); };
    var nowhere = { x: -400, y: -400, w: 10, h: 10 };
    for (var tries = 0; tries < 80; tries++) {
      var left = random() < 0.5;
      var w = {
        start: { x: left ? rnd(40, 110) : rnd(410, 480), y: rnd(60, 290) },
        a: { x: left ? rnd(400, 480) : rnd(40, 120), y: rnd(40, 300) },
        b: { x: left ? rnd(380, 480) : rnd(40, 140), y: rnd(40, 300) },
        zone: { x: 200, y: 120, w: 100, h: 80 }
      };
      if (dist(w.a, w.b) < 110 || dist(w.start, w.a) < 240 || dist(w.start, w.b) < 160) continue;
      var open = solve({ start: w.start, a: w.a, b: w.b, zone: nowhere }).free;
      var q = open.pts[Math.round((0.14 + random() * 0.3) * (N - 1))];
      /* which side of the straight line the curve bulges to: the zone sits out there */
      var ax = w.a.x - w.start.x, ay = w.a.y - w.start.y, span = Math.hypot(ax, ay);
      var side = ((q.x - w.start.x) * -ay + (q.y - w.start.y) * ax) / span;
      if (Math.abs(side) < 24) continue;
      var nx = -ay / span * (side > 0 ? 1 : -1), ny = ax / span * (side > 0 ? 1 : -1);
      var zw = rnd(84, 140), zh = rnd(64, 104), push = (0.1 + random() * 0.3) * Math.min(zw, zh);
      w.zone = { x: Math.round(q.x + nx * push - zw / 2), y: Math.round(q.y + ny * push - zh / 2), w: zw, h: zh };
      if (valid(w) && story(solve(w))) return w;
    }
    return null;
  }

  /* The world the page opens on, chosen so the three paths tell the story:
     the straight line leaves the watcher guessing, the legible curve swings
     away from the other goal and through the zone, and the recovered one
     keeps most of the clarity without the trespass. */
  var DEFAULT = { start: { x: 64, y: 270 }, a: { x: 452, y: 70 }, b: { x: 452, y: 270 },
                  zone: { x: 110, y: 40, w: 110, h: 90 } };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { solve: solve, valid: valid, segHitsRect: segHitsRect, inflate: inflate,
                       firstEntry: firstEntry, story: story, dream: dream, DEFAULT: DEFAULT, W: W, H: H, BUDGET: BUDGET };
  }
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */
  var TX = 10, TW = 420, TY = 8, TH = 74;     /* the belief trace, in its own SVG's units */
  var TLOW = 0.4;                             /* the trace's floor: belief rarely goes lower, and the top is where the story is */

  function boot() {
    var fig = document.getElementById('legibilityDemo');
    if (!fig) return;
    var svg = fig.querySelector('svg');
    var $ = function (id) { return document.getElementById(id); };
    var NAMES = ['short', 'free', 'safe'];
    var el = {
      zoneBg: $('dz-bg'), zoneHatch: $('dz-hatch'), zoneEdge: $('dz-edge'),
      path: { short: $('dp-short'), free: $('dp-free'), safe: $('dp-safe') },
      sure: { short: $('ds-short'), free: $('ds-free'), safe: $('ds-safe') },
      trace: { short: $('dt-short'), free: $('dt-free'), safe: $('dt-safe') },
      mark: { short: $('dm-short'), free: $('dm-free'), safe: $('dm-safe') },
      rows: { short: $('demo-row-short'), free: $('demo-row-free'), safe: $('demo-row-safe') },
      entry: $('d-entry'), robot: $('d-robot'), cursor: $('dt-cursor'),
      start: $('d-start'), a: $('d-a'), b: $('d-b'),
      hStart: $('dh-start'), hA: $('dh-a'), hB: $('dh-b'),
      lStart: $('dl-start'), lA: $('dl-a'), lB: $('dl-b'), lZone: $('dl-zone'),
      barA: $('demo-bar-a'), pctA: $('demo-pct-a'), pctB: $('demo-pct-b'),
      status: $('demo-status'), summary: $('demo-summary'),
      toggle: $('demo-toggle'), shuffle: $('demo-shuffle')
    };

    var world = JSON.parse(JSON.stringify(DEFAULT));
    var sol = solve(world);
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var DUR = 3600, HOLD = 3200;
    var phase = 3;            /* 0, 1, 2 are the three runs; 3 is everything drawn and at rest */
    var phaseStart = 0, paused = still, inView = false, dragging = null, raf = 0, runOnce = false;

    fig.classList.add('is-live');

    /* ---- drawing ---- */
    function d(pts, upto) {
      var f = upto * (pts.length - 1), last = Math.floor(f), out = '';
      for (var i = 0; i <= last; i++) out += (i ? 'L' : 'M') + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1);
      if (last < pts.length - 1) {
        var p = at(pts, upto);
        out += 'L' + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
      }
      return out;
    }
    function tx(u) { return TX + u * TW; }
    function ty(b) { return TY + (1 - Math.max(0, (b - TLOW) / (1 - TLOW))) * TH; }
    function trace(belief, upto) {
      var f = upto * (belief.length - 1), last = Math.floor(f), out = '';
      for (var i = 0; i <= last; i++) out += (i ? 'L' : 'M') + tx(i / (belief.length - 1)).toFixed(1) + ' ' + ty(belief[i]).toFixed(1);
      if (last < belief.length - 1) out += 'L' + tx(upto).toFixed(1) + ' ' + ty(at(belief, upto)).toFixed(1);
      return out;
    }
    function at(arr, u) {
      var f = u * (arr.length - 1), i = Math.max(0, Math.min(arr.length - 2, Math.floor(f))), t = f - i;
      return typeof arr[i] === 'number'
        ? arr[i] + (arr[i + 1] - arr[i]) * t
        : { x: arr[i].x + (arr[i + 1].x - arr[i].x) * t, y: arr[i].y + (arr[i + 1].y - arr[i].y) * t };
    }
    function place(label, x, y) {
      label.style.left = Math.max(1, Math.min(84, x / W * 100)) + '%';
      label.style.top = Math.max(2, Math.min(92, y / H * 100)) + '%';
    }
    function pct(v) { return Math.round(v * 100) + '%'; }
    function show(node, on) { node.style.display = on ? '' : 'none'; }
    function centre(node, p) { node.setAttribute('cx', p.x.toFixed(1)); node.setAttribute('cy', p.y.toFixed(1)); }

    function drawWorld() {
      var z = world.zone, rects = [el.zoneBg, el.zoneHatch, el.zoneEdge];
      for (var i = 0; i < rects.length; i++) {
        rects[i].setAttribute('x', z.x); rects[i].setAttribute('y', z.y);
        rects[i].setAttribute('width', z.w); rects[i].setAttribute('height', z.h);
      }
      el.start.setAttribute('x', world.start.x - 8); el.start.setAttribute('y', world.start.y - 8);
      centre(el.a, world.a); centre(el.b, world.b);
      centre(el.hStart, world.start); centre(el.hA, world.a); centre(el.hB, world.b);
      place(el.lStart, world.start.x - 18, world.start.y + 14);
      place(el.lA, world.a.x - 52, world.a.y - 36 < 6 ? world.a.y + 16 : world.a.y - 30);
      place(el.lB, world.b.x - 52, world.b.y + 14 > H - 22 ? world.b.y - 30 : world.b.y + 14);
      place(el.lZone, z.x, z.y - 22 < 4 ? z.y + z.h + 6 : z.y - 20);
    }

    function fillTable() {
      for (var i = 0; i < 3; i++) {
        var p = sol[NAMES[i]], cells = el.rows[NAMES[i]].querySelectorAll('[data-cell]');
        cells[0].textContent = p.ratio.toFixed(2) + 'x';
        cells[1].textContent = p.sureBy === null ? 'never' : pct(p.sureBy);
        cells[2].textContent = p.enters ? 'enters' : 'clear';
        cells[2].className = p.enters ? 'is-warn' : '';
      }
      el.rows.safe.querySelector('[data-name]').textContent =
        sol.safe.same ? 'Legible, already clear' : (sol.safe.fallback ? 'Recovered: the safe route' : 'Legible and safe');
      el.summary.textContent =
        'Shortest safe path: the watcher is sure of the goal ' + when(sol.short) + '. ' +
        'Legible path: sure ' + when(sol.free) + (sol.free.enters ? ', and it enters the keep-out zone' : '') + '. ' +
        (sol.safe.same ? '' : 'Recovered path: sure ' + when(sol.safe) + ', clear of the zone.');
    }
    function when(p) { return p.sureBy === null ? 'only on arrival' : pct(p.sureBy) + ' of the way along'; }

    var STATUS = [
      function () { return '1/3 Shortest safe path. Watcher sure ' + whenShort(sol.short) + '.'; },
      function (u) {
        if (!sol.free.enters) return '2/3 Legible path. Sure ' + whenShort(sol.free) + ', and clear of the zone.';
        return u < sol.free.entry / (N - 1)
          ? '2/3 Legible path. It commits to A early.'
          : '2/3 Legible path. Sure ' + whenShort(sol.free) + ', but it enters the zone. Rejected.';
      },
      function () {
        return sol.safe.fallback
          ? '3/3 No clear curve exists. The safe route is kept.'
          : '3/3 Recovered. Sure ' + whenShort(sol.safe) + ', and clear of the zone.';
      },
      function () {
        if (dragging) return 'Replanning as you drag.';
        if (paused) return 'Paused. Drag anything on the map, or press play.';
        return fig.classList.contains('is-touched') ? 'Replanned.' : 'Now drag the start, a goal or the zone.';
      }
    ];
    function whenShort(p) { return p.sureBy === null ? 'only on arrival' : 'by ' + pct(p.sureBy); }

    /* One path, one trace, one "sure here" marker each. `upto` is how much of
       it exists yet: 0 for not started, 1 for finished. */
    function drawRun(name, upto) {
      var p = sol[name], on = upto > 0;
      show(el.path[name], on); show(el.trace[name], on);
      if (on) {
        el.path[name].setAttribute('d', d(p.pts, upto));
        el.trace[name].setAttribute('d', trace(p.belief, upto));
      }
      var sure = on && p.sureBy !== null && upto >= p.sureBy;
      show(el.sure[name], sure); show(el.mark[name], sure);
      if (sure) {
        centre(el.sure[name], at(p.pts, p.sureBy));
        centre(el.mark[name], { x: tx(p.sureBy), y: ty(at(p.belief, p.sureBy)) });
      }
    }

    function draw(u) {
      var rest = phase === 3, same = sol.safe.same;
      var runName = phase === 0 ? 'short' : phase === 1 ? 'free' : 'safe';
      var run = sol[runName];

      drawRun('short', phase === 0 ? u : 1);
      drawRun('free', phase < 1 ? 0 : phase === 1 ? u : 1);
      drawRun('safe', same || phase < 2 ? 0 : phase === 2 ? u : 1);

      var entered = sol.free.enters && (phase > 1 || (phase === 1 && u >= sol.free.entry / (N - 1)));
      var rejected = sol.free.enters && phase >= 2;
      fig.classList.toggle('is-quiet', phase === 1 || phase === 2);
      fig.classList.toggle('is-rejected', rejected);
      fig.classList.toggle('is-alert', entered && phase === 1);
      fig.classList.toggle('is-rest', rest);
      show(el.entry, entered);
      if (sol.free.enters) centre(el.entry, sol.free.pts[sol.free.entry]);

      show(el.robot, !rest); show(el.cursor, !rest);
      if (!rest) {
        var where = at(run.pts, u);
        el.robot.setAttribute('transform', 'translate(' + where.x.toFixed(1) + ' ' + where.y.toFixed(1) + ')');
        el.cursor.setAttribute('x1', tx(u).toFixed(1)); el.cursor.setAttribute('x2', tx(u).toFixed(1));
      }

      var belief = rest ? 1 : at(run.belief, u);
      el.barA.style.width = (belief * 100).toFixed(1) + '%';
      el.pctA.textContent = pct(belief); el.pctB.textContent = pct(1 - belief);
      fig.classList.toggle('is-sure', belief >= SURE);

      var text = STATUS[phase](u);
      if (el.status.textContent !== text) el.status.textContent = text;
      for (var i = 0; i < 3; i++) el.rows[NAMES[i]].classList.toggle('is-active', !rest && NAMES[i] === runName);
    }

    /* ---- the clock ---- */
    function enter(next, now) {
      phase = next; phaseStart = now;
      if (phase === 2 && sol.safe.same) { phase = 3; }
      if (phase === 3 && runOnce) { runOnce = false; paused = true; label(); }
    }
    function tick(now) {
      raf = 0;
      if (paused || !inView || dragging || document.hidden) return;
      if (!phaseStart) phaseStart = now;
      var span = phase === 3 ? HOLD : DUR, u = (now - phaseStart) / span;
      if (u >= 1) { enter(phase === 3 ? 0 : phase + 1, now); u = 0; }
      /* the robot eases away from the start and into the goal */
      var v = Math.min(1, Math.max(0, u));
      draw(phase === 3 ? 1 : v * v * (3 - 2 * v) * 0.6 + v * 0.4);
      if (!paused) raf = requestAnimationFrame(tick);
    }
    function wake() { if (!raf && !paused && inView && !dragging) { phaseStart = 0; raf = requestAnimationFrame(tick); } }
    function restart() { phase = 0; phaseStart = 0; wake(); }
    function label() {
      el.toggle.textContent = paused ? 'Play' : 'Pause';
      el.toggle.setAttribute('aria-pressed', paused ? 'false' : 'true');
    }

    function replan() {
      sol = solve(world);
      drawWorld(); fillTable();
      phase = 3; draw(1);
    }

    /* ---- dragging ---- */
    function toWorld(ev) {
      var r = svg.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height };
    }
    function attempt(change) {
      var trial = JSON.parse(JSON.stringify(world));
      change(trial);
      if (!valid(trial)) return false;
      world = trial; replan(); return true;
    }
    function grab(node, key) {
      node.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        var p = toWorld(ev);
        dragging = key === 'zone'
          ? { key: key, dx: p.x - world.zone.x, dy: p.y - world.zone.y }
          : { key: key, dx: p.x - world[key].x, dy: p.y - world[key].y };
        try { node.setPointerCapture(ev.pointerId); } catch (e) { /* the pointer is already gone */ }
        fig.classList.add('is-dragging'); fig.classList.add('is-touched');
        phase = 3; draw(1);
      });
      node.addEventListener('pointermove', function (ev) {
        if (!dragging || dragging.key !== key) return;
        var p = toWorld(ev), x = Math.round(p.x - dragging.dx), y = Math.round(p.y - dragging.dy);
        /* if the full move is not allowed, slide along whichever axis is */
        var move = function (mx, my) {
          return attempt(function (w) {
            var t = key === 'zone' ? w.zone : w[key];
            if (mx) t.x = x; if (my) t.y = y;
          });
        };
        if (!move(true, true)) { if (!move(true, false)) move(false, true); }
      });
      var drop = function () {
        if (!dragging) return;
        dragging = null; fig.classList.remove('is-dragging');
        if (!still && !paused) restart();
      };
      node.addEventListener('pointerup', drop);
      node.addEventListener('pointercancel', drop);
      /* the same moves from the keyboard, eight units at a time */
      node.addEventListener('keydown', function (ev) {
        var step = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[ev.key];
        if (!step) return;
        ev.preventDefault();
        fig.classList.add('is-touched');
        attempt(function (w) { var t = key === 'zone' ? w.zone : w[key]; t.x += step[0]; t.y += step[1]; });
      });
    }
    grab(el.hStart, 'start'); grab(el.hA, 'a'); grab(el.hB, 'b'); grab(el.zoneEdge, 'zone');

    /* ---- controls ---- */
    el.toggle.addEventListener('click', function () {
      paused = !paused;
      if (!paused && still) runOnce = true;       /* reduced motion: one pass, on request, then rest */
      label();
      if (!paused) restart(); else { phase = 3; draw(1); }
    });
    el.shuffle.addEventListener('click', function () {
      var next = dream(Math.random) || dream(Math.random) || dream(Math.random);
      if (!next) return;
      world = next; replan();
      if (!still && !paused) restart();
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView) wake();
      }, { threshold: 0.35 }).observe(fig);
    } else { inView = true; }
    document.addEventListener('visibilitychange', wake);

    drawWorld(); fillTable(); label();
    if (still) { phase = 3; draw(1); } else { phase = 0; draw(0); wake(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
