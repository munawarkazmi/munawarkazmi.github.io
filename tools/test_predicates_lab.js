#!/usr/bin/env node
/* Checks the predicates that run on the exact-predicates page against the
 * repository's committed corpus.
 *
 *   node tools/test_predicates_lab.js
 *
 * assets/predicates-lab.js is a port of src/predicates.cpp. On every
 * adversarial case this requires the committed exact verdict from the
 * exact port and a wrong verdict from the float port, as the C++ tests do;
 * on the random differential corpus it requires agreement with the
 * committed oracle verdicts; and on the out-of-bounds cases it requires
 * the bound guard to throw. It also checks that the shipped data file is
 * the corpus, line for line. Needs the repository beside the site; exits 2
 * if it is not there, 1 on any failure.
 */
'use strict';
const fs = require('fs'), path = require('path');
const P = require(path.join(__dirname, '..', 'assets', 'predicates-lab.js'));
const REPO = path.join(__dirname, '..', '..', 'exact-predicates');
if (!fs.existsSync(REPO)) { console.error('SKIP: exact-predicates not found beside the site'); process.exit(2); }
const lines = (f) => fs.readFileSync(path.join(REPO, 'corpus', f), 'utf8').trim().split('\n');
const pt = (v, i) => ({ x: v[i], y: v[i + 1] });
let fail = 0;

let o = lines('orientation_adversarial.txt'), oe = 0, of = 0;
for (const l of o) { const v = P.parseLine(l); const a = pt(v, 0), b = pt(v, 2), c = pt(v, 4), exp = Number(v[6]); if (P.orientation(a, b, c) === exp) oe++; if (P.orientationFloat(a, b, c) !== exp) of++; }
console.log(`orientation: ${o.length} cases, exact right on ${oe}, float wrong on ${of}`);
if (oe !== o.length || of !== o.length) fail++;

let c = lines('incircle_adversarial.txt'), ce = 0, cf = 0;
for (const l of c) { const v = P.parseLine(l); const a = pt(v, 0), b = pt(v, 2), cc = pt(v, 4), d = pt(v, 6), exp = Number(v[8]); if (P.incircle(a, b, cc, d) === exp) ce++; if (P.incircleFloat(a, b, cc, d) !== exp) cf++; }
console.log(`in-circle: ${c.length} cases, exact right on ${ce}, float wrong on ${cf}`);
if (ce !== c.length || cf !== c.length) fail++;

let r = lines('random_differential.txt'), ra = 0;
for (const l of r) { const t = l.trim().split(/\s+/); const v = t.slice(1).map((s) => BigInt(s)); const got = t[0] === 'O' ? P.orientation(pt(v, 0), pt(v, 2), pt(v, 4)) : P.incircle(pt(v, 0), pt(v, 2), pt(v, 4), pt(v, 6)); if (got === Number(v[t[0] === 'O' ? 6 : 8])) ra++; }
console.log(`random differential: ${r.length} cases, exact agrees with the oracle on ${ra}`);
if (ra !== r.length) fail++;

let ob = lines('out_of_bounds.txt'), threw = 0;
for (const l of ob) { const t = l.trim().split(/\s+/); const v = t.slice(1).map((s) => BigInt(s)); try { if (t[0] === 'O') P.orientation(pt(v, 0), pt(v, 2), pt(v, 4)); else P.incircle(pt(v, 0), pt(v, 2), pt(v, 4), pt(v, 6)); } catch (e) { if (e instanceof P.BoundError) threw++; } }
console.log(`out of bounds: ${ob.length} cases, guard threw on ${threw}`);
if (threw !== ob.length) fail++;

global.window = {}; require(path.join(__dirname, '..', 'assets', 'predicates-lab-data.js'));
const D = global.window.PREDICATES_LAB_DATA, norm = (l) => l.trim().split(/\s+/).join(' ');
const same = D.orientation.length === o.length && D.orientation.every((l, i) => l === norm(o[i])) && D.incircle.length === c.length && D.incircle.every((l, i) => l === norm(c[i]));
console.log('shipped data file ' + (same ? 'matches' : 'DIFFERS FROM') + ' the corpus');
if (!same) fail++;
if (fail) { console.log('FAIL'); process.exit(1); }
console.log('ok');
