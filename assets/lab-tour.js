/* The walk through the demos.
 *
 * Every project page with a live figure gets the same two things from this
 * file: a "Show me" button that drives the figure through a short scripted
 * sequence for visitors who would rather watch first, and a "Next demo"
 * link under the figure so the eight demos can be walked in a row. The
 * sequences only press the figure's own controls and type into its own
 * fields; nothing here knows how a figure works inside.
 */
(function () {
  'use strict';
  var TOUR = [
    { page: 'llm-safety-verifier', lab: 'verifierLab', title: 'the safety verifier' },
    { page: 'llm-nav-shield', lab: 'shieldLab', title: 'the navigation shield' },
    { page: 'esp32-motion-detector', lab: 'esp32Lab', title: 'the ESP32 motion firmware' },
    { page: 'plan-failure-bench', lab: 'plannerLab', title: 'the plan checker' },
    { page: 'toolcall-contract', lab: 'contractLab', title: 'the tool-call validator' },
    { page: 'exact-predicates', lab: 'predicatesLab', title: 'the exact predicates' },
    { page: 'legibility-bounds', lab: 'boundsLab', title: 'the certified intervals' },
    { page: '../index.html#replanLab', lab: 'replanLab', title: 'D* Lite against A* on the home page' }
  ];
  var $ = function (id) { return document.getElementById(id); };
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function set(id, value, type) { var el = $(id); if (!el) return; el.value = value; fire(el, type || 'input'); }
  function click(sel) { var el = document.querySelector(sel); if (el) el.click(); }
  function typeInto(id, text, done) {
    var el = $(id); if (!el) { done(); return; }
    el.value = ''; var i = 0;
    (function step() { if (i >= text.length) { done(); return; } el.value += text.slice(i, i + 6); i += 6; fire(el, 'input'); setTimeout(step, 18); })();
  }
  var HALLWAY = '{"plan": [{"action": "goto", "args": ["kitchen"]}, {"action": "pick", "args": ["glass_water"]}, {"action": "goto", "args": ["hallway"]}, {"action": "goto", "args": ["living_room"]}, {"action": "place", "args": ["glass_water"]}]}';
  var AROUND = '{"plan": [{"action": "goto", "args": ["kitchen"]}, {"action": "open", "args": ["d_kitchen_living"]}, {"action": "pick", "args": ["glass_water"]}, {"action": "goto", "args": ["living_room"]}, {"action": "place", "args": ["glass_water"]}]}';

  /* each sequence is a list of [delay before, action] */
  var SHOWS = {
    verifierLab: [[0, function () { set('vl-scenario', '1', 'change'); click('[data-load="llama"]'); }], [2600, function () { click('[data-load="qwen"]'); }], [2600, function () { set('vl-scenario', '3', 'change'); click('[data-load="qwen"]'); }], [2600, function () { set('vl-scenario', '1', 'change'); click('[data-load="llama"]'); }]],
    shieldLab: [[0, function () { click('#sl-run'); }], [4200, function () { click('#sl-seal'); }], [900, function () { click('#sl-run'); }]],
    plannerLab: [[0, function () { set('pl2-env', 'house_01', 'change'); set('pl2-seed', '26', 'change'); set('pl2-model', 'local_qwen', 'change'); }],
      [2600, function (next) { typeInto('pl2-text', HALLWAY, next); }], [3200, function (next) { typeInto('pl2-text', AROUND, next); }]],
    contractLab: [[0, function () { click('#cl-reset'); }], [2200, function () { var t = $('cl-text'); if (t) { t.value = t.value.replace(/"tool"\s*:\s*"([^"]+)"/, '"tool": "$1_v2"'); fire(t, 'input'); } }],
      [2600, function () { var t = $('cl-text'); if (t) { t.value = t.value.replace(/"arguments"\s*:\s*\{/, '"arguments": {"limit": -1, '); fire(t, 'input'); } }], [2600, function () { click('#cl-reset'); }]],
    predicatesLab: [[0, function () { set('pl-case', '0'); }], [2000, function () { set('pl-case', '200'); }], [2000, function () { set('pl-case', '399'); }], [2000, function () { click('#pl-reset'); }]],
    boundsLab: [[0, function () { set('bl-score', '0.43'); }], [2200, function () { set('bl-score', '0.47'); }], [2200, function () { set('bl-score', '0.6'); }], [2200, function () { set('bl-score', '0.47'); }]]
  };
  /* where each figure opens: the case that makes its point */
  var STARTS = {
    verifierLab: function () { set('vl-scenario', '1', 'change'); click('[data-load="llama"]'); },
    shieldLab: function () { setTimeout(function () { click('#sl-run'); }, 500); },
    plannerLab: function () { set('pl2-seed', '26', 'change'); set('pl2-model', 'local_qwen', 'change'); },
    contractLab: function () { var sel = $('cl-task'), b = $('cl-bucket'); if (!sel || !b) return; for (var i = 0; i < sel.options.length; i++) { sel.value = String(i); fire(sel, 'change'); if (/contract/i.test(b.textContent)) return; } sel.value = '0'; fire(sel, 'change'); },
    boundsLab: function () { set('bl-score', '0.47'); }
  };

  function boot() {
    var here = -1;
    for (var i = 0; i < TOUR.length; i++) if ($(TOUR[i].lab)) here = i;
    if (here < 0) return;
    var fig = $(TOUR[here].lab), id = TOUR[here].lab;
    if (fig.hidden) return;
    if (STARTS[id]) STARTS[id]();
    var bar = fig.querySelector('.lab-bar');
    if (bar && SHOWS[id]) {
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'lab-btn lab-show'; btn.textContent = 'Show me';
      var running = false;
      btn.addEventListener('click', function () {
        if (running) return; running = true; btn.setAttribute('aria-pressed', 'true');
        var steps = SHOWS[id], k = 0;
        (function run() {
          if (k >= steps.length) { running = false; btn.setAttribute('aria-pressed', 'false'); return; }
          var st = steps[k++];
          setTimeout(function () { var waited = false, next = function () { if (!waited) { waited = true; run(); } }; if (st[1].length) st[1](next); else { st[1](); next(); } }, st[0]);
        })();
      });
      bar.appendChild(btn);
    }
    var nx = TOUR[(here + 1) % TOUR.length], p = document.createElement('p'); p.className = 'lab-next';
    var href = nx.page.indexOf('/') >= 0 ? nx.page : nx.page + '.html#try';
    p.innerHTML = '<span>Demo ' + (here + 1) + ' of ' + TOUR.length + '.</span> <a href="' + href + '">Next: ' + nx.title + ' &rarr;</a> <a href="../index.html#try">All eight</a>';
    fig.parentNode.insertBefore(p, fig.nextSibling);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
