# AstroCura

**An offline health co-pilot for astronauts on long missions.** Built for the NASA Space Apps Challenge 2026, challenge "Create Health Monitoring Software for Astronauts on Space Missions".

AstroCura learns each crew member's own normal, watches 13 health indicators grouped under NASA's five Human Research Program hazards, and explains what is changing and what to do. When the ground is a conversation away it says *call*. When the ground is twenty minutes away it says *act now* and prepares a compact downlink packet.

**Live demo:** open `index.html` (a single self-contained file, no server, no network). If this repository has GitHub Pages enabled, the demo is served from the repository root.

**Demo video (29.5 s):** [`demo/AstroCura_demo.mp4`](demo/AstroCura_demo.mp4). Video and music made with AI assistance (Claude, Anthropic). Demo data is simulated.

## What is in the app

Nine views: Overview, Trends, Crew of four, Actions and downlink (with a printable flight-surgeon report), Check-in and data, Stress test, NASA OSDR data, Method and Validation. It runs fully offline in a browser.

## Real, simulated and assumed

- **Real:** the NASA OSDR tab uses study OSD-569 (Inspiration4 whole blood, complete blood count), https://osdr.nasa.gov/bio/repo/data/studies/OSD-569 . It is shown unmodified except for two documented exclusions (one internally inconsistent row, one blank cell).
- **Simulated:** the Mars-transit crew data and the crew of four are synthetic and labelled as simulated everywhere in the app.
- **Assumed:** fixed hard limits are placeholders, not clinical thresholds. AstroCura is a research prototype, not a medical device.

## Method in one paragraph

Robust personal baseline (median and MAD over 28 days), autocorrelation-aware scaling, EWMA smoothing and a leaky CUSUM for Watch and Alert, hard-limit overrides, rule-based insights, delay-aware triage and a radiation budget. Detection delay and false-alarm rate are measured by Monte-Carlo simulation (see the Validation tab and `dist/validation.json`).

## Build and test

```bash
npm install          # installs esbuild only
npm test             # 35 engine tests
npm run build        # writes dist/index.html (single file) and recomputes validation
```

`src/engine.js` is the dependency-free statistical engine, `src/app.js` the interface, `src/style.css` the styles. `tools/` holds the scripts used to record the demo video and synthesize its soundtrack.

## Use of AI

AI tools were used in building this project, as NASA's rules require us to say. Claude (Anthropic) wrote the application code (engine, simulator, interface, tests), drafted the written submission and helped record and edit the demo video, under the team's direction. The video's music and sound effects were synthesized by code written by Claude, with no third-party music or samples. The team defined the project, chose the challenge, reviewed the results and verified the cited sources. Details are in `SUBMISSION.md`.

## Acknowledgements

NASA Open Science Data Repository (OSDR) and NASA's Human Research Program hazard framework. Inter typeface (SIL Open Font License).
