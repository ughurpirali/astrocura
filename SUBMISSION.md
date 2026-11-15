# AstroCura: submission texts (NASA Space Apps 2026)

Challenge: **Create Health Monitoring Software for Astronauts on Space Missions**
Deadline: **Sun 15 Nov 2026, 11:59 PM, your event's local time.** Submission is final. Use "Save Progress" often.

Items in [square brackets] are for you to fill in or confirm. Everything else is ready to paste.

---

## 1. Project Summary (50–200 words; this one is 173)

AstroCura is an offline-first health co-pilot for astronauts on missions where Mission Control is minutes away. It learns each crew member's own baseline from sleep, mood, stress, reaction time, heart rate, HRV, blood pressure, body mass, exercise, temperature, SpO₂, cabin CO₂ and radiation dose, then flags sustained drift with robust statistics (a leaky CUSUM) instead of population ranges. Indicators are organised by NASA's five human-spaceflight hazards, and cross-hazard rules turn drift into plain-language findings such as illness, sleep restriction or cardiovascular deconditioning, with the evidence shown. Because communication delay on a Mars mission grows to many minutes each way, triage adapts: act now, call ground, or send a compact downlink packet and keep working the onboard protocol. The demo runs entirely in the browser on a clearly labelled synthetic Mars-transit mission and includes real NASA OSDR Inspiration4 blood-count data. A stress-test lab lets anyone inject a problem into a simulated crew member and see how many days AstroCura needed to notice, and how often it misses. It is decision support, not a diagnostic device.

---

## 2. Project Details

### The problem
Long missions expose astronauts to radiation, isolation and confinement, distance from Earth, altered gravity and a hostile closed environment. NASA's Human Research Program treats these five hazards as coupled. On a Mars mission the delay to the ground reaches many minutes each way, so Mission Control's real-time view of crew health fades and astronauts must spot changes in themselves. The challenge asks for software that gathers health indicators and lets astronauts evaluate and act on their health status.

