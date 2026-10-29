/* The two-layer validator, in the browser.
 *
 * A port of toolcall_contract/validator.py, structural.py and semantic.py
 * from toolcall-contract. The structural layer checks a call against its
 * tool's JSON Schema subset with the same sharp edges as the pinned
 * jsonschema oracle (a boolean is not a number, 1.0 is an integer, enum
 * comparison keeps true and 1 apart); the semantic layer checks the
 * contract rules declared beside each tool: catalog references, mutual
 * exclusion, parameters required together, ordering, conditionals.
 *
 * tools/test_contract_lab.js runs the committed model responses and the
 * 262-case constructed tier through this port and requires the committed
 * bucket for every one.
 */
(function () {
  'use strict';

  function isBool(v) { return typeof v === 'boolean'; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* Type-aware equality: true is not 1, false is not 0, as in jsonschema. */
  function jsonEqual(a, b) {
    if (isBool(a) !== isBool(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false; return true; }
    if (isObj(a) && isObj(b)) {
      var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
      if (ka.join('\u0000') !== kb.join('\u0000')) return false;
      for (var j = 0; j < ka.length; j++) if (!jsonEqual(a[ka[j]], b[ka[j]])) return false;
      return true;
    }
    return a === b;
  }
  function matchesType(v, t) {
    if (t === 'object') return isObj(v);
    if (t === 'array') return Array.isArray(v);
    if (t === 'string') return typeof v === 'string';
    if (t === 'boolean') return isBool(v);
    if (t === 'number') return isNum(v);
    if (t === 'integer') return isNum(v) && Number.isInteger(v);
    return true;
  }
  function fmt(v) { return JSON.stringify(v); }
  /* Python repr for the reasons the Python prints: strings in single quotes, lists likewise */
  function pyrepr(v) {
    if (typeof v === 'string') return "'" + v + "'";
    if (Array.isArray(v)) return '[' + v.map(pyrepr).join(', ') + ']';
    if (isBool(v)) return v ? 'True' : 'False';
    if (v === null) return 'None';
    if (isObj(v)) return '{' + Object.keys(v).map(function (k) { return pyrepr(k) + ': ' + pyrepr(v[k]); }).join(', ') + '}';
    return String(v);
  }

  function structural(schema, inst) {
    var i, r, name;
    if ('type' in schema && !matchesType(inst, schema.type)) return { valid: false, reason: 'expected type ' + schema.type };
    if ('enum' in schema) { var hit = false; for (i = 0; i < schema.enum.length; i++) if (jsonEqual(inst, schema.enum[i])) hit = true; if (!hit) return { valid: false, reason: 'value not in enum ' + pyrepr(schema.enum) }; }
    if (isNum(inst)) {
      if ('minimum' in schema && inst < schema.minimum) return { valid: false, reason: 'below minimum ' + schema.minimum };
      if ('maximum' in schema && inst > schema.maximum) return { valid: false, reason: 'above maximum ' + schema.maximum };
    }
    if (typeof inst === 'string') {
      var len = Array.from(inst).length;
      if ('minLength' in schema && len < schema.minLength) return { valid: false, reason: 'shorter than minLength ' + schema.minLength };
      if ('maxLength' in schema && len > schema.maxLength) return { valid: false, reason: 'longer than maxLength ' + schema.maxLength };
    }
    if (Array.isArray(inst)) {
      if ('minItems' in schema && inst.length < schema.minItems) return { valid: false, reason: 'fewer than minItems ' + schema.minItems };
      if ('maxItems' in schema && inst.length > schema.maxItems) return { valid: false, reason: 'more than maxItems ' + schema.maxItems };
      if ('items' in schema) for (i = 0; i < inst.length; i++) { r = structural(schema.items, inst[i]); if (!r.valid) return { valid: false, reason: 'items[' + i + ']: ' + r.reason }; }
    }
    if (isObj(inst)) {
      var props = schema.properties || {}, req = schema.required || [];
      for (i = 0; i < req.length; i++) if (!(req[i] in inst)) return { valid: false, reason: "missing required property '" + req[i] + "'" };
      if (schema.additionalProperties === false) for (name in inst) if (!(name in props)) return { valid: false, reason: "unexpected property '" + name + "'" };
      for (name in props) if (name in inst) { r = structural(props[name], inst[name]); if (!r.valid) return { valid: false, reason: name + ': ' + r.reason }; }
    }
    return { valid: true, reason: '' };
  }

  function semantic(sem, args, catalogs) {
    var refs = sem.refs || {}, param, i, g, present;
    for (param in refs) {
      var catalog = catalogs[refs[param]];
      if (param.slice(-2) === '[]') {
        var base = param.slice(0, -2), arr = args[base] || [];
        for (i = 0; i < arr.length; i++) if (catalog.indexOf(arr[i]) < 0) return { valid: false, reason: base + '[' + i + ']: ' + pyrepr(arr[i]) + " not in catalog '" + refs[param] + "'" };
      } else if (param in args && catalog.indexOf(args[param]) < 0) return { valid: false, reason: param + ': ' + pyrepr(args[param]) + " not in catalog '" + refs[param] + "'" };
    }
    var mx = sem.mutually_exclusive || [];
    for (i = 0; i < mx.length; i++) { present = mx[i].filter(function (p) { return p in args; }); if (present.length > 1) return { valid: false, reason: 'mutually exclusive: ' + pyrepr(present) }; }
    var rt = sem.requires_together || [];
    for (i = 0; i < rt.length; i++) { g = rt[i]; present = g.filter(function (p) { return p in args; }); if (present.length && present.length !== g.length) return { valid: false, reason: pyrepr(present) + ' requires ' + pyrepr(g.filter(function (p) { return !(p in args); })) }; }
    var ord = sem.ordered || [];
    for (i = 0; i < ord.length; i++) { var lo = ord[i][0], hi = ord[i][1]; if (lo in args && hi in args && args[lo] > args[hi]) return { valid: false, reason: "'" + lo + "' must not exceed '" + hi + "'" }; }
    var cond = sem.conditional || [];
    for (i = 0; i < cond.length; i++) {
      var rule = cond[i], j;
      if (jsonEqual(args[rule['if']], rule.equals)) { var tr = rule.then_required || []; for (j = 0; j < tr.length; j++) if (!(tr[j] in args)) return { valid: false, reason: "'" + rule['if'] + "'=='" + rule.equals + "' requires '" + tr[j] + "'" }; }
      else { var ef = rule.else_forbidden || []; for (j = 0; j < ef.length; j++) if (ef[j] in args) return { valid: false, reason: "'" + ef[j] + "' is only allowed when '" + rule['if'] + "'=='" + rule.equals + "'" }; }
    }
    return { valid: true, reason: '' };
  }

  /* First balanced JSON object in the text with a "tool" key and an object "arguments". */
  function extractCall(text) {
    for (var start = 0; start < text.length; start++) {
      if (text[start] !== '{') continue;
      var depth = 0, inStr = false, esc = false;
      for (var end = start; end < text.length; end++) {
        var c = text[end];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            var obj;
            try { obj = JSON.parse(text.slice(start, end + 1)); } catch (e) { break; }
            if (isObj(obj) && 'tool' in obj && isObj(obj.arguments)) return obj;
            break;
          }
        }
      }
    }
    return null;
  }

  function classify(toolset, call) {
    if (call === null) return { bucket: 'parse_failure', reason: 'no tool-call object found', tool: '' };
    var name = call.tool;
    if (!(typeof name === 'string' && name in toolset.tools)) return { bucket: 'unknown_tool', reason: "no tool named '" + name + "'", tool: String(name) };
    var tool = toolset.tools[name], ours = structural(tool.schema, call.arguments);
    if (!ours.valid) return { bucket: 'schema_violation', reason: ours.reason, tool: name };
    var sem = semantic(tool.semantics || {}, call.arguments, toolset.catalogs);
    if (!sem.valid) return { bucket: 'semantic_violation', reason: sem.reason, tool: name };
    return { bucket: 'valid', reason: '', tool: name };
  }
  function toolset(tools, catalogs) { var t = {}; tools.forEach(function (x) { t[x.name] = x; }); return { tools: t, catalogs: catalogs }; }

  var api = { structural: structural, semantic: semantic, extractCall: extractCall, classify: classify, toolset: toolset, jsonEqual: jsonEqual };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ContractLab = api;

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */
  if (typeof document === 'undefined') return;

  function boot() {
    var fig = document.getElementById('contractLab'), data = window.CONTRACT_LAB_DATA;
    if (!fig || !data) return;
    var $ = function (id) { return document.getElementById(id); };
    var el = { model: $('cl-model'), task: $('cl-task'), taskText: $('cl-task-text'), text: $('cl-text'), bucket: $('cl-bucket'), reason: $('cl-reason'),
      layers: [$('cl-l1'), $('cl-l2'), $('cl-l3')], tool: $('cl-tool'), schema: $('cl-schema'), tally: $('cl-tally'), said: $('cl-said'), reset: $('cl-reset') };
    fig.hidden = false;
    var ts = toolset(data.tools, data.catalogs), model = 'qwen', ix = 0;

    /* the tallies the page claims, computed here */
    var BUCKETS = ['valid', 'parse_failure', 'unknown_tool', 'schema_violation', 'semantic_violation'];
    var tally = {};
    ['qwen', 'llama'].forEach(function (m) { var c = {}; BUCKETS.forEach(function (b) { c[b] = 0; }); data.models[m].records.forEach(function (r) { c[classify(ts, extractCall(r.raw)).bucket]++; }); tally[m] = c; });
    var consOk = 0; data.constructed.forEach(function (r) { var v = classify(ts, 'call' in r ? r.call : extractCall(r.raw || '')); if (v.bucket === r.expected) consOk++; });

    var WORDS = { valid: 'Valid', parse_failure: 'Parse failure', unknown_tool: 'Unknown tool', schema_violation: 'Schema violation', semantic_violation: 'Contract violation' };
    function check() {
      var text = el.text.value, call = extractCall(text), v = classify(ts, call);
      el.bucket.textContent = WORDS[v.bucket];
      el.reason.textContent = v.bucket === 'valid' ? 'Parses, names a real tool, satisfies its schema and every contract rule declared beside it.' : v.reason;
      fig.className = fig.className.replace(/\bis-(valid|fail)\b/g, '').trim() + (v.bucket === 'valid' ? ' is-valid' : ' is-fail');
      var L = el.layers, state = function (k, cls, t) { L[k].className = 'sl-step ' + cls; L[k].querySelector('.sl-out').textContent = t; };
      state(0, call ? 'is-pass' : 'is-fail', call ? 'tool-call object found' : 'no {"tool", "arguments"} object in the text');
      if (!call) { state(1, 'is-skip', ''); state(2, 'is-skip', ''); }
      else if (v.bucket === 'unknown_tool') { state(1, 'is-fail', v.reason); state(2, 'is-skip', ''); }
      else if (v.bucket === 'schema_violation') { state(1, 'is-fail', v.reason); state(2, 'is-skip', 'not reached'); }
      else { state(1, 'is-pass', 'conforms to the schema of ' + v.tool); state(2, v.bucket === 'valid' ? 'is-pass' : 'is-fail', v.bucket === 'valid' ? 'every contract rule holds' : v.reason); }
      var tool = call && ts.tools[call.tool];
      el.tool.textContent = tool ? tool.name + ': ' + tool.description : (call ? 'no such tool in the catalog' : 'no tool named');
      el.schema.textContent = tool ? 'schema ' + JSON.stringify(tool.schema, null, 1).replace(/\n\s*/g, ' ') + '\ncontract ' + JSON.stringify(tool.semantics || {}, null, 1).replace(/\n\s*/g, ' ') : '';
      el.said.textContent = WORDS[v.bucket] + '. ' + el.reason.textContent;
    }
    function tallyText() {
      var t = tally[model], parts = BUCKETS.filter(function (b) { return t[b]; }).map(function (b) { return WORDS[b].toLowerCase() + ' ' + t[b]; });
      el.tally.textContent = 'Over all 40 committed ' + data.models[model].name + ' responses, computed in this tab just now: ' + parts.join(', ') + '. Constructed tier: ' + consOk + ' of ' + data.constructed.length + ' cases land in their labelled bucket.';
    }
    function pick(i) {
      ix = Math.max(0, Math.min(39, i));
      var r = data.models[model].records[ix];
      el.task.value = ix; el.taskText.textContent = 'Task ' + (ix + 1) + ' of 40: "' + r.task + '"';
      el.text.value = r.raw; check();
    }
    el.model.addEventListener('change', function () { model = this.value; tallyText(); pick(ix); });
    el.task.addEventListener('change', function () { pick(+this.value); });
    el.text.addEventListener('input', check);
    el.reset.addEventListener('click', function () { pick(ix); });
    for (var i = 0; i < 40; i++) { var o = document.createElement('option'); o.value = i; o.textContent = (i + 1) + '. ' + data.models.qwen.records[i].task; el.task.appendChild(o); }
    tallyText(); pick(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
