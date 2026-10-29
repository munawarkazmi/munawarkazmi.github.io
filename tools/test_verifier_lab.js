#!/usr/bin/env node
/* Checks the verifier that runs on the llm-safety-verifier page against the
 * C++ verifier's committed results.
 *
 *   node tools/test_verifier_lab.js
 *
 * assets/verifier-lab.js is a port of core/src/verifier.cpp from
 * ros2-llm-safety-verifier. This replays all 80 committed model proposals
 * (two models, forty scenarios) through the port, on the repository's own
 * grids, and requires the verdict, the violation and the waypoint index
 * that reports/results/llm_eval_*.csv records for each. It also checks
 * that the presets shipped in assets/verifier-lab-data.js decode to those
 * grids exactly. Needs the repository checked out beside the site; exits
 * 2 if it is not there, 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), path = require('path');
const V = require(path.join(__dirname, '..', 'assets', 'verifier-lab.js'));
const REPO = path.join(__dirname, '..', '..', 'ros2-llm-safety-verifier');
if (!fs.existsSync(REPO)) { console.error('SKIP: ros2-llm-safety-verifier not found beside the site'); process.exit(2); }

function pgm(file) {
  const b = fs.readFileSync(file); let i = 0; const tok = [];
  while (tok.length < 4) { while (b[i] === 0x0a || b[i] === 0x20) i++; let j = i; while (b[j] !== 0x0a && b[j] !== 0x20) j++; tok.push(b.slice(i, j).toString()); i = j; }
  i++;
  return { w: +tok[1], h: +tok[2], data: new Uint8Array(b.buffer, b.byteOffset + i) };
}
function scenarioFile(sc, ext) { return path.join(REPO, 'llm_eval', 'scenarios', `scenario_${String(sc).padStart(2, '0')}.${ext}`); }

let n = 0, bad = 0;
for (const model of ['qwen2.5-7b-instruct', 'llama-3.3-70b-versatile']) {
  const parsed = JSON.parse(fs.readFileSync(path.join(REPO, 'llm_eval', 'parsed', model + '.json')));
  const rows = fs.readFileSync(path.join(REPO, 'reports', 'results', 'llm_eval_' + model + '.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  for (const row of rows) {
    const sc = +row[0], want = { safe: row[4] === '1', violation: row[5], index: +row[6] };
    const s = JSON.parse(fs.readFileSync(scenarioFile(sc, 'json'))), p = pgm(scenarioFile(sc, 'pgm'));
    const grid = new V.Grid(p.w, p.h, s.resolution, p.data);
    const pr = parsed.find((r) => r.scenario === sc);
    const traj = ((pr && pr.parse_ok && pr.waypoints) || []).map((w) => ({ x: w[0], y: w[1] }));
    const got = V.verify(grid, traj); n++;
    if (got.safe !== want.safe || got.violation !== want.violation || (!got.safe && got.index !== want.index)) {
      bad++; console.log(`MISMATCH ${model} scenario ${sc}: recorded ${JSON.stringify(want)}, port gave ${got.violation} at ${got.index}`);
    }
  }
}
console.log(`${n} committed proposals replayed, ${bad} differ from the recorded verdicts`);

/* the shipped presets decode to the repository's grids */
global.window = {};
require(path.join(__dirname, '..', 'assets', 'verifier-lab-data.js'));
let presetBad = 0;
for (const e of global.window.VERIFIER_LAB_DATA) {
  const p = pgm(scenarioFile(e.id, 'pgm')); const cells = new Uint8Array(e.width * e.height); let k = 0;
  for (let i = 0; i < e.cells.length; i += 2) { const v = e.cells[i] === 1 ? 254 : e.cells[i] === 2 ? 255 : 0; for (let j = 0; j < e.cells[i + 1]; j++) cells[k++] = v; }
  let diff = k !== p.data.length ? 1 : 0;
  for (let i = 0; i < p.data.length && !diff; i++) if (cells[i] !== p.data[i]) diff = 1;
  if (diff) { presetBad++; console.log('preset map ' + e.id + ' does not match the repository grid'); }
}
console.log(`${global.window.VERIFIER_LAB_DATA.length} preset maps checked, ${presetBad} differ`);
if (bad || presetBad) { console.log('FAIL'); process.exit(1); }
console.log('ok');
