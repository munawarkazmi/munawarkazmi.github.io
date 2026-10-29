# munawarkazmi.com

The personal portfolio of **Munawar Kazmi**, Robotics & AI Engineer.

Hand-written HTML, CSS, and JavaScript. No frameworks, no build step, no dependencies:
the page you see is the code in this repository, served by GitHub Pages behind a custom
domain.

**Visit: [munawarkazmi.com](https://munawarkazmi.com)**

Featured there:

- [legibility-bounds](https://github.com/munawarkazmi/legibility-bounds): certified upper bounds on legibility
- [legible-motion-bench](https://github.com/munawarkazmi/legible-motion-bench): what clarity costs a robot
- [plan-failure-bench](https://github.com/munawarkazmi/plan-failure-bench): how LLM planners fail ([DOI](https://doi.org/10.5281/zenodo.21756817))
- [llm-nav-shield](https://github.com/munawarkazmi/llm-nav-shield): detect, recover, or halt
- [toolcall-contract](https://github.com/munawarkazmi/toolcall-contract): tool calls that silently aren't right
- [ROS2 Dynamic Path Planning](https://github.com/munawarkazmi/ros2-dynamic-path-planning)
- [ROS2 LLM Safety Verifier](https://github.com/munawarkazmi/ros2-llm-safety-verifier)
- [exact-predicates](https://github.com/munawarkazmi/exact-predicates): when floating point lies
- [ESP32-CAM Motion Detector](https://github.com/munawarkazmi/esp32-cam-motion-detector)
- [Safina Portal](https://github.com/munawarkazmi/safina-portal-showcase)

Plain-language guides to ten of these live at
[munawarkazmi.com/projects/guides.html](https://munawarkazmi.com/projects/guides.html).

Every number on the site comes from one of those repositories.
[tools/drift.py](tools/drift.py) checks that they still agree: it fails if a
stated figure no longer appears upstream, if a chart's generator or data has
been committed more recently than the copy served here, or if the sitemap
dates have fallen behind the pages. It is a check, not a build step; the page
is still the code in this repository.

Two figures on the home page are programs, not pictures. The one at the top
works out a small legibility trade-off in the browser, and the one under
Engineering runs a small D* Lite beside a small A* on a map the visitor can
draw walls on. Both are toys and say so where they stand: their numbers are
computed on the page and are not results from the repositories above.
[tools/test_replan_lab.js](tools/test_replan_lab.js) checks the planners in
the second against Dijkstra over random maps.

Five project pages go further and run the project's own algorithm, ported
line for line: the safety verifier page replays the committed model
proposals through a JavaScript port of the verifier, the llm-nav-shield page
runs the whole detect, recover or halt loop with the same A* and reference
checker, the exact-predicates page runs the committed adversarial corpus
through both the float and the exact predicate, the toolcall-contract
page runs both validator layers on the committed model replies, and the
plan-failure-bench page walks the committed plans through the checker. The
ESP32-CAM page runs the detection firmware's downsampler and detector on the
visitor's own camera, or on a synthetic scene, in the browser. The
legibility-bounds page shows the committed certified intervals and grades a
typed planner score against them; the lattice is not rebuilt there. Their data
files are generated from the sibling repositories by
`tools/make_*_lab_data.js`, and the matching `tools/test_*_lab.js` require
the ports to reproduce every committed verdict, bucket, interval and
recovered path.

All content and design, all rights reserved.
