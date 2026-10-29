/* The certified intervals, explored.
 *
 * legibility-bounds proves, for each world and path budget, a floor (a
 * trajectory that exists and scores this much) and a ceiling (a bound
 * nothing can exceed). The lattice behind each ceiling takes up to about
 * 23 seconds of Python per world, so the page does not rebuild it; it shows
 * the committed intervals from results/suite_bounds.json and lets the
 * visitor place a planner's score against them.
 *
 * tools/test_bounds_lab.js requires the served data to equal the committed
 * suite row for row, and the summary below to give the figures the page
 * states.
 */
(function () {
  'use strict';
  function summarise(rows) {
    var worlds = [], widest = null, narrowest = null, violations = 0;
    rows.forEach(function (r) {
      if (worlds.indexOf(r.scenario) < 0) worlds.push(r.scenario);
      if (!widest || r.gap > widest.gap) widest = r;
      if (!narrowest || r.gap < narrowest.gap) narrowest = r;
      if (r.achieved > r.bound || r.shortest > r.bound) violations++;
    });
    return { worlds: worlds, rows: rows.length, widest: widest, narrowest: narrowest, violations: violations };
  }
  /* where a planner's score lands against one certified interval */
  function grade(row, score) {
    if (!(score >= 0)) return { where: 'none' };
    if (score > row.bound) return { where: 'above', by: score - row.bound };
    if (score >= row.achieved) return { where: 'inside', by: score - row.achieved };
    return { where: 'below', by: row.achieved - score };
  }
  var api = { summarise: summarise, grade: grade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BoundsLab = api;

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */
  if (typeof document === 'undefined') return;

  function boot() {
    var fig = document.getElementById('boundsLab'), data = window.BOUNDS_LAB_DATA;
    if (!fig || !data) return;
    var $ = function (id) { return document.getElementById(id); };
    var el = { world: $('bl-world'), budgets: $('bl-budgets'), score: $('bl-score'), stage: $('bl-stage'), canvas: $('bl-canvas'), hint: $('bl-hint'),
      floor: $('bl-floor'), ceil: $('bl-ceil'), width: $('bl-width'), short: $('bl-short'), verdict: $('bl-verdict'), verdictText: $('bl-verdict-text'), tally: $('bl-tally'), said: $('bl-said') };
    fig.hidden = false;
    var ctx = el.canvas.getContext('2d'), colour = {}, dpr = 1, world = 'fan_middle', ceiling = 1.25, score = NaN, sum = summarise(data.rows);
    var BUDGETS = [1.05, 1.1, 1.25, 1.5], WORDS = { door_pair: 'two doors', pillar_aisle: 'a pillar in an aisle', open_pair: 'two goals in the open', keep_out_shortcut: 'a keep-out zone across the shortcut', narrow_gap: 'a narrow gap', fan_outer: 'a fan of goals, outer target', wall_choice: 'a wall between two goals', fan_middle: 'a fan of goals, middle target' };

    function readColours() {
      var cs = getComputedStyle(fig), names = ['panel', 'bg', 'line', 'ink', 'accent', 'warn', 'muted', 'ok', 'track'];
      for (var i = 0; i < names.length; i++) colour[names[i]] = cs.getPropertyValue('--' + names[i]).trim() || '#888';
    }
    function rowsOf(w) { return data.rows.filter(function (r) { return r.scenario === w; }).sort(function (a, b) { return a.ceiling - b.ceiling; }); }
    function current() { return rowsOf(world).filter(function (r) { return r.ceiling === ceiling; })[0]; }
    function size() {
      var w = el.stage.clientWidth; if (!w) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      var h = 200;
      el.canvas.style.width = w + 'px'; el.canvas.style.height = h + 'px';
      el.canvas.width = Math.round(w * dpr); el.canvas.height = Math.round(h * dpr);
      render();
    }
    function render() {
      var W = el.canvas.width, H = el.canvas.height, rows = rowsOf(world), left = 64 * dpr, right = W - 16 * dpr, top = 14 * dpr, rowH = (H - 40 * dpr) / rows.length;
      var x = function (v) { return left + v * (right - left); };
      var mono = (getComputedStyle(fig).getPropertyValue('--mono') || 'monospace');
      ctx.fillStyle = colour.panel; ctx.fillRect(0, 0, W, H);
      ctx.font = (11 * dpr) + 'px ' + mono; ctx.textBaseline = 'middle';
      /* axis */
      ctx.strokeStyle = colour.line; ctx.lineWidth = dpr; ctx.beginPath();
      for (var t = 0; t <= 10; t++) { ctx.moveTo(x(t / 10), top); ctx.lineTo(x(t / 10), H - 24 * dpr); }
      ctx.stroke();
      ctx.fillStyle = colour.muted; ctx.textAlign = 'center';
      for (t = 0; t <= 10; t += 2) ctx.fillText((t / 10).toFixed(1), x(t / 10), H - 12 * dpr);
      rows.forEach(function (r, i) {
        var y = top + rowH * (i + 0.5), on = r.ceiling === ceiling;
        ctx.fillStyle = on ? colour.ink : colour.muted; ctx.textAlign = 'right'; ctx.fillText(r.ceiling.toFixed(2) + 'x', left - 10 * dpr, y);
        ctx.strokeStyle = on ? colour.accent : colour.track; ctx.lineWidth = (on ? 8 : 5) * dpr; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(x(r.achieved), y); ctx.lineTo(x(r.bound), y); ctx.stroke();
        ctx.fillStyle = on ? colour.accent : colour.muted;
        ctx.beginPath(); ctx.arc(x(r.achieved), y, 5 * dpr, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x(r.bound), y - 6 * dpr); ctx.lineTo(x(r.bound) + 6 * dpr, y); ctx.lineTo(x(r.bound), y + 6 * dpr); ctx.lineTo(x(r.bound) - 6 * dpr, y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = on ? colour.ink : colour.muted; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(x(r.shortest), y - 9 * dpr); ctx.lineTo(x(r.shortest), y + 9 * dpr); ctx.stroke();
      });
      if (score >= 0 && score <= 1) {
        var g = grade(current(), score), col = g.where === 'above' ? colour.warn : g.where === 'inside' ? colour.ok : colour.ink;
        ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.beginPath(); ctx.moveTo(x(score), top); ctx.lineTo(x(score), H - 24 * dpr); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.textAlign = score > 0.85 ? 'right' : 'left'; ctx.fillText('your planner ' + score.toFixed(3), x(score) + (score > 0.85 ? -6 : 6) * dpr, top + 2 * dpr);
      }
    }
    function update() {
      var r = current(); if (!r) return;
      el.floor.textContent = r.achieved.toFixed(4); el.ceil.textContent = r.bound.toFixed(4); el.width.textContent = r.gap.toFixed(4); el.short.textContent = r.shortest.toFixed(4);
      el.hint.textContent = world + ' (' + WORDS[world] + ') at a ' + Math.round((r.ceiling - 1) * 100) + ' per cent path budget: a trajectory scoring ' + r.achieved.toFixed(4) + ' exists (' + r.achieved_source + '), nothing can exceed ' + r.bound.toFixed(4) + ', and the true optimum is somewhere in between. ' +
        (r.has_obstacles ? r.band_cells + ' band cells certified, ' + r.uncertified_cells + ' uncertified. ' : 'No obstacles. ') + 'Lattice built in ' + r.lattice_seconds.toFixed(1) + ' s upstream.';
      var g = grade(r, score), word, text;
      if (g.where === 'none') { word = 'Type a score'; text = 'Enter the legibility a planner reached in this world, and the interval says what that number means.'; }
      else if (g.where === 'above') { word = 'Impossible'; text = 'Above the certified ceiling by ' + g.by.toFixed(4) + '. No trajectory within this budget scores that: the planner broke the budget, or scored against a different observer, or its number is wrong. A bound is a certificate, not an estimate.'; }
      else if (g.where === 'inside') { word = 'Inside the band'; text = g.by.toFixed(4) + ' above the proven floor, within ' + (r.bound - score).toFixed(4) + ' of the ceiling. Nothing can do more than ' + (r.bound - score).toFixed(4) + ' better than this planner here, whatever optimiser comes next.'; }
      else { word = 'Below the floor'; text = g.by.toFixed(4) + ' under a trajectory that is known to exist. The room to improve is real, and at most ' + (r.bound - score).toFixed(4) + '.' + (score < r.shortest ? ' This is even below the shortest path, which scores ' + r.shortest.toFixed(4) + ' without trying.' : ''); }
      el.verdict.textContent = word; el.verdictText.textContent = text;
      fig.className = fig.className.replace(/\bis-(safe|unsafe|neutral)\b/g, '').trim() + (g.where === 'above' ? ' is-unsafe' : g.where === 'inside' ? ' is-safe' : '');
      el.said.textContent = word + '. ' + text;
      render();
    }
    function tallyText() {
      el.tally.textContent = 'Over all ' + sum.rows + ' committed rows, ' + sum.worlds.length + ' worlds by four budgets, read in this tab just now: ' + sum.violations + ' violations, widest interval ' + sum.widest.gap.toFixed(4) + ' (' + sum.widest.scenario + ' at ' + sum.widest.ceiling.toFixed(2) + 'x), narrowest ' + sum.narrowest.gap.toFixed(4) + ' (' + sum.narrowest.scenario + ' at ' + sum.narrowest.ceiling.toFixed(2) + 'x). Geometry commit ' + data.geometry_commit.slice(0, 7) + ', observer ' + data.observer + '.';
    }
    sum.worlds.forEach(function (w) { var o = document.createElement('option'); o.value = w; o.textContent = w; el.world.appendChild(o); });
    el.world.value = world;
    BUDGETS.forEach(function (b) {
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'lab-btn'; btn.textContent = '+' + Math.round((b - 1) * 100) + '%'; btn.setAttribute('aria-pressed', String(b === ceiling)); btn.setAttribute('aria-label', 'Path budget ' + b.toFixed(2) + ' times the shortest');
      btn.addEventListener('click', function () { ceiling = b; Array.prototype.forEach.call(el.budgets.children, function (c) { c.setAttribute('aria-pressed', String(c === btn)); }); update(); });
      el.budgets.appendChild(btn);
    });
    el.world.addEventListener('change', function () { world = this.value; update(); });
    el.score.addEventListener('input', function () { score = this.value === '' ? NaN : +this.value; update(); });
    readColours();
    if (window.MutationObserver) new MutationObserver(function () { readColours(); render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.ResizeObserver) new ResizeObserver(function () { size(); }).observe(el.stage); else window.addEventListener('resize', size);
    tallyText(); update(); size();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
