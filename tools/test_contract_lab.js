#!/usr/bin/env node
/* Checks the validator that runs on the toolcall-contract page against the
 * repository's committed results.
 *
 *   node tools/test_contract_lab.js
 *
 * assets/contract-lab.js ports validator.py, structural.py and semantic.py.
 * This runs both models' committed responses through the port and requires
 * the bucket counts in reports/*_summary.txt, runs the 262-case constructed
 * tier and requires every case's committed expected bucket, and checks that
 * the shipped data file matches the repository. Needs toolcall-contract
 * beside the site; exits 2 if it is missing, 1 on any failure.
 */
'use strict';
const fs = require('fs'), path = require('path');
const C = require(path.join(__dirname, '..', 'assets', 'contract-lab.js'));
const REPO = path.join(__dirname, '..', '..', 'toolcall-contract');
if (!fs.existsSync(REPO)) { console.error('SKIP: toolcall-contract not found beside the site'); process.exit(2); }
const J = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const L = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ts = C.toolset(J('tools_catalog/tools.json'), J('tools_catalog/catalogs.json'));
let fail = 0;
const BUCKETS = ['valid', 'parse_failure', 'unknown_tool', 'schema_violation', 'semantic_violation'];
for (const m of ['qwen2.5-7b-instruct', 'llama-3.3-70b-versatile']) {
  const counts = {}; BUCKETS.forEach((b) => { counts[b] = 0; });
  for (const r of L('datasets/' + m + '.jsonl')) counts[C.classify(ts, C.extractCall(r.raw)).bucket]++;
  const summary = fs.readFileSync(path.join(REPO, 'reports', m + '_summary.txt'), 'utf8');
  const want = {}; BUCKETS.forEach((b) => { const mm = summary.match(new RegExp('^\\s*' + b + '\\s+(\\d+)', 'm')); want[b] = mm ? +mm[1] : NaN; });
  const same = BUCKETS.every((b) => counts[b] === want[b]);
  console.log(m + ': ' + BUCKETS.map((b) => b + ' ' + counts[b] + (counts[b] === want[b] ? '' : ' (recorded ' + want[b] + ')')).join(', ') + (same ? '' : '  MISMATCH'));
  if (!same) fail++;
}
let bad = 0; const cons = L('datasets/constructed.jsonl');
for (const r of cons) { const v = C.classify(ts, 'call' in r ? r.call : C.extractCall(r.raw || '')); if (v.bucket !== r.expected) { bad++; console.log(`constructed ${r.id} (${r.cls}): expected ${r.expected}, port gave ${v.bucket} (${v.reason})`); } }
console.log(`constructed tier: ${cons.length} cases, ${bad} differ from their labels`);
if (bad) fail++;
global.window = {}; require(path.join(__dirname, '..', 'assets', 'contract-lab-data.js'));
const D = global.window.CONTRACT_LAB_DATA;
const sameData = JSON.stringify(D.tools) === JSON.stringify(J('tools_catalog/tools.json')) && JSON.stringify(D.catalogs) === JSON.stringify(J('tools_catalog/catalogs.json')) &&
  JSON.stringify(D.models.qwen.records.map((r) => r.raw)) === JSON.stringify(L('datasets/qwen2.5-7b-instruct.jsonl').map((r) => r.raw)) &&
  JSON.stringify(D.models.llama.records.map((r) => r.raw)) === JSON.stringify(L('datasets/llama-3.3-70b-versatile.jsonl').map((r) => r.raw)) && D.constructed.length === cons.length;
console.log('shipped data file ' + (sameData ? 'matches' : 'DIFFERS FROM') + ' the repository');
if (!sameData) fail++;
if (fail) { console.log('FAIL'); process.exit(1); }
console.log('ok');
