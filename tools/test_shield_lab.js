#!/usr/bin/env node
/* Checks the shield that runs on the llm-nav-shield page against the C++
 * shield's committed results.
 *
 *   node tools/test_shield_lab.js
 *
 * assets/shield-lab.js ports src/shield_main.cpp with its A* and reference
 * checker. This replays all 40 committed qwen proposals and the ten
 * sealed-goal variants, and requires for each the bucket, the action and
 * the fallback waypoint count that reports/results/shield_eval.csv
 * records, and that every recovered path equals the committed dump in
 * reports/results/dumps waypoint for waypoint. Needs llm-nav-shield and
 * ros2-llm-safety-verifier beside the site (the shield reads the
 * proposals and maps through its deps/verifier submodule); exits 2 if
 * either is missing, 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), path = require('path');
const V = require(path.join(__dirname, '..', 'assets', 'verifier-lab.js'));
const S = require(path.join(__dirname, '..', 'assets', 'shield-lab.js'));
const SHIELD = path.join(__dirname, '..', '..', 'llm-nav-shield'), VER = path.join(SHIELD, 'deps', 'verifier');
if (!fs.existsSync(SHIELD) || !fs.existsSync(path.join(VER, 'llm_eval'))) { console.error('SKIP: llm-nav-shield (with deps/verifier) not found beside the site'); process.exit(2); }
function pgm(file) {
  const b = fs.readFileSync(file); let i = 0; const tok = [];
  while (tok.length < 4) { while (b[i] === 0x0a || b[i] === 0x20) i++; let j = i; while (b[j] !== 0x0a && b[j] !== 0x20) j++; tok.push(b.slice(i, j).toString()); i = j; }
  i++; return { w: +tok[1], h: +tok[2], data: new Uint8Array(b.buffer, b.byteOffset + i) };
}
const txt = fs.readFileSync(path.join(VER, 'llm_eval', 'parsed', 'qwen2.5-7b-instruct.txt'), 'utf8').split(/\s+/).filter(Boolean);
const recs = []; let i = 0;
while (i < txt.length && txt[i] === 'scenario') {
  const r = { scenario: +txt[i + 1] }; i += 2; r.ok = +txt[i + 1]; i += 2;
  r.start = { x: +txt[i + 1], y: +txt[i + 2] }; i += 3; r.goal = { x: +txt[i + 1], y: +txt[i + 2] }; i += 3;
  const n = +txt[i + 1]; i += 2; r.traj = []; for (let k = 0; k < n; k++) { r.traj.push({ x: +txt[i], y: +txt[i + 1] }); i += 2; }
  recs.push(r);
}
const csv = fs.readFileSync(path.join(SHIELD, 'reports', 'results', 'shield_eval.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
let n = 0, bad = 0, paths = 0, pathBad = 0;
for (const r of recs) {
  if (!r.ok) continue;
  const sc = String(r.scenario).padStart(2, '0'), p = pgm(path.join(VER, 'llm_eval', 'scenarios', `scenario_${sc}.pgm`));
  const grid = new V.Grid(p.w, p.h, 0.05, p.data), o = S.runShield(grid, r.traj, r.start, r.goal), row = csv.find((c) => +c[0] === r.scenario && c[1] === 'qwen'); n++;
  if (o.bucket !== row[2] || (o.forwarded ? 'forward' : 'halt') !== row[3] || o.fallback.length !== +row[5]) { bad++; console.log(`MISMATCH scenario ${r.scenario}: recorded ${row[2]} ${row[3]} ${row[5]} waypoints, port gave ${o.bucket} ${o.fallback.length}`); }
  if (o.fallback.length) {
    paths++;
    const dump = fs.readFileSync(path.join(SHIELD, 'reports', 'results', 'dumps', `fallback_${sc}.txt`), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    const same = dump.length === o.fallback.length && dump.every((d, k) => Math.abs(d[0] - o.fallback[k].x) < 1e-9 && Math.abs(d[1] - o.fallback[k].y) < 1e-9);
    if (!same) { pathBad++; console.log(`PATH DIFFERS scenario ${r.scenario}: dump has ${dump.length} waypoints, port ${o.fallback.length}`); }
  }
  const h = csv.find((c) => +c[0] === r.scenario && c[1] === 'sealed_goal');
  if (h) { const ho = S.runShield(S.sealGoal(grid, r.goal), r.traj, r.start, r.goal); n++; if (ho.bucket !== h[2]) { bad++; console.log(`SEALED MISMATCH scenario ${r.scenario}: recorded ${h[2]}, port gave ${ho.bucket}`); } }
}
console.log(`${n} shield decisions replayed, ${bad} differ from the recorded bucket or action`);
console.log(`${paths} recovered paths compared with the committed dumps, ${pathBad} differ`);
if (bad || pathBad) { console.log('FAIL'); process.exit(1); }
console.log('ok');
