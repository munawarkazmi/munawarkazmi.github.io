#!/usr/bin/env node
/* Checks the plan checker that runs on the plan-failure-bench page against
 * the repository's committed run records.
 *
 *   node tools/test_planner_lab.js
 *
 * assets/planner-lab.js ports checker.py, dsl.py and schema.py. This runs
 * every response in results/*.jsonl, all conditions and all sampling runs,
 * through the port (obfuscated responses through their canonical form, as
 * the repository scores them) and requires the recorded verdict, step
 * index, goal counts, invariant flag, per-alternative verdicts, and the
 * detail text except where the detail is the JSON parser's own wording of
 * a syntax error. Needs plan-failure-bench beside the site; exits 2 if it
 * is missing, 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), path = require('path');
const P = require(path.join(__dirname, '..', 'assets', 'planner-lab.js'));
const REPO = path.join(__dirname, '..', '..', 'plan-failure-bench');
if (!fs.existsSync(REPO)) { console.error('SKIP: plan-failure-bench not found beside the site'); process.exit(2); }
const J = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const envs = {}, seeds = {};
for (const n of ['house_01', 'office_01']) { envs[n] = P.env(J('environments/' + n + '.json')); for (const s of J('instructions/seeds_' + n + '.json')) seeds[n + '/' + s.id] = s; }
function checkSeed(env, seed, text) {
  if (seed.alternatives && seed.alternatives.length) {
    const per = {}, res = [];
    for (const alt of seed.alternatives) { const r = P.check(env, alt.goal, text); per[alt.binding] = r.verdict; res.push(r); }
    const vs = new Set(res.map((r) => r.verdict)), p = res[0];
    return { verdict: vs.size === 1 ? [...vs][0] : null, detail: p.detail, step_index: p.step_index, goal_satisfied: null, goal_total: null, invariant_breached: res.some((r) => r.invariant_breached), per_alternative: per };
  }
  const r = P.check(env, seed.goal || [], text);
  return { verdict: r.verdict, detail: r.detail, step_index: r.step_index, goal_satisfied: r.goal_satisfied, goal_total: r.goal_total, invariant_breached: r.invariant_breached, per_alternative: null };
}
let n = 0, bad = 0, files = 0;
for (const f of fs.readdirSync(path.join(REPO, 'results')).filter((x) => x.endsWith('.jsonl')).sort()) {
  files++;
  for (const r of fs.readFileSync(path.join(REPO, 'results', f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))) {
    const seed = seeds[r.environment + '/' + r.seed_id]; if (!seed) { bad++; console.log('no seed for', f, r.seed_id); continue; }
    const text = r.response_canonical != null ? r.response_canonical : r.response, got = checkSeed(envs[r.environment], seed, text); n++;
    const same = got.verdict === r.verdict && (got.step_index ?? null) === (r.step_index ?? null) && got.goal_satisfied === r.goal_satisfied && got.goal_total === r.goal_total &&
      got.invariant_breached === r.invariant_breached && (r.verdict === 'malformed' || got.detail === r.detail) && JSON.stringify(got.per_alternative) === JSON.stringify(r.per_alternative);
    if (!same) { bad++; if (bad <= 10) console.log(`MISMATCH ${f} ${r.seed_id}: recorded ${r.verdict} ${r.step_index} ${JSON.stringify(r.detail)}, port gave ${got.verdict} ${got.step_index} ${JSON.stringify(got.detail)}`); }
  }
}
console.log(`${n} responses in ${files} result files replayed, ${bad} differ from the recorded checker output`);
if (bad) { console.log('FAIL'); process.exit(1); }
console.log('ok');
