// Dependency-free tests: node test/engine.test.js
const E = require('../src/engine.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const near = (a, b, t) => Math.abs(a - b) <= t;

// 1. determinism
const a = E.simulate({ seed: 2026, scenario: 'mars', days: 180 }), b = E.simulate({ seed: 2026, scenario: 'mars', days: 180 });
ok(JSON.stringify(a) === JSON.stringify(b), 'simulation is deterministic for a seed');
ok(a.length === 180 && E.INDICATORS.every((i) => a[0].values[i.id] != null), '180 days x 13 indicators');

// 2. no alarms during calibration, nominal mission stays quiet
const nom = E.analyze(E.simulate({ seed: 99, scenario: 'nominal', days: 180 }));
ok(nom.days.slice(0, 28).every((d) => d.level === 0 && d.calibrating), 'no alarms while calibrating');
ok(nom.days.filter((d) => d.level >= 2).length <= 5, 'nominal run has at most a handful of alert days: ' + nom.days.filter((d) => d.level >= 2).length);

// 3. injected events are detected, healthy stretch is quiet
const mars = E.analyze(a);
const first = (day0, day1, ids) => { for (const d of mars.days) if (d.day >= day0 && d.day <= day1 && d.insights.some((i) => ids.includes(i.id) && i.severity >= 1)) return d.day; return null; };
ok(first(41, 43, ['rad-event']) === 41, 'solar particle event flagged on day 1');
ok(first(55, 140, ['sleep-cluster', 'drift-sleep', 'drift-pvt']) !== null, 'sleep restriction detected');
ok(first(90, 160, ['deconditioning', 'drift-exercise', 'drift-hrv', 'drift-rhr', 'mass-exercise']) !== null, 'deconditioning detected');
ok(first(131, 138, ['illness']) !== null, 'illness detected within the episode');
ok(first(140, 180, ['cabin-co2', 'drift-co2']) !== null, 'CO2 drift detected');
ok(mars.days.filter((d) => d.day >= 29 && d.day <= 39).every((d) => d.insights.length === 0), 'healthy stretch before day 40 raises nothing');

// 4. hard limits always override
const rows = E.simulate({ seed: 5, scenario: 'nominal', days: 60 });
rows[59].values.spo2 = 88;
const hl = E.analyze(rows).days[59];
ok(hl.level === 3 && hl.ind.spo2.breach, 'SpO2 below the hard limit is Critical');

// 5. cross-domain pattern never escalates to Critical by itself
ok(!mars.days.some((d) => d.insights.some((i) => i.id === 'multi' && i.severity > 2)), 'multi-domain insight capped at Alert');

// 6. triage depends on delay
ok(E.triage(2, 0.5).mode.indexOf('CALL') >= 0, 'alert + short delay -> call ground');
ok(E.triage(2, 10).mode.indexOf('SEND') >= 0, 'alert + long delay -> send + act');
ok(E.triage(3, 0.1).mode.indexOf('ACT') >= 0 && E.triage(3, 20).mode.indexOf('ACT') >= 0, 'critical -> act now at any delay');
ok(E.commDelay(0, 180) < 0.1 && near(E.commDelay(180, 180), 12.4, 0.5), 'delay model ramps 0 -> ~12.4 min');

// 7. radiation budget
const rb = E.radiationBudget(mars, 100, 180);
ok(rb.cum > 150 && rb.cum < 260, 'cumulative dose at day 101 is plausible: ' + rb.cum.toFixed(0));

// 8. CSV round trip
const rt = E.fromCSV(E.toCSV(a.slice(0, 30)));
ok(rt.length === 30 && near(rt[7].values.sleep, a[7].values.sleep, 0.01), 'CSV round trip');

// 9. missing data is tolerated
const gap = E.simulate({ seed: 3, scenario: 'nominal', days: 80 }); gap[50].values.rhr = null; gap[51].values = {};
let threw = false; try { E.analyze(gap); } catch (e) { threw = true; }
ok(!threw, 'missing values do not crash the analysis');

// 10. downlink packet carries the reasoning and is compact
const pk = E.buildPacket(mars, 132, { delayMin: 10.5, crew: 'CM-1', totalDays: 180, simulated: true });
ok(/SIMULATED/.test(pk.text) && /Why:/.test(pk.text) && pk.bytesJson < 2000, 'packet labels simulated data, has reasoning, JSON < 2 KB: ' + pk.bytesJson);


// 11. stress-test lab
const lr = E.labRun({ seed: 11, id: 'sleep', sigmas: 3, day: 60, ramp: 0 });
ok(lr.watch !== null && lr.watch >= 60 && lr.watch - 60 <= 15, 'lab: a sudden 3 sigma sleep loss is noticed within 15 days: day ' + lr.watch);
ok(E.fixedLimitDay(lr.rows, 'sleep', 60) === null, 'lab: a fixed 3.5 h limit never fires for a 3 sigma sleep loss');
ok(E.fixedLimitDay(lr.rows, 'mood', 60) === undefined, 'lab: signals without a fixed limit report undefined');
const nobody = E.labRun({ seed: 11, id: 'sleep', sigmas: 0, day: 60 });
ok(nobody.watch === null || nobody.watch - 60 > 15 || nobody.early === false, 'lab: a zero-size problem is not reliably flagged');
const t0 = Date.now(); const lc = E.labCohort({ seed: 5, id: 'rhr', sigmas: 2, day: 60, ramp: 0 }, 40); const dt = Date.now() - t0;
ok(lc.n === 40 && lc.watchMiss <= 4 && lc.watchMedian <= 12, 'lab: 40-crew cohort at 2 sigma: median ' + lc.watchMedian + ' d, missed ' + lc.watchMiss + '/40 (' + dt + ' ms)');
const same = JSON.stringify(E.simulateShift({ seed: 3, id: 'co2', sigmas: 2, day: 50 })) === JSON.stringify(E.simulateShift({ seed: 3, id: 'co2', sigmas: 2, day: 50 }));
ok(same, 'lab: simulation is deterministic for a seed');

// 12. simulated crew of four: different normals, one real drift each, none visible to a fixed limit
ok(E.CREW.length === 4, 'crew: four members');
ok(JSON.stringify(E.simulateCrew('cmd')) === JSON.stringify(a), 'crew: the Commander is the Mars-transit scenario');
ok(JSON.stringify(E.simulateCrew('plt')) === JSON.stringify(E.simulateCrew('plt')), 'crew: deterministic');
const cr = {}; E.CREW.forEach((m) => { const rows = E.simulateCrew(m.id); cr[m.id] = { rows, a: E.analyze(rows) }; });
ok(cr.plt.a.baseline.rhr.med < 50 && cr.eng.a.baseline.rhr.med > 66 && cr.med.a.baseline.sleep.med > 7.5 && cr.cmd.a.baseline.sleep.med < 7, 'crew: personal normals differ a lot between people');
const firstFlag = (id, ind) => { const d = cr[id].a.days.find((x, i) => !x.calibrating && x.ind[ind].level >= 1); return d ? d.day : null; };
ok(firstFlag('plt', 'rhr') >= 70 && firstFlag('plt', 'rhr') <= 100, 'crew: pilot heart-rate drift flagged after it starts: day ' + firstFlag('plt', 'rhr'));
ok(firstFlag('eng', 'sbp') >= 80 && firstFlag('eng', 'sbp') <= 135, 'crew: engineer blood-pressure drift flagged: day ' + firstFlag('eng', 'sbp'));
ok(firstFlag('med', 'sleep') >= 100 && firstFlag('med', 'sleep') <= 135, 'crew: physician sleep drift flagged: day ' + firstFlag('med', 'sleep'));
ok(E.fixedLimitDay(cr.plt.rows, 'rhr') === null && E.fixedLimitDay(cr.eng.rows, 'sbp') === null && E.fixedLimitDay(cr.med.rows, 'sleep') === null, 'crew: the fixed limits never fire on those three drifts');
ok(firstFlag('plt', 'sleep') === null && firstFlag('eng', 'sleep') === null && firstFlag('cmd', 'sbp') === null, 'crew: no flags on indicators without an injected drift (these three)');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
