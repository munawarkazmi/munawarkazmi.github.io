#!/usr/bin/env node
/* Checks the planners behind the replanning figure on the home page.
 *
 *   node tools/test_replan_lab.js
 *
 * The figure runs a small D* Lite and a small A* in the visitor's browser
 * (assets/replan-lab.js). This drives the same code through random maps:
 * the robot moves, walls appear on its route and elsewhere, some are taken
 * away again, and after every change three things must hold exactly.
 *
 *   1. D* Lite's cost from the robot to the goal equals Dijkstra's.
 *   2. The path D* Lite hands back is walkable and costs what it claims.
 *   3. A* from scratch reaches the same cost.
 *
 * Costs are integers, so "equals" means equals. The random numbers are
 * seeded, so a failure can be run again. Exits 1 on the first kind of
 * failure it finds.
 */
'use strict';
const path = require('path');
const lab = require(path.join(__dirname, '..', 'assets', 'replan-lab.js'));

const SIZES = [[48, 17], [32, 16], [18, 16], [24, 12], [12, 9]];
const SEEDS = [1, 42, 2024];
const TRIALS = 300;

let checks = 0, events = 0, wrongCost = 0, wrongPath = 0, wrongAstar = 0;

for (const first of SEEDS) {
  let seed = first;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

  for (let trial = 0; trial < TRIALS; trial++) {
    const [cols, rows] = SIZES[trial % SIZES.length];
    const map = lab.buildMap(cols, rows), grid = map.grid;

    /* knock the map about so no two trials share one */
    for (let i = 0; i < cols * rows * 0.05 * random(); i++) {
      const c = Math.floor(random() * cols * rows);
      if (c !== map.start && c !== map.goal) grid.wall[c] = random() < 0.7 ? 1 : 0;
    }

    const planner = new lab.DStarLite(grid, map.start, map.goal);
    planner.compute();

    for (let step = 0; step < 60; step++) {
      const truth = lab.dijkstra(grid, map.goal);
      checks++;
      if (planner.cost() !== truth[planner.start]) wrongCost++;

      const route = planner.path();
      if ((route === null) !== (truth[planner.start] >= lab.INF)) wrongPath++;
      if (route) {
        let cost = 0;
        for (let i = 1; i < route.length; i++) {
          const edge = grid.cost(route[i - 1], route[i]);
          if (edge >= lab.INF) { cost = -1; break; }
          cost += edge;
        }
        if (cost !== truth[planner.start]) wrongPath++;
      }

      /* the robot drives up to three cells along its route */
      if (route) {
        const k = Math.min(route.length - 1, Math.floor(random() * 4));
        if (k > 0) planner.moveTo(route[k]);
      }
      if (planner.start === map.goal) break;

      /* one to four cells change: mostly a wall on the route ahead,
         sometimes a wall anywhere, sometimes a wall taken away */
      const count = 1 + Math.floor(random() * 4);
      for (let j = 0; j < count; j++) {
        const r = random(), ahead = planner.path();
        const c = r < 0.55 && ahead && ahead.length > 3
          ? ahead[1 + Math.floor(random() * (ahead.length - 2))]
          : Math.floor(random() * cols * rows);
        if (c === planner.start || c === map.goal) continue;
        grid.wall[c] = r >= 0.55 && r < 0.7 ? 0 : (grid.wall[c] ? 0 : (r > 0.9 ? 0 : 1));
        planner.changed(c);
      }
      planner.compute();
      events++;
      if (lab.astar(grid, planner.start, map.goal).cost !== planner.cost()) wrongAstar++;
    }
  }
}

console.log(`${checks} states checked against Dijkstra, ${events} replans compared with A*`);
console.log(`  D* Lite cost differs from Dijkstra: ${wrongCost}`);
console.log(`  D* Lite path not walkable or wrong cost: ${wrongPath}`);
console.log(`  A* cost differs from D* Lite: ${wrongAstar}`);
if (wrongCost || wrongPath || wrongAstar) { console.log('FAIL'); process.exit(1); }
console.log('ok');
