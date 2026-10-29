#!/usr/bin/env node
/* Checks the certified-interval explorer on the legibility-bounds page
 * against the repository's committed suite.
 *
 *   node tools/test_bounds_lab.js
 *
 * The page does not rebuild the lattice (up to about 23 seconds of Python per
 * world); it shows the committed intervals. This requires that the data
 * file served here equals results/suite_bounds.json row for row, that the
 * page's own summary (widest and narrowest interval, violations) is what
 * assets/bounds-lab.js computes from it, and that every interval is a
 * certificate: achieved <= bound, shortest path <= bound, gap = bound minus
 * achieved. Needs legibility-bounds beside the site; exits 2 if it is
 * missing, 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..', 'legibility-bounds'), src = path.join(REPO, 'results', 'suite_bounds.json');
if (!fs.existsSync(src)) { console.error('SKIP: legibility-bounds not found beside the site'); process.exit(2); }
const up = JSON.parse(fs.readFileSync(src, 'utf8'));
global.window = {}; require(path.join(__dirname, '..', 'assets', 'bounds-lab-data.js')); const data = global.window.BOUNDS_LAB_DATA;
const B = require(path.join(__dirname, '..', 'assets', 'bounds-lab.js'));
let fails = 0, n = 0; const ok = (c, w) => { n++; if (!c) { fails++; console.log('FAIL ' + w); } };
ok(data.rows.length === up.rows.length, 'row count ' + data.rows.length + ' vs ' + up.rows.length);
ok(data.geometry_commit === up.geometry_commit, 'geometry commit');
up.rows.forEach((r, i) => { const d = data.rows[i]; ok(d && d.scenario === r.scenario && d.ceiling === r.ceiling && d.achieved === r.achieved && d.bound === r.bound && d.gap === r.gap && d.shortest === r.shortest_path_legibility, 'row ' + i + ' ' + r.scenario + ' ' + r.ceiling + ' equals the committed row'); });
const s = B.summarise(data.rows);
ok(s.violations === 0 && data.violations === 0, 'no interval is violated');
data.rows.forEach((r) => { ok(r.achieved <= r.bound + 1e-12 && r.shortest <= r.bound + 1e-12 && Math.abs(r.gap - (r.bound - r.achieved)) < 1e-9, r.scenario + ' ' + r.ceiling + ' is a certificate'); });
ok(s.widest.scenario === 'fan_middle' && s.widest.ceiling === 1.25 && Math.abs(s.widest.gap - 0.0567) < 5e-4, 'widest interval is fan_middle at 1.25, 0.0567: ' + s.widest.scenario + ' ' + s.widest.ceiling + ' ' + s.widest.gap);
ok(Math.abs(s.narrowest.gap - 0.0064) < 5e-4, 'narrowest gap is 0.0064: ' + s.narrowest.gap);
ok(s.worlds.length === 8 && s.rows === 32, '8 worlds, 32 rows');
const g = B.grade(data.rows.filter((r) => r.scenario === 'fan_middle' && r.ceiling === 1.25)[0], 0.43);
ok(g.where === 'below', 'a planner at 0.43 in fan_middle 1.25 sits just below the floor: ' + g.where);
ok(B.grade(data.rows[0], 0.79).where === 'inside' && B.grade(data.rows[0], 0.9).where === 'above' && B.grade(data.rows[0], 0.5).where === 'below', 'grading inside, above, below');
console.log(n + ' checks, ' + fails + ' failed'); if (fails) { console.log('FAIL'); process.exit(1); } console.log('ok');
