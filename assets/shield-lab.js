/* The shield, in the browser.
 *
 * llm-nav-shield composes two verified cores: the trajectory verifier
 * (ros2-llm-safety-verifier) and an exact-integer-cost A* (from
 * ros2-dynamic-path-planning). This file is a port of the decision in
 * src/shield_main.cpp, with the A* ported from deps/planning/core and the
 * reference checker from deps/verifier/core/eval, so that the browser
 * makes exactly the decision the C++ build made on every committed case.
 *
 * The A* keeps the C++ heap's tie-breaking (libstdc++ push_heap and
 * pop_heap over the same comparator), so recovered paths come out
 * waypoint for waypoint as the committed dumps. tools/test_shield_lab.js
 * checks that.
 *
 * Needs assets/verifier-lab.js loaded first.
 */
(function () {
  'use strict';
  var V = typeof module !== 'undefined' && module.exports ? require('./verifier-lab.js') : window.VerifierLab;
  var LETHAL = V.LETHAL, UNKNOWN = V.UNKNOWN, PARAMS = V.PARAMS;

  /* ---- planning core: exact integer costs ---- */
  var STRAIGHT = 70, DIAGONAL = 99;
  function stepCost(cell, diagonal) { return (diagonal ? DIAGONAL : STRAIGHT) * (254 + cell); }
  function octile(x1, y1, x2, y2) {
    var dx = Math.abs(x1 - x2), dy = Math.abs(y1 - y2), m = dx < dy ? dx : dy;
    return 254 * (STRAIGHT * (dx + dy) + (DIAGONAL - 2 * STRAIGHT) * m);
  }
  /* std::priority_queue<OpenEntry, vector, cmp> with cmp(a, b) = a.f != b.f ? a.f > b.f : a.g < b.g,
     done the way libstdc++ does it so ties resolve identically. Entries are [f, g, idx]. */
  function less(a, b) { return a[0] !== b[0] ? a[0] > b[0] : a[1] < b[1]; }
  function pushHeap(h, e) {
    h.push(e);
    var i = h.length - 1, parent = (i - 1) >> 1;
    while (i > 0 && less(h[parent], e)) { h[i] = h[parent]; i = parent; parent = (i - 1) >> 1; }
    h[i] = e;
  }
  function popHeap(h) {
    var top = h[0], last = h.pop(), len = h.length;
    if (!len) return top;
    /* __adjust_heap(first, 0, len, value) */
    var hole = 0, topIx = 0, second = 0;
    var child = hole;
    while (child < ((len - 1) >> 1)) {
      child = 2 * (child + 1);
      if (less(h[child], h[child - 1])) child--;
      h[hole] = h[child]; hole = child;
    }
    if ((len & 1) === 0 && hole === ((len - 2) >> 1)) { child = 2 * (hole + 1); h[hole] = h[child - 1]; hole = child - 1; }
    /* __push_heap(first, hole, top, value) */
    var parent = (hole - 1) >> 1;
    while (hole > topIx && less(h[parent], last)) { h[hole] = h[parent]; hole = parent; parent = (hole - 1) >> 1; }
    h[hole] = last;
    return top;
  }
  function astar(cost, width, height, sx, sy, gx, gy) {
    var n = width * height, i;
    var at = function (x, y) { return cost[y * width + x] < LETHAL; };
    if (sx < 0 || sy < 0 || gx < 0 || gy < 0 || sx >= width || sy >= height || gx >= width || gy >= height || !at(sx, sy) || !at(gx, gy)) return null;
    var g = new Float64Array(n), parent = new Int32Array(n), closed = new Uint8Array(n);
    for (i = 0; i < n; i++) { g[i] = Infinity; parent[i] = -1; }
    var open = [], start = sy * width + sx, goal = gy * width + gx, expanded = 0;
    g[start] = 0; pushHeap(open, [octile(sx, sy, gx, gy), 0, start]);
    while (open.length) {
      var top = popHeap(open), idx = top[2];
      if (closed[idx]) continue;
      closed[idx] = 1; expanded++;
      if (idx === goal) {
        var path = [];
        for (var cur = idx; cur >= 0; cur = parent[cur]) path.push([cur % width, (cur - cur % width) / width]);
        path.reverse();
        return { cells: path, expanded: expanded };
      }
      var x = idx % width, y = (idx - x) / width;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!at(nx, ny)) continue;
        var nidx = ny * width + nx;
        if (closed[nidx]) continue;
        var tg = g[idx] + stepCost(cost[nidx], dx !== 0 && dy !== 0);
        if (tg < g[nidx]) { g[nidx] = tg; parent[nidx] = idx; pushHeap(open, [tg + octile(nx, ny, gx, gy), tg, nidx]); }
      }
    }
    return null;
  }

  /* ---- the bridge: lethal and unknown inflated by the footprint plus one cell, and the border band ---- */
  function inflatedPlanningGrid(grid, robotRadius) {
    var res = grid.res, infl = Math.ceil((robotRadius + res) / res), w = grid.width, h = grid.height;
    var out = new Uint8Array(w * h), x, y, dx, dy;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (grid.cells[y * w + x] < LETHAL) continue;
      for (dy = -infl; dy <= infl; dy++) for (dx = -infl; dx <= infl; dx++) {
        if (dx * dx + dy * dy > infl * infl) continue;
        var nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = LETHAL;
      }
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (x >= infl && y >= infl && x < w - infl && y < h - infl) continue;
      out[y * w + x] = LETHAL;
    }
    return out;
  }
  function cellCenter(grid, x, y) { return { x: (x + 0.5) * grid.res, y: (y + 0.5) * grid.res }; }

  /* ---- the reference checker: the same footprint rule, sampled four times finer ---- */
  function referenceSafe(grid, traj, p) {
    if (!traj.length) return false;
    var step = p.sample_step / 4, res = grid.res, r = p.robot_radius;
    function circleClear(c) {
      var x0 = Math.floor((c.x - r) / res), x1 = Math.floor((c.x + r) / res), y0 = Math.floor((c.y - r) / res), y1 = Math.floor((c.y + r) / res);
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
        var ccx = (x + 0.5) * res, ccy = (y + 0.5) * res;
        var dx = Math.max(0, Math.abs(ccx - c.x) - res / 2), dy = Math.max(0, Math.abs(ccy - c.y) - res / 2);
        if (dx * dx + dy * dy > r * r) continue;
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
        var cost = grid.cost(x, y);
        if (cost === UNKNOWN ? !p.allow_unknown : cost >= LETHAL) return false;
      }
      return true;
    }
    for (var i = 0; i < traj.length; i++) {
      if (!grid.worldToMap(traj[i])) return false;
      if (i === 0) { if (!circleClear(traj[0])) return false; continue; }
      var a = traj[i - 1], b = traj[i], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > p.max_segment_length) return false;
      var n = Math.ceil(len / step);
      for (var s = 1; s <= n; s++) { var t = s / n; if (!circleClear({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })) return false; }
    }
    return true;
  }

  /* Seals the goal inside a ring of lethal cells, radius 8, three cells thick. */
  function sealGoal(grid, goal) {
    var out = new V.Grid(grid.width, grid.height, grid.res, grid.cells.slice()), m = grid.worldToMap(goal);
    if (!m) return out;
    for (var dy = -11; dy <= 11; dy++) for (var dx = -11; dx <= 11; dx++) {
      var r2 = dx * dx + dy * dy; if (r2 < 64 || r2 > 121) continue;
      var x = m[0] + dx, y = m[1] + dy;
      if (x >= 0 && y >= 0 && x < grid.width && y < grid.height) out.cells[y * grid.width + x] = LETHAL;
    }
    return out;
  }

  /* The decision for one proposal on one map. */
  function runShield(grid, traj, start, goal, params) {
    params = params || PARAMS;
    var llm = V.verify(grid, traj, params);
    var atGoal = traj.length > 0 && Math.hypot(traj[traj.length - 1].x - goal.x, traj[traj.length - 1].y - goal.y) <= 0.3;
    if (llm.safe && atGoal) return { bucket: 'forwarded_safe', forwarded: true, llm: llm, llmAtGoal: atGoal, fallback: [] };
    var bucket = llm.safe ? 'recovered_from_off_goal' : 'recovered_from_unsafe';
    var inflated = inflatedPlanningGrid(grid, params.robot_radius);
    var s = grid.worldToMap(start), gm = grid.worldToMap(goal);
    if (!s || !gm) return { bucket: 'halted_no_safe_path', forwarded: false, llm: llm, llmAtGoal: atGoal, fallback: [], inflated: inflated };
    var plan = astar(inflated, grid.width, grid.height, s[0], s[1], gm[0], gm[1]);
    if (!plan) return { bucket: 'halted_no_safe_path', forwarded: false, llm: llm, llmAtGoal: atGoal, fallback: [], inflated: inflated };
    var fallback = plan.cells.map(function (c) { return cellCenter(grid, c[0], c[1]); });
    var fb = V.verify(grid, fallback, params), oracle = referenceSafe(grid, fallback, params);
    var fbAtGoal = Math.hypot(fallback[fallback.length - 1].x - goal.x, fallback[fallback.length - 1].y - goal.y) <= 0.3;
    if (fb.safe && oracle && fbAtGoal) return { bucket: bucket, forwarded: true, llm: llm, llmAtGoal: atGoal, fallback: fallback, fb: fb, oracle: oracle, expanded: plan.expanded, inflated: inflated };
    return { bucket: 'fallback_unsafe', forwarded: false, llm: llm, llmAtGoal: atGoal, fallback: fallback, fb: fb, oracle: oracle, expanded: plan.expanded, inflated: inflated };
  }

  var api = { astar: astar, inflatedPlanningGrid: inflatedPlanningGrid, referenceSafe: referenceSafe, sealGoal: sealGoal, runShield: runShield, pushHeap: pushHeap, popHeap: popHeap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ShieldLab = api;

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */
  if (typeof document === 'undefined') return;

  function boot() {
    var fig = document.getElementById('shieldLab'), maps = window.VERIFIER_LAB_DATA, recorded = window.SHIELD_LAB_DATA;
    if (!fig || !maps || !recorded || !window.requestAnimationFrame) return;
    var $ = function (id) { return document.getElementById(id); };
    var stage = $('sl-stage'), canvas = $('sl-canvas'), ctx = canvas.getContext('2d');
    if (!ctx) return;
    var el = { scenario: $('sl-scenario'), steps: [$('sl-step1'), $('sl-step2'), $('sl-step3'), $('sl-step4')], decision: $('sl-decision'), detail: $('sl-detail'),
      match: $('sl-match'), ms: $('sl-ms'), hint: $('sl-hint'), said: $('sl-said'), run: $('sl-run'), seal: $('sl-seal') };
    var modes = fig.querySelectorAll('[data-mode]'), acts = fig.querySelectorAll('[data-act]');
    fig.hidden = false;
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    var colour = {}, scale = 1, dpr = 1, scen, grid, base, traj = [], out = null, shown = 0, mode = 'look', drag = false, edited = false, sealed = false, timer = 0;

    function readColours() {
      var cs = getComputedStyle(fig), names = ['panel', 'bg', 'line', 'ink', 'accent', 'warn', 'warn-ink', 'muted', 'neutral', 'ok'];
      for (var i = 0; i < names.length; i++) colour[names[i]] = cs.getPropertyValue('--' + names[i]).trim() || '#888';
    }
    function decode(rle, n) {
      var cells = new Uint8Array(n), k = 0;
      for (var i = 0; i < rle.length; i += 2) { var v = rle[i] === 1 ? LETHAL : rle[i] === 2 ? UNKNOWN : 0; for (var j = 0; j < rle[i + 1]; j++) cells[k++] = v; }
      return cells;
    }
    function load(ix) {
      scen = maps[ix]; base = decode(scen.cells, scen.width * scen.height);
      grid = new V.Grid(scen.width, scen.height, scen.resolution, base.slice());
      traj = scen.proposals.qwen.waypoints.map(function (w) { return { x: w[0], y: w[1] }; });
      out = null; shown = 0; edited = false; sealed = false; fig.classList.remove('is-edited');
      size(); showSteps(); say('Map ' + scen.id + " with qwen2.5-7b-instruct's committed proposal. Press Run the shield.");
    }
    function size() {
      var w = stage.clientWidth; if (!w) return;
      dpr = Math.min(2, window.devicePixelRatio || 1); scale = w / grid.width;
      canvas.style.width = w + 'px'; canvas.style.height = Math.round(scale * grid.height) + 'px';
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(scale * grid.height * dpr);
      render();
    }
    function toPx(p) { return { x: p.x / grid.res * scale, y: (grid.height - p.y / grid.res) * scale }; }
    function toWorld(px, py) { return { x: px / scale * grid.res, y: (grid.height - py / scale) * grid.res }; }
    var start = function () { return { x: scen.start[0], y: scen.start[1] }; }, goal = function () { return { x: scen.goal[0], y: scen.goal[1] }; };

    function run() {
      clearTimeout(timer);
      var t0 = performance.now();
      out = runShield(grid, traj, start(), goal());
      out.ms = performance.now() - t0;
      shown = still ? 4 : 0;
      fig.classList.remove('is-forward', 'is-halt', 'is-defect');
      if (still) { showSteps(); return; }
      var tick = function () { shown++; showSteps(); if (shown < 4) timer = setTimeout(tick, 550); };
      tick();
    }
    function bucketWords(b) {
      return { forwarded_safe: 'Forwarded: the proposal itself', recovered_from_unsafe: 'Forwarded: a recovered path', recovered_from_off_goal: 'Forwarded: a recovered path',
        halted_no_safe_path: 'Halted: no safe path exists', fallback_unsafe: 'Halted: the recovery failed re-verification' }[b] || b;
    }
    function showSteps() {
      var o = out, i;
      for (i = 0; i < 4; i++) { el.steps[i].className = 'sl-step'; el.steps[i].querySelector('.sl-out').textContent = ''; }
      el.decision.textContent = ''; el.detail.textContent = ''; el.match.hidden = true; el.ms.textContent = '';
      if (!o) { el.decision.textContent = 'Not run yet'; render(); return; }
      var S = el.steps, set = function (k, cls, text) { S[k].className = 'sl-step ' + cls; S[k].querySelector('.sl-out').textContent = text; };
      if (shown >= 1) set(0, o.llm.safe ? 'is-pass' : 'is-fail', o.llm.safe ? 'safe' : o.llm.violation.replace('_', ' ') + ' at waypoint ' + o.llm.index);
      if (shown >= 2) set(1, o.llmAtGoal ? 'is-pass' : 'is-fail', o.llmAtGoal ? 'ends at the goal' : 'ends ' + Math.hypot(traj[traj.length - 1].x - goal().x, traj[traj.length - 1].y - goal().y).toFixed(2) + ' m from the goal');
      if (o.bucket === 'forwarded_safe') {
        if (shown >= 3) { set(2, 'is-skip', 'not needed'); set(3, 'is-skip', 'not needed'); }
      } else {
        if (shown >= 3) set(2, o.fallback.length ? 'is-pass' : 'is-fail', o.fallback.length ? o.fallback.length + ' waypoints, ' + o.expanded + ' cells expanded' : 'no path: the goal is unreachable on the inflated grid');
        if (shown >= 4 && o.fallback.length) set(3, o.bucket.indexOf('recovered') === 0 ? 'is-pass' : 'is-fail', 'verifier ' + (o.fb.safe ? 'safe' : o.fb.violation) + ', reference checker ' + (o.oracle ? 'safe' : 'unsafe') + ', ' + (o.fbAtGoalText || 'at the goal'));
        else if (shown >= 4) set(3, 'is-skip', 'nothing to verify');
      }
      if (shown >= 4) {
        el.decision.textContent = bucketWords(o.bucket);
        el.detail.textContent = o.bucket === 'halted_no_safe_path' ? 'The shield forwards nothing and the robot stops. It does not invent a route.' :
          o.bucket === 'fallback_unsafe' ? 'The recovery failed one of the judges. Nothing is forwarded. This cell must stay empty; reaching it is a defect in the composition.' :
          o.bucket === 'forwarded_safe' ? 'The proposal passed the verifier and ends at the goal, so it goes to the controller as proposed.' :
          'The proposal was ' + (o.bucket === 'recovered_from_unsafe' ? 'unsafe' : 'safe but went to the wrong place') + '. The planner found a path on the footprint-inflated grid, both judges passed it, and it ends at the goal.';
        fig.classList.toggle('is-forward', o.forwarded); fig.classList.toggle('is-halt', !o.forwarded && o.bucket !== 'fallback_unsafe'); fig.classList.toggle('is-defect', o.bucket === 'fallback_unsafe');
        el.ms.textContent = 'decided in ' + o.ms.toFixed(2) + ' ms in this tab';
        var rec = recorded[scen.id], r = sealed ? rec.sealed : (edited ? null : rec);
        if (r) {
          var same = r.bucket === o.bucket && r.action === (o.forwarded ? 'forward' : 'halt') && (sealed || r.fallback_waypoints === o.fallback.length);
          el.match.textContent = 'The C++ shield recorded ' + r.bucket.replace(/_/g, ' ') + (sealed ? ' for this sealed map' : ', ' + r.action + (r.fallback_waypoints ? ', ' + r.fallback_waypoints + ' recovered waypoints' : '')) + '. This page computes the same' + (same ? '.' : ' bucket? No: please report this.');
          el.match.hidden = false; fig.classList.toggle('is-mismatch', !same);
        }
        el.said.textContent = el.decision.textContent + '. ' + el.detail.textContent;
      }
      render();
    }

    /* ---- drawing ---- */
    function render() {
      if (!grid) return;
      var W = canvas.width / dpr, H = canvas.height / dpr, i, x, y;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = colour.panel; ctx.fillRect(0, 0, W, H);
      var cells = grid.cells, gw = grid.width, gh = grid.height;
      /* the inflation the planner saw, faintly, once the plan step is shown */
      var infl = out && shown >= 3 && out.inflated ? out.inflated : null;
      for (y = 0; y < gh; y++) {
        var row = y * gw, py = Math.round((gh - 1 - y) * scale), ph = Math.round((gh - y) * scale) - py;
        for (x = 0; x < gw;) {
          var v = cells[row + x], iv = infl ? infl[row + x] : 0, key = v * 2 + (iv ? 1 : 0), x0 = x;
          while (x < gw && cells[row + x] === v && (infl ? (infl[row + x] ? 1 : 0) : 0) === (iv ? 1 : 0)) x++;
          if (!v && !iv) continue;
          if (v === UNKNOWN) { ctx.fillStyle = colour.neutral; ctx.globalAlpha = 0.35; }
          else if (v >= LETHAL) { ctx.fillStyle = colour.ink; ctx.globalAlpha = 1; }
          else { ctx.fillStyle = colour.accent; ctx.globalAlpha = 0.12; }
          ctx.fillRect(Math.round(x0 * scale), py, Math.round(x * scale) - Math.round(x0 * scale), ph);
        }
      }
      ctx.globalAlpha = 1;
      var r = Math.max(4, PARAMS.robot_radius / grid.res * scale);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      /* the proposal */
      if (traj.length) {
        var P = traj.map(toPx), failed = out && shown >= 1 && !out.llm.safe;
        ctx.globalAlpha = out && shown >= 3 && out.fallback.length ? 0.45 : 1;
        ctx.strokeStyle = failed ? colour.warn : (out && shown >= 1 ? colour.ok : colour.muted); ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); for (i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y); ctx.stroke(); ctx.setLineDash([]);
        if (failed && out.llm.point) { var q = toPx(out.llm.point); ctx.beginPath(); ctx.arc(q.x, q.y, r + 3, 0, 6.2832); ctx.strokeStyle = colour.warn; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      /* the recovery */
      if (out && shown >= 3 && out.fallback.length) {
        var F = out.fallback.map(toPx), ok = shown >= 4 && out.forwarded;
        ctx.strokeStyle = shown >= 4 ? (ok ? colour.accent : colour.warn) : colour.accent; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(F[0].x, F[0].y); for (i = 1; i < F.length; i++) ctx.lineTo(F[i].x, F[i].y); ctx.stroke();
      }
      var s = toPx(start()), g = toPx(goal());
      ctx.fillStyle = colour.ink; ctx.fillRect(s.x - 5, s.y - 5, 10, 10);
      ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, 6.2832); ctx.fillStyle = colour.accent; ctx.fill();
      ctx.beginPath(); ctx.arc(g.x, g.y, 8, 0, 6.2832); ctx.lineWidth = 2; ctx.strokeStyle = colour.accent; ctx.stroke();
      if (out && shown >= 4 && !out.forwarded) {
        ctx.font = '600 13px ' + getComputedStyle(fig).getPropertyValue('--mono'); ctx.fillStyle = colour.warn; ctx.fillText('HALT', s.x + 10, s.y + 5);
      }
    }

    /* ---- hands: paint walls to break the recovery, or seal the goal ---- */
    function paint(p) {
      var m = grid.worldToMap(p); if (!m) return;
      var bx = Math.floor(m[0] / 5) * 5, by = Math.floor(m[1] / 5) * 5, v = mode === 'wall' ? LETHAL : 0, changed = false;
      for (var y = by; y < by + 5 && y < grid.height; y++) for (var x = bx; x < bx + 5 && x < grid.width; x++) { if (grid.cells[y * grid.width + x] !== v) { grid.cells[y * grid.width + x] = v; changed = true; } }
      if (changed) { edited = true; sealed = false; fig.classList.add('is-edited'); out = null; shown = 0; showSteps(); }
    }
    function at(ev) { var r = canvas.getBoundingClientRect(); return toWorld(ev.clientX - r.left, ev.clientY - r.top); }
    canvas.addEventListener('pointerdown', function (ev) { if (mode === 'look') return; ev.preventDefault(); try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* gone */ } drag = true; paint(at(ev)); });
    canvas.addEventListener('pointermove', function (ev) { if (drag) paint(at(ev)); });
    var drop = function () { drag = false; }; canvas.addEventListener('pointerup', drop); canvas.addEventListener('pointercancel', drop);
    for (var m = 0; m < modes.length; m++) modes[m].addEventListener('click', function () {
      mode = this.getAttribute('data-mode');
      for (var j = 0; j < modes.length; j++) modes[j].setAttribute('aria-pressed', modes[j] === this ? 'true' : 'false');
      canvas.style.cursor = mode === 'look' ? 'default' : 'cell';
      say(mode === 'look' ? 'Press Run the shield.' : (mode === 'wall' ? 'Paint walls' : 'Erase') + ': ' + (touch ? 'tap or drag' : 'click or drag') + ' on the map, then run the shield again.');
    });
    for (var a = 0; a < acts.length; a++) acts[a].addEventListener('click', function () {
      var w = this.getAttribute('data-act');
      if (w === 'run') run();
      else if (w === 'seal') { grid = sealGoal(grid, goal()); sealed = true; edited = false; fig.classList.add('is-edited'); out = null; shown = 0; showSteps(); say('The goal is walled in. Run the shield: the only right answer is a halt.'); }
      else if (w === 'reset') { grid.cells.set(base); edited = false; sealed = false; fig.classList.remove('is-edited'); out = null; shown = 0; showSteps(); say('Map restored.'); }
    });
    el.scenario.addEventListener('change', function () { load(+this.value); });
    function say(t) { el.hint.textContent = t; }

    if (window.MutationObserver) new MutationObserver(function () { readColours(); render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.ResizeObserver) new ResizeObserver(function () { size(); }).observe(stage); else window.addEventListener('resize', size);
    for (var i = 0; i < maps.length; i++) { var o = document.createElement('option'); o.value = i; o.textContent = 'Map ' + maps[i].id; el.scenario.appendChild(o); }
    readColours(); load(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
