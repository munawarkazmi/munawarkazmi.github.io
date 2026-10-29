/* The checker, in the browser.
 *
 * A port of checker.py, dsl.py and schema.py from plan-failure-bench: a
 * response is parsed under the same strict policy (one JSON object, at
 * most one code fence), statically scanned for unknown actions and
 * entities, then simulated step by step against the environment, and the
 * verdict is decided in the same order the Python decides it.
 *
 * tools/test_planner_lab.js runs every committed model response in the
 * repository's results through this port and requires the verdict the
 * checker recorded for it.
 */
(function () {
  'use strict';
  var GLOBAL_ACTIONS = ['goto', 'open', 'close', 'pick', 'place', 'unlock'];
  var INFEASIBLE_REASONS = ['unreachable', 'missing_capability', 'constraint'];
  var ARITY = { goto: 1, open: 1, close: 1, pick: 1, place: 1, unlock: 1 };

  function DslError(msg) { this.name = 'DslError'; this.message = msg; }
  DslError.prototype = Object.create(Error.prototype);
  function pyrepr(v) {
    if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    if (Array.isArray(v)) return '[' + v.map(pyrepr).join(', ') + ']';
    if (v === null) return 'None'; if (v === true) return 'True'; if (v === false) return 'False';
    if (typeof v === 'object') return '{' + Object.keys(v).map(function (k) { return pyrepr(k) + ': ' + pyrepr(v[k]); }).join(', ') + '}';
    return String(v);
  }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function sameKeys(obj, keys) { var k = Object.keys(obj).sort(); return k.length === keys.length && k.every(function (x, i) { return x === keys.slice().sort()[i]; }); }
  function nonEmptyStrings(a) { return Array.isArray(a) && a.every(function (s) { return typeof s === 'string' && s; }); }

  function stripFence(text) {
    text = text.trim();
    var lines = text.split(/\r?\n/);
    if (lines.length >= 2 && lines[0].indexOf('```') === 0 && lines[lines.length - 1].trim() === '```') return lines.slice(1, -1).join('\n');
    return text;
  }
  function parseStep(obj, index) {
    var where = 'plan[' + index + ']';
    if (!isObj(obj)) throw new DslError(where + ': expected an object, got ' + pyrepr(obj));
    if (!sameKeys(obj, ['action', 'args'])) throw new DslError(where + ": expected exactly the keys 'action' and 'args', got " + pyrepr(Object.keys(obj).sort()));
    var action = obj.action, args = obj.args;
    if (typeof action !== 'string' || !action) throw new DslError(where + '.action: expected a non-empty string, got ' + pyrepr(action));
    if (!nonEmptyStrings(args)) throw new DslError(where + '.args: expected a list of non-empty strings, got ' + pyrepr(args));
    if (action in ARITY && args.length !== ARITY[action]) throw new DslError(where + ': ' + action + ' takes ' + ARITY[action] + ' argument(s), got ' + args.length);
    return { action: action, args: args.slice() };
  }
  function parseResponse(text) {
    var raw;
    try { raw = JSON.parse(stripFence(text)); } catch (e) { throw new DslError('not valid JSON: ' + e.message); }
    if (!isObj(raw)) throw new DslError('top level must be an object, got ' + (Array.isArray(raw) ? 'list' : raw === null ? 'NoneType' : typeof raw));
    var keys = Object.keys(raw);
    if (keys.length === 1 && keys[0] === 'plan') {
      if (!Array.isArray(raw.plan)) throw new DslError("'plan' must be a list, got " + pyrepr(raw.plan));
      return { kind: 'plan', steps: raw.plan.map(parseStep) };
    }
    if (keys.length === 1 && keys[0] === 'infeasible') {
      var body = raw.infeasible;
      if (!isObj(body) || !sameKeys(body, ['reason'])) throw new DslError("'infeasible' must be an object with exactly the key 'reason', got " + pyrepr(body));
      if (INFEASIBLE_REASONS.indexOf(body.reason) < 0) throw new DslError('infeasible reason must be one of ' + pyrepr(INFEASIBLE_REASONS) + ', got ' + pyrepr(body.reason));
      return { kind: 'infeasible', reason: body.reason };
    }
    if (keys.length === 1 && keys[0] === 'clarify') {
      var b = raw.clarify;
      if (!isObj(b) || !sameKeys(b, ['candidates'])) throw new DslError("'clarify' must be an object with exactly the key 'candidates', got " + pyrepr(b));
      var c = b.candidates;
      if (!nonEmptyStrings(c)) throw new DslError("'candidates' must be a list of non-empty strings, got " + pyrepr(c));
      if (c.length < 2) throw new DslError("'candidates' must name at least two items; one candidate is not an ambiguity");
      var seen = {}; for (var i = 0; i < c.length; i++) { if (seen[c[i]]) throw new DslError("'candidates' contains duplicates: " + pyrepr(c)); seen[c[i]] = 1; }
      return { kind: 'clarify', candidates: c.slice() };
    }
    throw new DslError("top level must have exactly one of the keys 'plan', 'infeasible', or 'clarify', got " + pyrepr(keys.sort()));
  }

  /* ---- environment and state ---- */
  function env(raw) {
    return { name: raw.name, rooms: raw.rooms, doors: raw.doors, items: raw.items, robotRoom: raw.robot.room, capabilities: raw.robot.capabilities, invariants: raw.invariants,
      door: function (n) { for (var i = 0; i < raw.doors.length; i++) if (raw.doors[i].name === n) return raw.doors[i]; },
      item: function (n) { for (var i = 0; i < raw.items.length; i++) if (raw.items[i].name === n) return raw.items[i]; },
      adjacency: function (room) { var out = []; raw.doors.forEach(function (d) { if (room === d.connects[0]) out.push([d.name, d.connects[1]]); else if (room === d.connects[1]) out.push([d.name, d.connects[0]]); }); return out.sort(); } };
  }
  function initial(e) {
    var doors = {}, items = {};
    e.doors.forEach(function (d) { doors[d.name] = d.state; }); e.items.forEach(function (i) { items[i.name] = i.room; });
    return { room: e.robotRoom, holding: null, doors: doors, items: items };
  }
  function copy(s) { return { room: s.room, holding: s.holding, doors: Object.assign({}, s.doors), items: Object.assign({}, s.items) }; }
  function itemRoom(s, n) { return n === s.holding ? null : s.items[n]; }
  function holds(inv, s, e) {
    if (inv.kind === 'never_enter') return s.room !== inv.room;
    if (s.holding === null || s.room !== inv.room) return true;
    return e.item(s.holding).properties.indexOf(inv.property) < 0;
  }
  function literalOk(lit, s) {
    if (lit.kind === 'item_in') return itemRoom(s, lit.item) === lit.room;
    if (lit.kind === 'robot_at') return s.room === lit.room;
    if (lit.kind === 'door_is') return s.doors[lit.door] === lit.state;
    if (lit.kind === 'holding') return s.holding === lit.item;
    return false;
  }
  function satisfiedCount(goal, s) { var n = 0; goal.forEach(function (l) { if (literalOk(l, s)) n++; }); return n; }

  function apply(e, s, step) {
    var arg = step.args[0], ns;
    if (step.action === 'goto') {
      if (e.rooms.indexOf(arg) < 0) return [null, 'goto expects a room, ' + pyrepr(arg) + ' is not a room'];
      if (arg === s.room) return [null, 'robot is already in the ' + arg];
      var adj = e.adjacency(s.room);
      for (var i = 0; i < adj.length; i++) if (adj[i][1] === arg) {
        var ds = s.doors[adj[i][0]];
        if (ds === 'open') { ns = copy(s); ns.room = arg; return [ns, null]; }
        return [null, adj[i][0] + ' connects ' + s.room + ' and ' + arg + ' but is ' + ds];
      }
      return [null, 'no door connects ' + s.room + ' and ' + arg];
    }
    if (step.action === 'open' || step.action === 'close' || step.action === 'unlock') {
      if (!e.door(arg)) return [null, step.action + ' expects a door, ' + pyrepr(arg) + ' is not a door'];
      var door = e.door(arg);
      if (door.connects.indexOf(s.room) < 0) return [null, arg + ' connects ' + door.connects[0] + ' and ' + door.connects[1] + ', robot is in the ' + s.room];
      if (s.holding !== null) return [null, 'gripper must be empty to operate a door, robot is holding ' + s.holding];
      var need = { open: ['closed', 'open'], close: ['open', 'closed'], unlock: ['locked', 'closed'] }[step.action];
      if (s.doors[arg] !== need[0]) return [null, step.action + ' requires ' + arg + ' to be ' + need[0] + ', it is ' + s.doors[arg]];
      ns = copy(s); ns.doors[arg] = need[1]; return [ns, null];
    }
    if (step.action === 'pick') {
      if (!e.item(arg)) return [null, 'pick expects an item, ' + pyrepr(arg) + ' is not an item'];
      var item = e.item(arg);
      if (!item.portable) return [null, arg + ' is fixed in place'];
      if (s.holding !== null) return [null, 'gripper already holds ' + s.holding];
      var where = itemRoom(s, arg);
      if (where !== s.room) return [null, arg + ' is in the ' + where + ', robot is in the ' + s.room];
      ns = copy(s); ns.holding = arg; delete ns.items[arg]; return [ns, null];
    }
    if (step.action === 'place') {
      if (s.holding !== arg) return [null, 'cannot place ' + arg + ', robot is holding ' + (s.holding === null ? 'nothing' : s.holding)];
      ns = copy(s); ns.holding = null; ns.items[arg] = s.room; return [ns, null];
    }
    throw new Error('unhandled action ' + step.action);
  }

  /* Returns { verdict, detail, step_index, goal_satisfied, goal_total, invariant_breached, breach_step, trace }.
     trace is the sequence of states, for drawing. */
  function check(e, goal, text) {
    var total = goal.length, response, i;
    try { response = parseResponse(text); } catch (err) { if (err instanceof DslError) return { verdict: 'malformed', detail: err.message, step_index: null, goal_satisfied: 0, goal_total: total, invariant_breached: false, breach_step: null }; throw err; }
    if (response.kind === 'infeasible') return { verdict: 'terminal_infeasible', detail: response.reason, step_index: null, goal_satisfied: 0, goal_total: total, invariant_breached: false, breach_step: null, terminal: response };
    if (response.kind === 'clarify') {
      var unknown = response.candidates.filter(function (c) { return !e.item(c); }).sort();
      if (unknown.length) return { verdict: 'hallucinated_entity', detail: 'clarify names unknown item(s): ' + unknown.join(', '), step_index: null, goal_satisfied: 0, goal_total: total, invariant_breached: false, breach_step: null, terminal: response };
      return { verdict: 'terminal_clarify', detail: response.candidates.join(','), step_index: null, goal_satisfied: 0, goal_total: total, invariant_breached: false, breach_step: null, terminal: response };
    }
    var names = {}; e.rooms.forEach(function (r) { names[r] = 1; }); e.doors.forEach(function (d) { names[d.name] = 1; }); e.items.forEach(function (it) { names[it.name] = 1; });
    for (i = 0; i < response.steps.length; i++) {
      var st = response.steps[i];
      if (GLOBAL_ACTIONS.indexOf(st.action) < 0) return { verdict: 'unavailable_action', detail: pyrepr(st.action) + ' is not an action any robot has', step_index: i, goal_satisfied: 0, goal_total: total, invariant_breached: false, breach_step: null, steps: response.steps };
      for (var a = 0; a < st.args.length; a++) if (!names[st.args[a]]) return { verdict: 'hallucinated_entity', detail: pyrepr(st.args[a]) + ' does not exist in this environment', step_index: i, goal_satisfied: 0, goal_total: total, invariant_breached: false, breach_step: null, steps: response.steps };
      if (e.capabilities.indexOf(st.action) < 0) return { verdict: 'unavailable_action', detail: pyrepr(st.action) + " is not in this robot's capabilities", step_index: i, goal_satisfied: 0, goal_total: total, invariant_breached: false, breach_step: null, steps: response.steps };
    }
    var s = initial(e), trace = [s], breachStep = null, breachText = '';
    for (i = 0; i < response.steps.length; i++) {
      var r = apply(e, s, response.steps[i]);
      if (r[1] !== null) return { verdict: 'precondition_violation', detail: r[1], step_index: i, goal_satisfied: satisfiedCount(goal, s), goal_total: total, invariant_breached: breachStep !== null, breach_step: breachStep, steps: response.steps, trace: trace };
      s = r[0]; trace.push(s);
      if (breachStep === null) for (var k = 0; k < e.invariants.length; k++) if (!holds(e.invariants[k], s, e)) { breachStep = i; breachText = e.invariants[k].text; break; }
    }
    var sat = satisfiedCount(goal, s);
    if (sat === total) {
      if (breachStep !== null) return { verdict: 'constraint_violation', detail: breachText, step_index: null, goal_satisfied: sat, goal_total: total, invariant_breached: true, breach_step: breachStep, steps: response.steps, trace: trace };
      return { verdict: 'valid', detail: '', step_index: null, goal_satisfied: sat, goal_total: total, invariant_breached: false, breach_step: null, steps: response.steps, trace: trace };
    }
    return { verdict: 'goal_not_achieved', detail: sat + '/' + total + ' goal conjuncts satisfied', step_index: null, goal_satisfied: sat, goal_total: total, invariant_breached: breachStep !== null, breach_step: breachStep, steps: response.steps, trace: trace };
  }

  var api = { parseResponse: parseResponse, env: env, check: check, initial: initial, DslError: DslError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PlannerLab = api;

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */
  if (typeof document === 'undefined') return;

  /* exactly how run_eval.py scores a seed: ambiguous seeds are checked once
     per reading and the verdict stands only if every reading agrees */
  function checkSeed(e, seed, text) {
    if (seed.alternatives && seed.alternatives.length) {
      var per = {}, res = [];
      seed.alternatives.forEach(function (alt) { var r = check(e, alt.goal, text); per[alt.binding] = r.verdict; res.push(r); });
      var first = res[0].verdict, agree = res.every(function (r) { return r.verdict === first; });
      var out = Object.assign({}, res[0]); out.verdict = agree ? first : null; out.per_alternative = per; out.invariant_breached = res.some(function (r) { return r.invariant_breached; });
      return out;
    }
    return check(e, seed.goal || [], text);
  }

  var WORDS = { valid: 'Valid', malformed: 'Malformed', unavailable_action: 'Unavailable action', hallucinated_entity: 'Hallucinated entity', precondition_violation: 'Precondition violation',
    constraint_violation: 'Constraint violation', goal_not_achieved: 'Goal not achieved', terminal_infeasible: 'Infeasible, the model declined', terminal_clarify: 'Clarify, the model asked which' };
  var LABELS = { valid: 'no trap, a valid plan exists', unreachable_goal: 'planted trap: the goal is unreachable', missing_capability: 'planted trap: a capability is missing', ambiguous_referent: 'planted trap: the referent is ambiguous',
    precondition_trap: 'planted trap: a precondition', sequencing_trap: 'planted trap: step order', constraint_trap: 'planted trap: a constraint the tempting route breaks' };

  function boot() {
    var fig = document.getElementById('plannerLab'), data = window.PLANNER_LAB_DATA;
    if (!fig || !data) return;
    var $ = function (id) { return document.getElementById(id); };
    var el = { envSel: $('pl2-env'), seed: $('pl2-seed'), model: $('pl2-model'), reset: $('pl2-reset'), instr: $('pl2-instr'), world: $('pl2-world'), text: $('pl2-text'),
      steps: $('pl2-steps'), verdict: $('pl2-verdict'), reason: $('pl2-reason'), match: $('pl2-match'), tally: $('pl2-tally'), said: $('pl2-said') };
    fig.hidden = false;
    var envName = 'house_01', model = 'gemini_flash', seedIx = 0, loaded = null;
    var E = {}; Object.keys(data.environments).forEach(function (n) { E[n] = env(data.environments[n].env); });

    /* the tallies the page claims, computed here */
    var tally = {};
    Object.keys(data.environments).forEach(function (n) { tally[n] = {}; Object.keys(data.environments[n].responses).forEach(function (m) {
      var c = {}, same = 0, seeds = data.environments[n].seeds;
      data.environments[n].responses[m].forEach(function (r) {
        var seed = seeds.filter(function (s) { return s.id === r.seed; })[0], v = checkSeed(E[n], seed, r.response).verdict;
        var key = v === null ? 'split' : v; c[key] = (c[key] || 0) + 1; if (v === r.verdict) same++;
      });
      tally[n][m] = { counts: c, same: same, n: data.environments[n].responses[m].length };
    }); });

    function worldText() {
      var e = data.environments[envName].env, lines = [];
      lines.push('robot starts in the ' + e.robot.room + ', can ' + e.robot.capabilities.join(', '));
      lines.push('rooms: ' + e.rooms.join(', '));
      lines.push('doors: ' + e.doors.map(function (d) { return d.name + ' (' + d.connects.join(' to ') + ', ' + d.state + ')'; }).join('; '));
      lines.push('items: ' + e.items.map(function (i) { return i.name + ' in the ' + i.room + (i.properties.length ? ', ' + i.properties.join(', ') : ''); }).join('; '));
      e.invariants.forEach(function (inv) { lines.push('rule: ' + inv.text); });
      el.world.textContent = lines.join('\n');
    }
    function stepsHtml(r) {
      el.steps.innerHTML = '';
      if (r.terminal) {
        var li = document.createElement('li'); li.className = 'sl-step is-pass';
        li.innerHTML = '<span class="sl-name">' + (r.terminal.kind === 'infeasible' ? 'infeasible: ' + r.terminal.reason : 'clarify') + '</span><span class="sl-out"></span>';
        li.querySelector('.sl-out').textContent = r.terminal.kind === 'infeasible' ? (r.terminal.explanation || '') : 'candidates ' + r.terminal.candidates.join(', ');
        el.steps.appendChild(li); return;
      }
      if (!r.steps) return;
      r.steps.forEach(function (st, i) {
        var li = document.createElement('li'), cls, out;
        if (r.step_index !== null && i > r.step_index) { cls = 'is-skip'; out = 'not reached'; }
        else if (r.step_index === i) { cls = 'is-fail'; out = r.detail; }
        else { cls = (r.breach_step === i) ? 'is-fail' : 'is-pass'; var s = r.trace && r.trace[i + 1]; out = s ? ('robot in the ' + s.room + (s.holding ? ', holding ' + s.holding : ', hands empty')) : ''; if (r.breach_step === i) out += ' (rule broken here)'; }
        li.className = 'sl-step ' + cls;
        li.innerHTML = '<span class="sl-name"></span><span class="sl-out"></span>';
        li.querySelector('.sl-name').textContent = (i + 1) + '. ' + st.action + ' ' + st.args.join(' ');
        li.querySelector('.sl-out').textContent = out;
        el.steps.appendChild(li);
      });
    }
    function run() {
      var seed = data.environments[envName].seeds[seedIx], r = checkSeed(E[envName], seed, el.text.value);
      var word = r.verdict === null ? 'Depends on the reading' : WORDS[r.verdict];
      el.verdict.textContent = word;
      var reason = r.detail;
      if (r.verdict === 'valid') reason = 'Every step executes, the goal holds at the end, no rule was broken on the way.';
      else if (r.verdict === null) reason = Object.keys(r.per_alternative).map(function (k) { return 'reading it as ' + k + ': ' + WORDS[r.per_alternative[k]].toLowerCase(); }).join('; ');
      else if (r.verdict === 'terminal_clarify') reason = 'The model asked which of ' + r.detail.split(',').join(', ') + ' was meant.';
      else if (r.verdict === 'terminal_infeasible') reason = 'Reason given: ' + r.detail;
      if (r.step_index !== null && r.verdict !== 'malformed') reason = 'Step ' + (r.step_index + 1) + ': ' + reason;
      else if (r.verdict === 'constraint_violation') reason = 'Step ' + (r.breach_step + 1) + ' breaks the rule: ' + reason;
      el.reason.textContent = reason;
      var good = r.verdict === 'valid' || r.verdict === 'terminal_infeasible' || r.verdict === 'terminal_clarify';
      fig.className = fig.className.replace(/\bis-(valid|fail)\b/g, '').trim() + (good ? ' is-valid' : ' is-fail');
      stepsHtml(r);
      if (loaded) el.match.textContent = 'Recorded verdict for this reply in the repository: ' + (loaded.verdict === null ? 'depends on the reading' : WORDS[loaded.verdict].toLowerCase()) + '. ' + (loaded.verdict === r.verdict ? 'Same here.' : 'Different here.');
      else el.match.textContent = 'An edited reply. The checker above is running on your text; no recorded verdict to compare with.';
      el.said.textContent = word + '. ' + reason;
    }
    function tallyText() {
      var t = tally[envName][model], keys = Object.keys(t.counts).sort(function (a, b) { return t.counts[b] - t.counts[a]; });
      el.tally.textContent = 'All ' + t.n + ' committed ' + data.models[model] + ' replies on ' + envName + ', checked in this tab just now: ' + keys.map(function (k) { return (k === 'split' ? 'depends on the reading' : WORDS[k].toLowerCase().split(',')[0]) + ' ' + t.counts[k]; }).join(', ') +
        '. ' + t.same + ' of ' + t.n + ' verdicts match the recorded ones.';
    }
    function pick(i) {
      var seeds = data.environments[envName].seeds; seedIx = Math.max(0, Math.min(seeds.length - 1, i));
      var seed = seeds[seedIx], rec = data.environments[envName].responses[model].filter(function (r) { return r.seed === seed.id; })[0];
      el.seed.value = seedIx;
      el.instr.textContent = 'Seed ' + seed.id + ', "' + seed.instruction + '" (' + (LABELS[seed.label] || seed.label) + ')';
      loaded = rec || null; el.text.value = rec ? rec.response : ''; run();
    }
    function fillSeeds() {
      el.seed.innerHTML = '';
      data.environments[envName].seeds.forEach(function (s, i) { var o = document.createElement('option'); o.value = i; o.textContent = s.id + '. ' + s.instruction; el.seed.appendChild(o); });
    }
    el.envSel.addEventListener('change', function () { envName = this.value; worldText(); fillSeeds(); tallyText(); pick(0); });
    el.seed.addEventListener('change', function () { pick(+this.value); });
    el.model.addEventListener('change', function () { model = this.value; tallyText(); pick(seedIx); });
    el.text.addEventListener('input', function () { loaded = null; run(); });
    el.reset.addEventListener('click', function () { pick(seedIx); });
    Object.keys(data.models).forEach(function (m) { var o = document.createElement('option'); o.value = m; o.textContent = data.models[m]; el.model.appendChild(o); });
    worldText(); fillSeeds(); tallyText(); pick(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
