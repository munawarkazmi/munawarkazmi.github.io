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

  window.LegMath = { solve: solve, valid: valid, dream: dream, DEFAULT: DEFAULT, W: W, H: H };
})();
