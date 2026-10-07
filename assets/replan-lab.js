/* The replanning figure in the Engineering section.
 *
 * A small D* Lite and a small A*, side by side on one grid, in the visitor's
 * browser. The robot drives; when a wall lands on its route, D* Lite repairs
 * the plan it already has, and A* is run from scratch on the same map so the
 * two amounts of work can be put next to each other.
 *
 * It is a toy and the page says so. It is not the C++ planning core and the
 * numbers it shows are not the benchmark's. Two things it keeps from the real
 * one, because they are the point of it:
 *
 *   1. Every cost is an integer (10 for a straight step, 14 for a diagonal),
 *      so every key comparison in D* Lite is exact. Floating point ties are
 *      what break it.
 *   2. After every replan the two planners' path costs are compared, and the
 *      figure reports how many times they were equal. The C++ core is held
 *      to that against Dijkstra; here it happens while you watch.
 *
 * The planning half has no DOM in it and is exported for node, where
 * tools/test_replan_lab.js checks it against Dijkstra over random maps.
 */
(function () {
  'use strict';

  var INF = 1073741823;
  var STRAIGHT = 10, DIAGONAL = 14;
  var DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

  /* ------------------------------------------------------------------ *
   * A binary heap of [k1, k2, cell]. Entries are never removed from the
   * middle: each cell carries a ticket, and an entry whose ticket is out
   * of date is skipped when it reaches the top.
   * ------------------------------------------------------------------ */
  function Heap() { this.a = []; }
  Heap.prototype.less = function (i, j) {
    var x = this.a[i], y = this.a[j];
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  };
  Heap.prototype.push = function (e) {
    var a = this.a, i = a.length; a.push(e);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      var t = a[i]; a[i] = a[p]; a[p] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (var i = 0; ;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        var t = a[i]; a[i] = a[m]; a[m] = t; i = m;
      }
    }
    return top;
  };

  /* ------------------------------------------------------------------ *
   * The grid. Eight-connected; a diagonal step is allowed only when both
   * cells it squeezes between are free, so the robot never cuts a corner.
   * ------------------------------------------------------------------ */
  function Grid(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.wall = new Uint8Array(cols * rows);
  }
  Grid.prototype.cost = function (u, v) {
    var w = this.wall;
    if (w[u] || w[v]) return INF;
    var c = this.cols, ux = u % c, uy = (u - ux) / c, vx = v % c, vy = (v - vx) / c;
    if (ux !== vx && uy !== vy) {
      if (w[uy * c + vx] || w[vy * c + ux]) return INF;
      return DIAGONAL;
    }
    return STRAIGHT;
  };
  Grid.prototype.around = function (u, out) {
    var c = this.cols, x = u % c, y = (u - x) / c, n = 0;
    for (var i = 0; i < 8; i++) {
      var nx = x + DX[i], ny = y + DY[i];
      if (nx >= 0 && ny >= 0 && nx < c && ny < this.rows) out[n++] = ny * c + nx;
    }
    return n;
  };
  function octile(cols, u, v) {
    var ux = u % cols, vx = v % cols;
    var dx = Math.abs(ux - vx), dy = Math.abs((u - ux) / cols - (v - vx) / cols);
    return STRAIGHT * Math.max(dx, dy) + (DIAGONAL - STRAIGHT) * Math.min(dx, dy);
  }

  /* ------------------------------------------------------------------ *
   * D* Lite, after Koenig and Likhachev. It searches backwards from the
   * goal, so everything it has learned stays true as the robot moves.
   * ------------------------------------------------------------------ */
  function DStarLite(grid, start, goal) {
    var n = grid.cols * grid.rows;
    this.grid = grid; this.start = start; this.last = start; this.goal = goal; this.km = 0;
    this.g = new Int32Array(n).fill(INF);
    this.rhs = new Int32Array(n).fill(INF);
    this.ticket = new Int32Array(n);      /* 0: not queued */
    this.next = 1;
    this.open = new Heap();
    this.nb = new Int32Array(8);
    this.touched = [];                    /* cells expanded by the latest compute() */
    this.rhs[goal] = 0;
    this.queue(goal);
  }
  DStarLite.prototype.queue = function (u) {
    var m = Math.min(this.g[u], this.rhs[u]);
    this.ticket[u] = this.next++;
    this.open.push([m >= INF ? INF : m + octile(this.grid.cols, this.start, u) + this.km, m, u, this.ticket[u]]);
  };
  DStarLite.prototype.update = function (u) {
    if (u !== this.goal) {
      var nb = new Int32Array(8), k = this.grid.around(u, nb), best = INF;
      for (var i = 0; i < k; i++) {
        var c = this.grid.cost(u, nb[i]);
        if (c < INF && this.g[nb[i]] < INF && c + this.g[nb[i]] < best) best = c + this.g[nb[i]];
      }
      this.rhs[u] = best;
    }
    this.ticket[u] = 0;
    if (this.g[u] !== this.rhs[u]) this.queue(u);
  };
  DStarLite.prototype.compute = function () {
    var open = this.open, g = this.g, rhs = this.rhs, cols = this.grid.cols;
    var nb = this.nb, touched = this.touched = [];
    for (;;) {
      /* drop entries that have been superseded */
      while (open.a.length && open.a[0][3] !== this.ticket[open.a[0][2]]) open.pop();
      var s = this.start, ms = Math.min(g[s], rhs[s]);
      var sk1 = ms >= INF ? INF : ms + this.km, sk2 = ms;
      if (!open.a.length) break;
      var top = open.a[0];
      var before = top[0] < sk1 || (top[0] === sk1 && top[1] < sk2);
      if (!before && rhs[s] === g[s]) break;
      open.pop();
      var u = top[2];
      this.ticket[u] = 0;
      var m = Math.min(g[u], rhs[u]);
      var k1 = m >= INF ? INF : m + octile(cols, s, u) + this.km;
      if (top[0] < k1 || (top[0] === k1 && top[1] < m)) { this.queue(u); continue; }   /* its key was stale */
      touched.push(u);
      var k = this.grid.around(u, nb), i;
      if (g[u] > rhs[u]) {
        g[u] = rhs[u];
        for (i = 0; i < k; i++) this.update(nb[i]);
      } else {
        g[u] = INF;
        this.update(u);
        k = this.grid.around(u, nb);
        for (i = 0; i < k; i++) this.update(nb[i]);
      }
    }
    return touched;
  };
  /* The robot has moved to `cell`. */
  DStarLite.prototype.moveTo = function (cell) { this.start = cell; };
  /* The cell `u` has just become a wall, or stopped being one. The grid
     already says so. Every edge whose cost that changes starts at the cell
     or at one of its eight neighbours, so those are the vertices to update. */
  DStarLite.prototype.changed = function (u) {
    this.km += octile(this.grid.cols, this.last, this.start);
    this.last = this.start;
    var nb = new Int32Array(8), k = this.grid.around(u, nb);
    this.update(u);
    for (var i = 0; i < k; i++) this.update(nb[i]);
  };
  DStarLite.prototype.cost = function () { return this.g[this.start]; };
  /* The path from the robot to the goal: at each cell, step to whichever
     neighbour makes the remaining cost smallest. */
  DStarLite.prototype.path = function () {
    var out = [this.start], u = this.start, nb = new Int32Array(8), guard = this.g.length;
    if (this.g[u] >= INF) return null;
    while (u !== this.goal && guard-- > 0) {
      var k = this.grid.around(u, nb), best = INF, to = -1;
      for (var i = 0; i < k; i++) {
        var c = this.grid.cost(u, nb[i]);
        if (c < INF && this.g[nb[i]] < INF && c + this.g[nb[i]] < best) { best = c + this.g[nb[i]]; to = nb[i]; }
      }
      if (to < 0) return null;
      u = to; out.push(u);
    }
    return u === this.goal ? out : null;
  };

  /* ------------------------------------------------------------------ *
   * A*, from scratch every time it is asked. Ties go to the entry further
   * along, which is the kind choice: it makes A* look as good as it can.
   * ------------------------------------------------------------------ */
  function astar(grid, start, goal) {
    var n = grid.cols * grid.rows, cols = grid.cols;
    var g = new Int32Array(n).fill(INF), closed = new Uint8Array(n);
    var open = new Heap(), nb = new Int32Array(8), expanded = [];
    g[start] = 0;
    open.push([octile(cols, start, goal), 0, start]);
    while (open.a.length) {
      var top = open.pop(), u = top[2];
      if (closed[u]) continue;
      closed[u] = 1; expanded.push(u);
      if (u === goal) break;
      var k = grid.around(u, nb);
      for (var i = 0; i < k; i++) {
        var v = nb[i], c = grid.cost(u, v);
        if (c >= INF || closed[v]) continue;
        if (g[u] + c < g[v]) {
          g[v] = g[u] + c;
          open.push([g[v] + octile(cols, v, goal), -g[v], v]);
        }
      }
    }
    return { cost: g[goal], expanded: expanded };
  }

  /* Plain Dijkstra from the goal. Only the tests use it: it is the referee. */
  function dijkstra(grid, goal) {
    var n = grid.cols * grid.rows, d = new Int32Array(n).fill(INF), done = new Uint8Array(n);
    var open = new Heap(), nb = new Int32Array(8);
    d[goal] = 0; open.push([0, 0, goal]);
    while (open.a.length) {
      var u = open.pop()[2];
      if (done[u]) continue;
      done[u] = 1;
      var k = grid.around(u, nb);
      for (var i = 0; i < k; i++) {
        var c = grid.cost(nb[i], u);
        if (c < INF && d[u] + c < d[nb[i]]) { d[nb[i]] = d[u] + c; open.push([d[nb[i]], 0, nb[i]]); }
      }
    }
    return d;
  }

  /* ------------------------------------------------------------------ *
   * The map: a row of rooms, each joined to the next by one door, with the
   * doors at alternate ends so the way through winds. That is what makes a
   * building hard for A*: the straight line to the goal runs into a wall,
   * and it has to flood the room to find the door. A little clutter on top.
   * The same size of grid always gets the same map.
   * ------------------------------------------------------------------ */
  function buildMap(cols, rows) {
    var grid = new Grid(cols, rows), seed = cols * 131 + rows * 17;
    var random = function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    var mid = rows >> 1, start = mid * cols + 1, goal = mid * cols + cols - 2;
    var walls = Math.max(2, Math.round(cols / 12)), doors = [], gap = 2, i, q;

    var reserved = new Uint8Array(cols * rows);
    var keep = function (cell, r) {
      var cx = cell % cols, cy = (cell - cx) / cols;
      for (var yy = cy - r; yy <= cy + r; yy++) for (var xx = cx - r; xx <= cx + r; xx++) {
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) reserved[yy * cols + xx] = 1;
      }
    };
    keep(start, 2); keep(goal, 2);

    for (i = 0; i < walls; i++) {
      var cx = Math.round(cols * (i + 1) / (walls + 1)), top = i % 2 === 0 ? 2 : rows - gap - 2, cells = [];
      for (var y = 0; y < rows; y++) grid.wall[y * cols + cx] = 1;
      for (q = 0; q < gap; q++) { var c = (top + q) * cols + cx; grid.wall[c] = 0; cells.push(c); keep(c, 2); }
      doors.push(cells);
    }

    var wanted = Math.round(cols * rows * 0.03), placed = 0, tries = 0;
    while (placed < wanted && tries++ < 4000) {
      var x = Math.floor(random() * cols), yy = Math.floor(random() * rows);
      var across = random() < 0.5, a = yy * cols + x, b = across ? a + 1 : a + cols;
      if ((across && x + 1 >= cols) || (!across && yy + 1 >= rows)) continue;
      if (grid.wall[a] || grid.wall[b] || reserved[a] || reserved[b]) continue;
      grid.wall[a] = 1; grid.wall[b] = 1;
      if (dijkstra(grid, goal)[start] >= INF) { grid.wall[a] = 0; grid.wall[b] = 0; continue; }
      placed++;
    }
    return { grid: grid, start: start, goal: goal, doors: doors };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Grid: Grid, DStarLite: DStarLite, astar: astar, dijkstra: dijkstra, buildMap: buildMap, INF: INF };
  }
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */
  var SPEED = 9;            /* cells a second */
  var WAVE = 420;           /* ms for a search to sweep across the cells it expanded */
  var GLOW = 1500, FADE = 1300;

  function boot() {
    var fig = document.getElementById('replanLab');
    if (!fig || !window.requestAnimationFrame) return;
    var $ = function (id) { return document.getElementById(id); };
    var stage = $('lab-stage'), canvas = $('lab-canvas'), ctx = canvas.getContext('2d');
    if (!ctx) return;
    var el = {
      d: $('lab-d'), a: $('lab-a'), barD: $('lab-bar-d'), barA: $('lab-bar-a'),
      ratio: $('lab-ratio'), ratioText: $('lab-ratio-text'),
      equal: $('lab-equal'), status: $('lab-status'), said: $('lab-said'),
      block: $('lab-block'), clear: $('lab-clear'), toggle: $('lab-toggle')
    };
    fig.hidden = false;

    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* a finger taps; dragging one scrolls the page */
    var how = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'Tap the map' : 'Click or drag on the map';
    if ($('lab-how')) $('lab-how').textContent = how;
    var colour = {}, cell = 20, cols = 0, rows = 0, dpr = 1;
    var map, grid, base, planner, path, from, to, t, goal, home;
    var added = {};           /* cell -> { at, auto } for walls that were not on the map to begin with */
    var flash = null, ghost = null, hover = -1, arrived = 0, steps = 0, autos = 0, lastAuto = 0;
    var lastTouch = -1e9, paused = still, inView = false, raf = 0, clock = 0;
    var stats = { replans: 0, d: 0, a: 0, equal: 0 };

    /* ---- colours come from the page's own tokens, so both themes work ---- */
    function readColours() {
      var cs = getComputedStyle(fig), names = ['panel', 'bg', 'line', 'ink', 'accent', 'warn', 'muted', 'neutral', 'track'];
      for (var i = 0; i < names.length; i++) colour[names[i]] = cs.getPropertyValue('--' + names[i]).trim() || '#888';
    }

    /* ---- the world ---- */
    function size() {
      var w = stage.clientWidth;
      if (!w) return false;
      var c = Math.max(16, Math.min(48, Math.round(w / 22))), r = c >= 40 ? 17 : 16;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cell = w / c;                              /* not a whole number: edge() keeps the cells crisp */
      canvas.style.width = w + 'px'; canvas.style.height = Math.round(cell * r) + 'px';
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(cell * r * dpr);
      if (c === cols && r === rows) return false;
      cols = c; rows = r;
      return true;
    }
    function build() {
      map = buildMap(cols, rows); grid = map.grid; base = grid.wall.slice();
      added = {}; home = map.start; goal = map.goal;
      trip(home, goal);
    }
    function trip(start, end) {
      goal = end; from = to = start; t = 0; steps = 0; autos = 0; arrived = 0;
      planner = new DStarLite(grid, start, end);
      planner.compute();
      path = planner.path();
    }
    function xy(c) { var x = c % cols; return { x: (x + 0.5) * cell, y: ((c - x) / cols + 0.5) * cell }; }
    function robotAt() {
      var a = xy(from), b = xy(to), e = t * t * (3 - 2 * t);
      return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
    }

    /* ---- changing the map ---- */
    function may(c) { return c >= 0 && c !== from && c !== to && c !== goal && c !== home; }
    function set(c, wall, auto) {
      if (!may(c) || !!grid.wall[c] === wall) return false;
      grid.wall[c] = wall ? 1 : 0;
      if (wall && !base[c]) added[c] = { at: clock, auto: !!auto };
      else delete added[c];
      planner.changed(c);
      return true;
    }
    function replan(why) {
      var touched = planner.compute();
      var before = path;
      path = planner.path();
      /* A wall that is not in the way changes nothing, and a robot would not
         replan for it. Only changes that move the route are counted, which
         is also what the benchmark does: its obstacles land on the path. */
      if (before && path && same(before, path)) {
        flash = { d: touched, a: [], at: clock };
        say('Off the route, so the plan stands. D* Lite looked at ' + touched.length + (touched.length === 1 ? ' cell' : ' cells') + ' to be sure.');
      } else if (!before && !path) {
        say('Still no route. Take a wall away.');
      } else {
        var scratch = astar(grid, planner.start, goal);
        stats.replans++; stats.d += touched.length; stats.a += scratch.expanded.length;
        if (scratch.cost === planner.cost()) stats.equal++;
        flash = { d: touched, a: scratch.expanded, at: clock };
        ghost = before ? { cells: before, at: clock } : null;
        report(touched.length, scratch.expanded.length, why);
      }
      if (why !== 'auto') el.said.textContent = el.status.textContent;
      if (still || paused) render();
    }
    function same(p, q) {
      /* q is the route from where the robot is now; p may still start a cell behind it */
      var off = p.indexOf(q[0]);
      if (off < 0 || p.length - off !== q.length) return false;
      for (var i = 0; i < q.length; i++) if (p[off + i] !== q[i]) return false;
      return true;
    }

    /* A short wall across the route, a few cells ahead of the robot. Never
       one that leaves no way through: shutting a door is the visitor's to try. */
    function blockAhead(auto) {
      if (!path || path.length < 8) return false;
      for (var k = 4; k < Math.min(path.length - 2, 12); k++) {
        var c = path[k], prev = path[k - 1], i;
        var x = c % cols, y = (c - x) / cols, px = prev % cols, py = (prev - px) / cols;
        var sx = y - py, sy = -(x - px);       /* across the direction of travel */
        if (sx && sy) { sx = 1; sy = 0; }
        var cells = [c];
        for (i = -1; i <= 1; i += 2) {
          var nx = x + sx * i, ny = y + sy * i;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) cells.push(ny * cols + nx);
        }
        cells = cells.filter(function (q) { return may(q) && !grid.wall[q]; });
        if (cells.length < 2) continue;
        for (i = 0; i < cells.length; i++) grid.wall[cells[i]] = 1;
        var open = dijkstra(grid, goal)[to] < INF;
        for (i = 0; i < cells.length; i++) grid.wall[cells[i]] = 0;
        if (!open) continue;
        for (i = 0; i < cells.length; i++) set(cells[i], true, auto);
        replan(auto ? 'auto' : 'button');
        return true;
      }
      return false;
    }
    function clearAdded(onlyAuto) {
      var any = false, c;
      for (c in added) if (!onlyAuto || added[c].auto) { any = set(+c, false) || any; }
      if (!onlyAuto) for (c = 0; c < base.length; c++) if (base[c] && !grid.wall[c]) any = set(c, true) || any;
      return any;
    }

    /* ---- words and numbers ---- */
    function report(d, a, why) {
      el.d.textContent = d; el.a.textContent = a;
      var top = Math.max(d, a, 1);
      el.barD.style.width = (d / top * 100).toFixed(1) + '%';
      el.barA.style.width = (a / top * 100).toFixed(1) + '%';
      if (stats.d > 0 && stats.a > 0) {
        var less = stats.a >= stats.d, r = less ? stats.a / stats.d : stats.d / stats.a;
        el.ratio.textContent = r.toFixed(1) + 'x';
        el.ratioText.textContent = (less ? 'less' : 'more') + ' searching for D* Lite than A*, over ' +
          stats.replans + (stats.replans === 1 ? ' replan' : ' replans');
      }
      el.equal.textContent = stats.equal + '/' + stats.replans;
      var text;
      if (!path) text = 'No route left. The planner says so and the robot waits. Take a wall away.';
      else text = (why === 'auto' ? 'A wall lands on the route. ' : why === 'clear' ? 'Walls cleared. ' : 'Replanned. ') +
        'D* Lite repaired ' + d + (d === 1 ? ' cell' : ' cells') + '; A* searched ' + a + ' for the same path.' +
        (d > a ? ' D* Lite did more work this time: that change undid most of what it knew.' : '');
      say(text);
    }
    function say(text) { if (el.status.textContent !== text) el.status.textContent = text; }

    /* ---- drawing ---- */
    function edge(i) { return Math.round(i * cell); }
    function box(c, inset) {
      var x = c % cols, y = (c - x) / cols, x0 = edge(x), y0 = edge(y);
      ctx.fillRect(x0 + inset, y0 + inset, edge(x + 1) - x0 - 2 * inset, edge(y + 1) - y0 - 2 * inset);
    }
    function line(points, width, style, dash) {
      if (points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.lineWidth = width; ctx.strokeStyle = style; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    function render() {
      var W = cols * cell, H = rows * cell, i, c, age;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colour.panel; ctx.fillRect(0, 0, W, H);

      /* what each planner had to look at: A*'s cloud underneath, D* Lite's patch on top */
      if (flash) {
        age = clock - flash.at;
        var fade = still ? 1 : age < GLOW ? 1 : Math.max(0, 1 - (age - GLOW) / FADE);
        var shown = still ? 1 : Math.min(1, age / WAVE);
        if (fade <= 0) flash = null;
        else {
          ctx.fillStyle = colour.neutral; ctx.globalAlpha = 0.24 * fade;
          for (i = 0; i < Math.ceil(flash.a.length * shown); i++) box(flash.a[i], 0);
          ctx.fillStyle = colour.accent; ctx.globalAlpha = 0.62 * fade;
          for (i = 0; i < Math.ceil(flash.d.length * shown); i++) box(flash.d[i], 1.5);
          ctx.globalAlpha = 1;
        }
      }

      ctx.strokeStyle = colour.line; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (i = 1; i < cols; i++) { ctx.moveTo(edge(i) + 0.5, 0); ctx.lineTo(edge(i) + 0.5, H); }
      for (i = 1; i < rows; i++) { ctx.moveTo(0, edge(i) + 0.5); ctx.lineTo(W, edge(i) + 0.5); }
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = colour.ink;
      for (c = 0; c < grid.wall.length; c++) if (grid.wall[c] && !added[c]) box(c, 0);
      ctx.fillStyle = colour.warn;
      for (c in added) {
        age = clock - added[c].at;
        box(+c, still || age > 160 ? 0 : (1 - age / 160) * cell * 0.4);
      }

      if (ghost) {
        age = clock - ghost.at;
        var g = still ? 0 : Math.max(0, 1 - age / (GLOW + FADE));
        if (g <= 0) ghost = null;
        else { ctx.globalAlpha = 0.75 * g; line(ghost.cells.map(xy), 1.5, colour.muted, [4, 5]); ctx.globalAlpha = 1; }
      }

      var here = robotAt();
      if (path) line([here].concat(path.map(xy)), Math.max(2.5, cell * 0.14), colour.accent);

      /* where it set out from, and where it is going */
      var h = xy(home), e = xy(goal), r = cell * 0.3;
      ctx.strokeStyle = colour.ink; ctx.lineWidth = 2;
      ctx.strokeRect(h.x - r, h.y - r, 2 * r, 2 * r);
      ctx.fillStyle = colour.accent;
      ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.55, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = colour.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, r * 1.25, 0, 6.2832); ctx.stroke();

      if (!still && !paused && path) {
        var beat = (clock % 1100) / 1100;
        ctx.globalAlpha = 0.3 * (1 - beat); ctx.fillStyle = colour.accent;
        ctx.beginPath(); ctx.arc(here.x, here.y, cell * (0.35 + 0.5 * beat), 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = path ? colour.accent : colour.warn;
      ctx.beginPath(); ctx.arc(here.x, here.y, cell * 0.34, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = colour.panel; ctx.lineWidth = 2; ctx.stroke();

      if (hover >= 0 && may(hover)) {
        var hx = hover % cols, hy = (hover - hx) / cols;
        ctx.strokeStyle = colour.ink; ctx.lineWidth = 1.5;
        ctx.strokeRect(edge(hx) + 1.5, edge(hy) + 1.5, edge(hx + 1) - edge(hx) - 3, edge(hy + 1) - edge(hy) - 3);
      }
    }

    /* ---- time ---- */
    function advance(dt) {
      if (arrived) {
        if (clock - arrived > 1100) {
          clearAdded(true);
          var next = goal; goal = home; home = next;
          trip(home, goal);
          say('Setting off again. ' + how + ' to build a wall.');
        }
        return;
      }
      if (from === to) {                        /* standing on a cell: take the next step, if there is one */
        if (!path || path.length < 2) return;
        to = path[1]; path = path.slice(1); planner.moveTo(to); t = 0;
      }
      var a = xy(from), b = xy(to), diagonal = a.x !== b.x && a.y !== b.y;
      t += dt / 1000 * SPEED / (diagonal ? 1.4 : 1);
      if (t < 1) return;
      from = to; t = 0; steps++;
      if (to === goal) { arrived = clock; say('Arrived. Turning round.'); return; }
      /* left alone, the figure throws a wall in the way itself, now and then */
      var quiet = clock - lastTouch > 7000;
      if (quiet && autos < 3 && steps >= 7 && clock - lastAuto > 3400 && path && path.length > 9) {
        if (blockAhead(true)) { autos++; lastAuto = clock; }
      }
    }
    function tick(now) {
      raf = 0;
      if (!inView || document.hidden) { tick.last = 0; return; }
      var dt = tick.last ? Math.min(64, now - tick.last) : 16;
      tick.last = now; clock += dt;
      if (!paused) advance(dt);
      render();
      if (!still || !paused) raf = requestAnimationFrame(tick);
    }
    function wake() { if (!raf && inView && !document.hidden && (!still || !paused)) raf = requestAnimationFrame(tick); }

    /* ---- hands ---- */
    function cellAt(ev) {
      var r = canvas.getBoundingClientRect();
      var x = Math.floor((ev.clientX - r.left) / r.width * cols), y = Math.floor((ev.clientY - r.top) / r.height * rows);
      return x < 0 || y < 0 || x >= cols || y >= rows ? -1 : y * cols + x;
    }
    var brush = null;         /* { wall: true | false, id, down: {x, y}, cell } while a pointer is down */
    function paint(c) {
      if (!brush || c < 0) return;
      if (set(c, brush.wall, false)) { lastTouch = clock; replan('hand'); }
    }
    canvas.addEventListener('pointerdown', function (ev) {
      var c = cellAt(ev);
      if (c < 0) return;
      brush = { wall: !grid.wall[c], id: ev.pointerId, x: ev.clientX, y: ev.clientY, cell: c, touch: ev.pointerType === 'touch' };
      fig.classList.add('is-touched');
      /* a finger might be starting a scroll, so a touch only counts when it lifts without moving */
      if (!brush.touch) { ev.preventDefault(); paint(c); }
    });
    canvas.addEventListener('pointermove', function (ev) {
      var c = cellAt(ev);
      if (ev.pointerType !== 'touch') { if (hover !== c) { hover = c; if (still || paused) render(); } }
      if (brush && brush.id === ev.pointerId && !brush.touch) paint(c);
    });
    canvas.addEventListener('pointerup', function (ev) {
      if (brush && brush.touch && Math.abs(ev.clientX - brush.x) + Math.abs(ev.clientY - brush.y) < 12) paint(brush.cell);
      brush = null;
    });
    canvas.addEventListener('pointercancel', function () { brush = null; });
    canvas.addEventListener('pointerleave', function () { hover = -1; if (still || paused) render(); });
    window.addEventListener('pointerup', function () { if (brush && !brush.touch) brush = null; });

    el.block.addEventListener('click', function () {
      lastTouch = clock;
      if (!blockAhead(false)) { say('Nowhere to put one just now: the robot is too close to the goal.'); el.said.textContent = el.status.textContent; }
    });
    el.clear.addEventListener('click', function () {
      lastTouch = clock;
      if (clearAdded(false)) replan('clear');
    });
    function label() {
      el.toggle.textContent = paused ? 'Play' : 'Pause';
      el.toggle.setAttribute('aria-pressed', paused ? 'false' : 'true');
    }
    el.toggle.addEventListener('click', function () {
      paused = !paused; label();
      if (paused) render(); else wake();
    });

    /* ---- staying in step with the page ---- */
    function restyle() { readColours(); render(); }
    if (window.MutationObserver) {
      new MutationObserver(restyle).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    if (window.matchMedia) {
      var dark = window.matchMedia('(prefers-color-scheme: dark)');
      if (dark.addEventListener) dark.addEventListener('change', restyle);
    }
    var resized = function () { if (size()) build(); render(); };
    if (window.ResizeObserver) new ResizeObserver(resized).observe(stage);
    else window.addEventListener('resize', resized);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView) wake();
      }, { threshold: 0.2 }).observe(fig);
    } else { inView = true; }
    document.addEventListener('visibilitychange', wake);

    readColours(); size(); build(); label(); render();
    say(still ? how + ' to build a wall, or press play.' : 'Driving. ' + how + ' to build a wall.');
    wake();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