### What we built
A single-file web app (no server, no account, no network calls) about 230 KB, with nine views:
1. **Overview**: a plain-language headline for the selected day, one row per NASA hazard, ranked findings with evidence, radiation budget, and a short "Beyond the spacecraft" section on where the same idea could help on Earth (framed as possible, not tested). A button opens the flight-surgeon report.
2. **Trends**: any indicator against the person's own baseline band, plus a sustained-drift score.
3. **Crew of four**: four simulated crew members with different personal normals (an endurance athlete with a resting heart rate near 47 bpm, a long sleeper, a person with higher blood pressure, and the Mars-scenario commander), each with one injected drift. On one shared scale it shows the same indicator for all four, the personal band, a fixed placeholder limit, when AstroCura flagged each person and when the fixed limit fired. Because the drifts are injected, the page counts real drifts, catches and false flags. One click opens any of the four in the whole dashboard.
4. **Actions & downlink**: crew action list, a communication-delay selector (LEO, Moon, Mars close approach, Mars far side) that changes the triage advice, a compact downlink packet (text and ~1 KB JSON), and a flight-surgeon report (summary of readiness, findings, radiation and the last seven days) that opens in a dialog and prints or saves as a PDF.
5. **Check-in & data**: add a day, import or export CSV, switch datasets.
6. **Stress test**: pick an indicator, a size (in the person's own σ), a start day and sudden or gradual onset. A fresh simulated crew member is generated, AstroCura reports its Watch and Alert days next to a fixed-limit alarm, then repeats the same problem on 40 other simulated crew members (median delay, how many it missed, false Watches). One click loads the scenario into the Overview, Trends and Actions views.
7. **NASA OSDR data**: real Inspiration4 blood counts.
8. **Method**: hazard → HRP risk → indicator mapping, parameters, data provenance, limitations, references.
9. **Validation**: Monte-Carlo false-alarm and detection-delay results (independent and autocorrelated noise), re-runnable in the browser.

### Innovation
1. **Personal baselines, not population ranges.** Each indicator is compared with the crew member's own first 28 days (median and robust spread). On the real OSDR data, people differ from one another by up to about 3× more than they vary within themselves for red-cell count, haematocrit, haemoglobin, monocytes and platelets, so one population range fits nobody well.
2. **Explainable cross-hazard reasoning.** Rules combine drifting indicators into named patterns (illness, sleep restriction with performance impact, cardiovascular deconditioning, cabin air, radiation event) and show the evidence behind each.
3. **Delay-aware triage.** The recommended response depends on the one-way delay. Critical findings: act onboard and notify ground at once. Alerts: call ground only if the delay is about a minute or less, otherwise send the packet and keep working the protocol.
4. **Offline and private by design.** It runs on the habitat computer; crew data leaves only when the crew sends a packet.
5. **It shows where it fails.** The stress test lets judges or crew break a simulated crew member on purpose and see the misses as well as the catches. For example a 2σ sleep loss (0.9 h per night) is noticed in a median of about 9 days, is missed entirely in a few of 40 simulated crew members, and a fixed 3.5 h limit never fires.

### Method (short)
Robust personal baseline (median + 1.4826·MAD, with a noise floor) → adverse-direction z-score → evidence scaled by each indicator's own lag-1 autocorrelation → leaky one-sided CUSUM for sustained drift plus a single-day spike test → rule-based pattern insights → hard absolute limits override everything. Domain readiness = 100 − 25 × mean positive smoothed adverse z; overall = 0.5·weakest domain + 0.5·mean.

### Data: what is real, what is not
- **REAL:** Inspiration4 complete blood counts from NASA OSDR (OSD-569), four crew members. Used only in the NASA OSDR tab.
- **NASA-published values:** hazard and risk taxonomy (HRP); about 1.8 mSv/day cruise dose rate from Curiosity RAD (Zeitlin et al. 2013), which sets the simulated dose baseline; astronauts average roughly 6 h sleep against 8.5 h scheduled (Barger et al. 2014, NASA-funded), which sets the simulated sleep baseline.
- **SIMULATED:** every daily value in the Mars-transit scenario, the injected events (solar particle event, sleep restriction, exercise decline, illness, CO₂ scrubber degradation) and the communication-delay curve. Public daily crew data does not exist, so the simulation gives us ground truth to test against. The app labels it "SIMULATED DATA" on every screen.
- **ASSUMED:** typical resting physiology and spreads, hard limits (placeholders for a mission's medical requirements), and the wording of crew actions.

### Testing and validation (all on synthetic data; not clinical validation)
- **False alarms** (healthy crew member, 180 days, 400 simulated missions each): with independent daily noise, 11.3% of missions show any Watch and 1.0% any Alert; with autocorrelated noise (ρ = 0.25) 27.8% and 3.0%; (ρ = 0.4) 39.5% and 4.3%. Watch-level noise is the price of sensitivity.
- **Detection delay** (sustained shift starting day 40, 60 days to detect; four indicators; 200 missions per cell). With independent daily noise, a 2σ shift reaches Watch in a median of 6–7 days (90th percentile 19–23 days) and is missed in 2–4% of runs; Alert takes a median of 12–14 days and is missed in 10–17%. With realistic autocorrelated noise (ρ = 0.25) the 2σ Watch median is 8–9 days (90th percentile 24–34 days) and 10–21% are missed; Alert is missed in 30–37%. 3σ shifts reach Watch in a median of 3–4 days with at most 2% missed. 1σ shifts are mostly not reported, by design.
- **Mars scenario** (days 29–39 healthy: nothing raised). First Watch after event start: solar particle event +0 days; illness +2; CO₂ drift +10; exercise decline +22 (heart-rate variability, the first related signal, +17); sleep restriction +28.
- 35 automated engine tests pass (determinism, calibration quiet period, event detection, hard limits, triage logic, CSV round trip, missing data, stress-test lab, the simulated crew of four). The UI was tested across all nine tabs on desktop and phone widths with no console errors. axe-core (WCAG 2.2 AA) reports 0 violations on every tab, every text pair meets its contrast threshold, and Lighthouse scores Accessibility 100, Best Practices 100 and SEO 100 (Performance 100 on desktop, 98 on mobile). The cursor and playhead run on their own compositor layers: about 60 fps while scrubbing even with the CPU throttled 4×.

### What the real data does and does not show
Of 132 pre-flight blood-count values, 3 (2%) fall outside the lab's population range. At R+1, 1 of 48 values is outside the lab range, and 23 of 48 are outside the person's own 2–3-sample pre-flight range. Chance alone gives about 26, so **we do not claim detection or a flight effect from this**: four people and 2–3 baseline samples each is far too little. What the data does support is the premise behind personal baselines: between-person spread exceeds within-person spread for several analytes.

### Limitations (please read)
- Not a medical device; not clinically validated; decision support for a crew member and flight surgeon only.
- The detector was tuned and tested on synthetic noise. Real physiology adds circadian rhythm, workload, sensor dropout and microgravity adaptation.
- If a crew member is already drifting during the baseline window, the baseline absorbs it. Pre-flight data should seed it.
- Each crew member is analysed on their own. The Crew tab compares four simulated people, but there is no team or workload modelling. The four personal normals are plausible, not measured from real astronauts. Bone and vision risks are not measured.
- Hard limits and action text are placeholders to be replaced by a mission's own procedures.
- Cross-indicator pattern rules are exercised on the Mars scenario but not separately Monte-Carlo-tested.

### Future work
Ingest ISS cabin telemetry and RadLab dosimetry for realistic environment and dose baselines; validate on analog missions (e.g. HERA) through formal data requests; add a crew-level view, bone and vision modules, and a ground-side flight-surgeon console.

### Technology
Vanilla HTML/CSS/JavaScript, dependency-free; hand-built SVG charts; deterministic seeded simulator; one shared engine file used by the page and the tests. Works offline with an embedded font. Embedded Inter and a subset wordmark face (no network needed). Light, high-contrast interface (text contrast at or above 4.5:1 checked), keyboard operable, status never shown by colour alone, reduced motion respected.

---

## 3. NASA data & resources used (link list)

- NASA HRP, Five hazards of human spaceflight: https://www.nasa.gov/hrp/hazards/
- NASA HRP, Risks of human spaceflight: https://www.nasa.gov/hrp/risks/
- NASA HRP, Ongoing research: https://www.nasa.gov/hrp/ongoing-hrp-research/
- NASA OSDR study OSD-569 (Inspiration4 whole blood / CBC, file `LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv`): https://osdr.nasa.gov/bio/repo/data/studies/OSD-569
- Abadie and Francisco (2024), NASA NTRS 20230015521, Human Health and Performance: Keeping Astronauts Safe & Productive on a Mission to Mars: https://ntrs.nasa.gov/citations/20230015521

## 4. Space Agency Partner & other data / literature

- Canadian Space Agency, Monitoring radiation for astronaut health (context only): https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp
- Sanders et al. (2024), Inspiration4 data access through OSDR, npj Microgravity: https://www.nature.com/articles/s41526-024-00393-5
- Zeitlin et al. (2013), Curiosity RAD cruise radiation, Science (via SwRI release): https://www.swri.org/press-release/swri-led-team-calculates-radiation-exposure-associated-trip-mars
- Barger et al. (2014), sleep deficiency in astronauts, Lancet Neurology: https://doi.org/10.1016/S1474-4422(14)70122-X
- Garrett-Bakelman et al. (2019), NASA Twins Study, Science: https://doi.org/10.1126/science.aau8650

## 5. Use of Artificial Intelligence (SI) declaration

Suggested wording (edit so it matches what your team actually did):

> We used Claude (Anthropic) as a coding and writing assistant. Claude wrote the application code (the statistical engine, simulator, user interface and tests) and drafted the written submission under our direction. All NASA data was retrieved from NASA's public OSDR API; the data in the NASA OSDR tab is unmodified except for the documented exclusions (one internally inconsistent row and one blank cell). The Mars-transit crew data is synthetic and labelled as such everywhere in the app. The demo video was recorded from the app and edited with AI assistance, and its music and sound effects were synthesized by code written by Claude (no third-party music or samples); this is stated on the video's end card, in a small corner mark on the video and in its file metadata. [Our team defined the project, chose the challenge, reviewed the results and verified the cited sources: confirm or edit.]

## 6. Pitch

**30 seconds.** On a Mars mission, help is twenty minutes away, so the astronaut has to be the first doctor. AstroCura watches thirteen health signals against each astronaut's own normal, organises them by NASA's five hazards, and explains what is changing and what to do. If the ground is a conversation away it says call; if it is twenty minutes away it says act now and sends a compact packet. It runs offline, in a browser, and every number tells you whether it is real, simulated or assumed.

**2 minutes.** (1) The problem: coupled hazards, growing delay, crew as first responder. (2) Why personal baselines: on real Inspiration4 blood counts people differ from each other up to about three times more than from themselves. (3) Live demo: scrub to day 41, a solar particle event is flagged on its first day; to day 133, sleep restriction, deconditioning and an illness pattern are active, each with evidence; change the delay from low Earth orbit to Mars and watch the advice flip from "call ground" to "send and act"; copy the 1 KB downlink packet. (4) Honesty and the stress test: open Stress test, break a simulated crew member (for example a 2σ sleep loss from day 60) and show AstroCura noticing in about a week while a fixed-limit alarm never fires, then show the 40-crew line with how many it missed. Validation shows the trade-off (about 1% of healthy missions raise an Alert; with realistic noise a 2σ shift reaches Watch in a median of 8–9 days and 10–21% are missed), and the real-data tab states plainly that it supports the premise, not detection. (5) Next: analog-mission validation and a ground-side console.

## 7. Demo video script (≤ 30 s) and ≤ 7-slide alternative

**30-second video** (29.5 s, 1080p 60 fps, screen recording of the app with captions, music and sound effects):
- 0–2 s: title card "AstroCura. The astronaut's health co-pilot."
- 2–4 s: "On a Mars mission, help is 20 minutes away." (Overview, day 133)
- 4–6 s: "Day 41: a radiation event, flagged on its first day."
- 6–10 s: "Day 133: sleep loss, deconditioning, an illness pattern. Each with its evidence."
- 10–14 s: Crew of four tab: "Four people, four normals. The same number means different things."
- 14–19 s: Actions tab, delay LEO → Mars: "Near Earth: call ground." / "Same finding, different advice."
- 19–22 s: Flight-surgeon report: "A report for the ground team, ready to print."
- 22–26 s: Stress test tab: "See how fast it notices, and how often it misses."
- 26–29.5 s: end card "Offline. Explainable. Honest about what is simulated." + AI disclosure line.

**Slide outline (7):** 1 Problem and the five hazards. 2 Solution in one screenshot (Overview). 3 Personal baseline vs population range (OSDR figure). 4 Cross-hazard insights with evidence (Trends + insight cards). 5 Delay-aware triage and downlink packet. 6 Stress test, validation and honesty (stress-test screenshot, false-alarm and delay table; real vs simulated). 7 Limitations, next steps, team and links.

## 8. Final links and Before you press Submit

Paste-ready form values:
- **Project Demonstration:** `https://github.com/ughurpirali/astrocura/blob/main/demo/AstroCura_demo.mp4` (29.5 s video; or the YouTube Unlisted link if you use that instead)
- **Project:** `https://ughurpirali.github.io/astrocura/` (live site; source code at `https://github.com/ughurpirali/astrocura`)

- [ ] Open both links in a **private window** and confirm they need no login, password or permission. The video must play and the site must load.
- [ ] The demo video (`demo/AstroCura_demo.mp4`, 29.5 s, 1080p 60 fps, music and sound effects, small corner mark "AI-assisted video & music (Claude)") follows NASA's project submission guide, which asks for a visible watermark on AI-assisted video. If you also upload it to YouTube, use the description: "Demo of AstroCura for the NASA Space Apps Challenge 2026. Video and music produced with AI assistance (Claude, Anthropic). Demo data is simulated."
- [ ] Fill in the team members and the [bracketed] part of the AI declaration so it is true.
- [ ] Accept the terms yourselves and press Submit for Judging yourselves; Claude will not do this for you.
