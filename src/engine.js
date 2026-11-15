/* AstroCura engine — personal-baseline drift detection, pattern reasoning,
 * delay-aware triage, downlink packets, scenario simulator and Monte-Carlo validation.
 * Pure functions, no DOM, no network. Runs in the browser and in Node (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AstroEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Domain + indicator model (mapped to NASA HRP's five hazards)
   * ------------------------------------------------------------------ */
  const DOMAINS = [
    { id: 'radiation', name: 'Space radiation', short: 'Radiation', scored: true },
    { id: 'isolation', name: 'Isolation & confinement', short: 'Isolation', scored: true },
    { id: 'gravity', name: 'Altered gravity', short: 'Gravity', scored: true },
    { id: 'environment', name: 'Hostile / closed environment', short: 'Environment', scored: true },
    { id: 'distance', name: 'Distance from Earth', short: 'Distance', scored: false },
  ];

  // dir: +1 high is adverse, -1 low is adverse, 0 two-sided.
  // floor: minimum robust sigma (native units) so a very quiet baseline cannot create hair-trigger alarms.
  // hard: absolute placeholder limits, to be replaced by mission medical requirements.
  // sim: [mean, sd] used by the scenario simulator and by the Monte-Carlo validation.
  const INDICATORS = [
    { id: 'dose', label: 'Radiation dose rate', unit: 'mSv/day', domain: 'radiation', dir: +1, floor: 0.06, dec: 2, hard: null, sim: [1.8, 0.08], source: 'dosimeter' },
    { id: 'sleep', label: 'Sleep duration', unit: 'h', domain: 'isolation', dir: -1, floor: 0.3, dec: 1, hard: { lo: 3.5 }, sim: [6.5, 0.45], source: 'wrist actigraphy' },
    { id: 'mood', label: 'Mood (self-report)', unit: '/10', domain: 'isolation', dir: -1, floor: 0.5, dec: 1, hard: null, sim: [7.5, 0.7], source: 'daily check-in' },
    { id: 'stress', label: 'Stress (self-report)', unit: '/10', domain: 'isolation', dir: +1, floor: 0.6, dec: 1, hard: null, sim: [3.0, 0.8], source: 'daily check-in' },
    { id: 'pvt', label: 'Reaction time (PVT median)', unit: 'ms', domain: 'isolation', dir: +1, floor: 10, dec: 0, hard: null, sim: [265, 14], source: '3-min PVT' },
    { id: 'rhr', label: 'Resting heart rate', unit: 'bpm', domain: 'gravity', dir: +1, floor: 2, dec: 0, hard: { hi: 110, lo: 40 }, sim: [58, 2.5], source: 'wearable' },
    { id: 'hrv', label: 'Heart-rate variability (RMSSD)', unit: 'ms', domain: 'gravity', dir: -1, floor: 5, dec: 0, hard: null, sim: [58, 7], source: 'wearable' },
    { id: 'sbp', label: 'Systolic blood pressure', unit: 'mmHg', domain: 'gravity', dir: 0, floor: 4, dec: 0, hard: { hi: 160, lo: 85 }, sim: [114, 5], source: 'cuff' },
    { id: 'mass', label: 'Body mass', unit: 'kg', domain: 'gravity', dir: -1, floor: 0.3, dec: 1, hard: null, sim: [78.0, 0.35], source: 'mass device' },
    { id: 'exercise', label: 'Exercise prescription completed', unit: '%', domain: 'gravity', dir: -1, floor: 4, dec: 0, hard: null, sim: [90, 6], source: 'exercise log' },
    { id: 'co2', label: 'Cabin CO₂', unit: 'ppm', domain: 'environment', dir: +1, floor: 150, dec: 0, hard: { hi: 7000 }, sim: [2800, 180], source: 'cabin sensor' },
    { id: 'temp', label: 'Body temperature', unit: '°C', domain: 'environment', dir: +1, floor: 0.15, dec: 2, hard: { hi: 38.0 }, sim: [36.6, 0.18], source: 'thermometer' },
    { id: 'spo2', label: 'Blood oxygen (SpO₂)', unit: '%', domain: 'environment', dir: -1, floor: 0.4, dec: 1, hard: { lo: 92 }, sim: [97.5, 0.5], source: 'pulse oximeter' },
  ];
  const IND = Object.fromEntries(INDICATORS.map((i) => [i.id, i]));

  const DEFAULTS = {
    baselineDays: 28,
    lambda: 0.2, // EWMA smoothing
    gamma: 0.95, // CUSUM leakage (forgets old evidence; ~20-day memory)
    k: 1.0, // CUSUM reference value (sigma units): tuned for sustained shifts of ~2 sigma or more
    hWatch: 6.0, // single-indicator CUSUM level that raises a Watch
    hAlert: 10.5, // single-indicator CUSUM level that raises an Alert
    autoCorr: true, // scale evidence by the baseline lag-1 autocorrelation
    spikeZ: 6.0, // single-day adverse deviation (sigma) that raises an Alert
    doseBudgetMSv: 400, // configurable mission dose budget
  };

  /* ------------------------------------------------------------------ *
   * 2. Robust statistics
   * ------------------------------------------------------------------ */
  function median(a) {
    const b = a.filter((v) => v != null && isFinite(v)).slice().sort((x, y) => x - y);
    if (!b.length) return NaN;
    const m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function lag1(values, med, sigma) {
    let num = 0, den = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] == null || values[i - 1] == null) continue;
      num += ((values[i] - med) / sigma) * ((values[i - 1] - med) / sigma);
    }
    values.forEach((v) => { if (v != null) den += Math.pow((v - med) / sigma, 2); });
    return den > 0 ? Math.min(0.7, Math.max(0, num / den)) : 0;
  }
  function robustBaseline(values, floor) {
    const med = median(values);
    const mad = median(values.map((v) => (v == null ? null : Math.abs(v - med))));
    const sigma = Math.max(1.4826 * mad, floor);
    return { med, sigma, n: values.filter((v) => v != null).length };
  }

  /* ------------------------------------------------------------------ *
   * 3. Analysis: per-indicator z, EWMA, leaky CUSUM, levels
   * ------------------------------------------------------------------ */
  function adverse(ind, z) {
    if (ind.dir === 0) return Math.abs(z) - 0.798; // two-sided: centre |z| on its expected value
    return ind.dir * z;
  }

  function hardBreach(ind, x) {
    if (!ind.hard || x == null) return null;
    if (ind.hard.hi != null && x >= ind.hard.hi) return 'hi';
    if (ind.hard.lo != null && x <= ind.hard.lo) return 'lo';
    return null;
  }

  function analyze(rows, optsIn) {
    const o = Object.assign({}, DEFAULTS, optsIn || {});
    const B = Math.min(o.baselineDays, rows.length);
    const baseline = {};
    INDICATORS.forEach((ind) => {
      const vals = rows.slice(0, B).map((r) => (r.values[ind.id] == null ? null : r.values[ind.id]));
      baseline[ind.id] = robustBaseline(vals, ind.floor);
      baseline[ind.id].rho = lag1(vals, baseline[ind.id].med, baseline[ind.id].sigma);
      // variance-inflation of a running sum under AR(1): (1+rho)/(1-rho). Evidence is scaled by its inverse square root.
      baseline[ind.id].scale = o.autoCorr ? 1 / Math.sqrt((1 + baseline[ind.id].rho) / (1 - baseline[ind.id].rho)) : 1;
    });

    const sigmaE = Math.sqrt(o.lambda / (2 - o.lambda));
    const state = {};
    INDICATORS.forEach((ind) => (state[ind.id] = { e: 0, s: 0 }));

    const days = rows.map((row, t) => {
      const calibrating = t < B;
      const ind = {};
      INDICATORS.forEach((def) => {
        const x = row.values[def.id];
        const b = baseline[def.id];
        const st = state[def.id];
        if (x == null || !isFinite(x)) {
          ind[def.id] = { x: null, z: null, a: null, ewma: st.e, ewmaZ: st.e / sigmaE, cusum: st.s, level: 0, breach: null, missing: true };
          return;
        }
        const z = (x - b.med) / b.sigma;
        const a = adverse(def, z);
        const as = a * b.scale; // autocorrelation-scaled evidence
        st.e = o.lambda * as + (1 - o.lambda) * st.e;
        st.s = Math.max(0, o.gamma * st.s + as - o.k);
        const breach = calibrating ? null : hardBreach(def, x);
        let level = 0;
        if (!calibrating) {
          if (breach) level = 3;
          else if (st.s >= o.hAlert || a >= o.spikeZ) level = 2;
          else if (st.s >= o.hWatch) level = 1;
        }
        ind[def.id] = { x, z, a, ewma: st.e, ewmaZ: st.e / sigmaE, cusum: st.s, level, breach, missing: false };
      });

      // Domain readiness: 100 - 25 * mean positive EWMA of adverse z (sigma units)
      const domain = {};
      DOMAINS.forEach((d) => {
        if (!d.scored) return;
        const members = INDICATORS.filter((i) => i.domain === d.id);
        const m = members.reduce((s, i) => s + Math.max(0, ind[i.id].ewma), 0) / members.length;
        const lvl = Math.max.apply(null, members.map((i) => ind[i.id].level));
        domain[d.id] = { score: calibrating ? 100 : Math.max(0, Math.round(100 - 25 * m)), level: lvl, m };
      });
      const scores = Object.values(domain).map((d) => d.score);
      const overall = Math.round(0.5 * Math.min.apply(null, scores) + 0.5 * (scores.reduce((a, b) => a + b, 0) / scores.length));
      return { day: row.day, calibrating, ind, domain, overall, insights: null, level: 0 };
    });

    // insights need history (e.g. "any of last 3 days"), so compute after the pass
    days.forEach((d, t) => {
      d.insights = buildInsights(days, t, baseline, o);
      d.level = d.insights.reduce((m, i) => Math.max(m, i.severity), 0);
    });

    return { baseline, days, opts: o, rows };
  }

  /* ------------------------------------------------------------------ *
   * 4. Pattern reasoning — turns indicator drift into named, explainable insights
   * ------------------------------------------------------------------ */
  function recentLevel(days, t, id, w) {
    let m = 0;
    for (let k = Math.max(0, t - (w - 1)); k <= t; k++) m = Math.max(m, days[k].ind[id].level);
    return m;
  }

  function evidence(days, t, baseline, ids) {
    return ids
      .filter((id) => !days[t].ind[id].missing)
      .map((id) => {
        const s = days[t].ind[id];
        return { id, label: IND[id].label, unit: IND[id].unit, dec: IND[id].dec, x: s.x, base: baseline[id].med, z: s.z, cusum: s.cusum, level: s.level, domain: IND[id].domain };
      });
  }

  function buildInsights(days, t, baseline, o) {
    const d = days[t];
    if (d.calibrating) return [];
    const L = (id, w) => recentLevel(days, t, id, w || 1);
    const out = [];
    const used = new Set();
    const add = (ins, ids) => {
      ins.evidence = evidence(days, t, baseline, ids);
      ids.forEach((i) => used.add(i));
      out.push(ins);
    };

    // P5 — radiation event (single-day ratio vs personal baseline) and hard-coded 3x / 6x rule
    {
      const s = d.ind.dose;
      if (!s.missing) {
        const ratio = s.x / baseline.dose.med;
        if (ratio >= 3) {
          add(
            {
              id: 'rad-event',
              title: ratio >= 6 ? 'Major radiation event (dose rate far above baseline)' : 'Radiation event (dose rate well above baseline)',
              severity: ratio >= 6 ? 3 : 2,
              domain: 'radiation',
              why: 'Daily dose equivalent is ' + ratio.toFixed(1) + '× the crew-member baseline. A solar particle event is the usual cause; shielded shelter is the standard response.',
              actions: [
                'Follow the mission radiation-shelter procedure now.',
                'Log time in shelter and the dosimeter reading when you exit.',
                'Re-check dosimeters after the event and compare with the dose budget (Actions tab).',
              ],
            },
            ['dose']
          );
        }
      }
    }

    // P3 — acute illness pattern (temp + cardiovascular + oxygen, window of 3 days)
    {
      const lt = L('temp', 3), lr = L('rhr', 3), lh = L('hrv', 3), ls = L('spo2', 3);
      const hits = [lt, lr, lh, ls].filter((v) => v >= 1).length;
      if (lt >= 1 && hits >= 2) {
        const sev = Math.max(lt, hits >= 3 ? 2 : 1, ls >= 1 ? 2 : 1);
        add(
          {
            id: 'illness',
            title: 'Possible acute illness / infection pattern',
            severity: Math.min(3, sev),
            domain: 'environment',
            why: 'Body temperature is up together with ' + [lr >= 1 ? 'resting heart rate' : null, lh >= 1 ? 'lower HRV' : null, ls >= 1 ? 'lower SpO₂' : null].filter(Boolean).join(' and ') + ' within the last 3 days. This combination is the signature used by wearable illness-detection research.',
            actions: [
              'Take a manual temperature and symptom check; follow the onboard medical checklist.',
              'Rest, hydrate, and tell the crew medical officer.',
              'Isolate from shared surfaces and food prep if symptoms are consistent with infection.',
              'Re-measure in 12–24 h; escalate sooner if SpO₂ keeps falling.',
            ],
          },
          ['temp', 'rhr', 'hrv', 'spo2']
        );
      }
    }

    // P1 — cumulative sleep restriction / cognitive cluster
    {
      const ls = L('sleep'), lp = L('pvt'), lm = L('mood'), lx = L('stress');
      const hits = [ls, lp, lm, lx].filter((v) => v >= 1).length;
      if (ls >= 1 && hits >= 2) {
        const sev = ls >= 2 || hits >= 3 ? 2 : 1;
        add(
          {
            id: 'sleep-cluster',
            title: 'Cumulative sleep restriction with performance impact',
            severity: sev,
            domain: 'isolation',
            why: 'Sleep duration is drifting below this crew member’s own baseline, and ' + [lp >= 1 ? 'reaction time is slower' : null, lm >= 1 ? 'mood is lower' : null, lx >= 1 ? 'stress is higher' : null].filter(Boolean).join(' and ') + '. NASA-funded work found crews average only about 6 h against 8.5 h scheduled.',
            actions: [
              'Protect the scheduled sleep period; remove non-critical tasks from the 2 h before it.',
              'Use the lighting protocol (dim/warm before sleep, bright/blue after waking) if the habitat supports it.',
              'Avoid safety-critical tasks after short nights; double-check procedures with a crewmate.',
              'Discuss any sleep-aid use with the flight surgeon; do not stack doses.',
            ],
          },
          ['sleep', 'pvt', 'mood', 'stress']
        );
      }
    }

    // P2 — cardiovascular deconditioning
    {
      const lr = L('rhr'), lh = L('hrv'), le = L('exercise'), lb = L('sbp'), lw = L('mass');
      if ((lr >= 1 && lh >= 1) || (le >= 1 && (lr >= 1 || lh >= 1))) {
        const hits = [lr, lh, le, lb].filter((v) => v >= 1).length;
        add(
          {
            id: 'deconditioning',
            title: 'Cardiovascular deconditioning trend',
            severity: Math.max(lr, lh, le) >= 2 || hits >= 3 ? 2 : 1,
            domain: 'gravity',
            why: 'Resting heart rate and/or HRV are drifting' + (le >= 1 ? ' while the exercise prescription is slipping' : '') + '. Reduced loading in altered gravity is a known driver of cardiovascular and musculoskeletal decline.',
            actions: [
              'Restore the full exercise prescription for the next 7 days (aerobic + resistive).',
              'Log perceived exertion; if heart rate stays high at the same workload, report it.',
              'Schedule a bone/muscle countermeasure review with ground at the next routine downlink.',
            ],
          },
          ['rhr', 'hrv', 'exercise', 'sbp']
        );
      }
    }

    // P7 — body mass + exercise (energy balance / muscle loss)
    if (!used.has('exercise') || !used.has('mass')) {
      const lw = L('mass'), le = L('exercise');
      if (lw >= 1 && le >= 1 && !out.find((i) => i.id === 'deconditioning')) {
        add(
          {
            id: 'mass-exercise',
            title: 'Body mass falling with reduced exercise',
            severity: 1,
            domain: 'gravity',
            why: 'Body mass is trending below baseline while exercise completion is lower — possible negative energy balance or muscle loss.',
            actions: ['Review food intake against the prescribed energy target.', 'Re-establish the resistive exercise schedule.'],
          },
          ['mass', 'exercise']
        );
      }
    }

    // P4 — cabin air
    {
      const lc = L('co2'), lp = L('pvt'), lm = L('mood');
      if (lc >= 1) {
        const link = lp >= 1 || lm >= 1;
        add(
          {
            id: 'cabin-co2',
            title: link ? 'Cabin CO₂ rising alongside cognitive drift' : 'Cabin CO₂ drifting above baseline',
            severity: Math.min(3, Math.max(lc, link ? 2 : 1)),
            domain: 'environment',
            why: 'Cabin CO₂ is above its own baseline' + (link ? ' and slower reaction time/mood decline coincide with it. Elevated CO₂ can cause headache and reduced alertness.' : '. Left unchecked, it can degrade alertness.'),
            actions: [
              'Check scrubber and ventilation status and local airflow around sleep stations.',
              'Move to a better-ventilated module for cognitively demanding work if possible.',
              'Report the trend to ground with the CO₂ time series attached (Actions tab).',
            ],
          },
          ['co2', 'pvt', 'mood']
        );
      }
    }

    // P6 — psychological strain
    if (!used.has('mood') || !used.has('stress')) {
      const lm = L('mood'), lx = L('stress');
      if (lm >= 1 && lx >= 1) {
        add(
          {
            id: 'psych',
            title: 'Psychological strain pattern',
            severity: Math.max(lm, lx) >= 2 ? 2 : 1,
            domain: 'isolation',
            why: 'Mood is lower and stress is higher than this crew member’s baseline for several days.',
            actions: [
              'Use scheduled private family/peer contact and a rest period; talk to a crewmate.',
              'Request a behavioural-health check-in; ground can schedule it even with delay.',
            ],
          },
          ['mood', 'stress']
        );
      }
    }

    // Single-indicator drift for anything not covered by a pattern above
    INDICATORS.forEach((def) => {
      if (used.has(def.id)) return;
      const s = d.ind[def.id];
      if (s.missing || s.level < 1) return;
      const hard = s.breach;
      add(
        {
          id: 'drift-' + def.id,
          title: hard ? def.label + ' outside the hard limit' : def.label + ' drifting from baseline',
          severity: s.level,
          domain: def.domain,
          why: hard
            ? def.label + ' is outside the configured absolute limit (' + (hard === 'hi' ? '≥ ' + def.hard.hi : '≤ ' + def.hard.lo) + ' ' + def.unit + ').'
            : def.label + ' has moved ' + (s.z >= 0 ? 'up' : 'down') + ' by ' + Math.abs(s.z).toFixed(1) + 'σ against this crew member’s own baseline; the sustained-drift score is ' + s.cusum.toFixed(1) + '.',
          actions: ['Repeat the measurement and confirm the sensor/placement.', 'Note context (workload, meals, sleep) in the log and re-check within 24 h.'],
        },
        [def.id]
      );
    });

    // Hard-limit overrides: any breached indicator makes its insight critical
    out.forEach((ins) => {
      if (ins.evidence.some((e) => d.ind[e.id].breach)) {
        ins.severity = 3;
        ins.hardLimit = true;
      }
    });

    // P8 — concurrent multi-domain drift
    {
      const domainsHit = new Set(out.filter((i) => i.severity >= 1).map((i) => i.domain));
      const domainsAlert = new Set(out.filter((i) => i.severity >= 2).map((i) => i.domain));
      if (domainsHit.size >= 3) {
        out.push({
          id: 'multi',
          title: 'Concurrent drift across ' + domainsHit.size + ' hazard domains',
          severity: 2, // a combination of Alerts is escalated for review, never to Critical on its own
          domain: 'multi',
          why: 'NASA treats the hazards as coupled; several domains drifting at once is more informative than any single signal and may share a cause (workload, illness, environment).',
          actions: ['Treat the individual alerts above as one problem.', 'Request a consolidated review with the flight surgeon.', 'Reduce discretionary workload until trends stabilise.'],
          evidence: [],
        });
      }
    }

    out.sort((a, b) => b.severity - a.severity);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 5. Delay-aware triage (distance-from-Earth hazard)
   * ------------------------------------------------------------------ */
  function triage(severity, delayMin) {
    const rtt = 2 * delayMin;
    const fmt = (m) => (m < 1 ? Math.round(m * 60) + ' s' : m.toFixed(m < 10 ? 1 : 0) + ' min');
    if (severity >= 3)
      return { mode: 'ACT NOW', tone: 'critical', text: 'Act on the onboard emergency/medical procedure immediately and notify ground at the same time. Do not wait for a reply (round trip ' + fmt(rtt) + ').' };
    if (severity === 2) {
      if (delayMin <= 1) return { mode: 'CALL GROUND', tone: 'alert', text: 'Real-time conversation is feasible (round trip ' + fmt(rtt) + '). Contact the flight surgeon now.' };
      return { mode: 'SEND + ACT', tone: 'alert', text: 'Send the downlink packet now and continue with the onboard protocol. Expect a ground reply no sooner than ' + fmt(rtt) + '.' };
    }
    return { mode: 'LOG + WATCH', tone: 'watch', text: 'Log it, include it in the next routine downlink and re-evaluate within 24 h.' };
  }

  function commDelay(day, totalDays) {
    // Scenario parameter: smooth growth of one-way light time during an outbound Mars transit (0 → ~12.4 min)
    const f = (1 - Math.cos(Math.PI * Math.min(1, day / (totalDays || 180)))) / 2;
    return 0.05 + 12.4 * f;
  }

  /* ------------------------------------------------------------------ *
   * 6. Radiation budget
   * ------------------------------------------------------------------ */
  function radiationBudget(analysis, t, totalDays) {
    const days = analysis.days;
    const cum = days.slice(0, t + 1).reduce((s, d) => s + (d.ind.dose.x || 0), 0);
    const recent = days.slice(Math.max(0, t - 13), t + 1).map((d) => d.ind.dose.x).filter((v) => v != null);
    const rate = median(recent); // median is robust to a short SPE
    const remaining = Math.max(0, (totalDays || days.length) - (t + 1));
    const forecast = cum + rate * remaining;
    const budget = analysis.opts.doseBudgetMSv;
    return { cum, rate, forecast, budget, pctNow: cum / budget, pctForecast: forecast / budget };
  }

  /* ------------------------------------------------------------------ *
   * 7. Downlink packet (store-and-forward summary for ground)
   * ------------------------------------------------------------------ */
  function buildPacket(analysis, t, ctx) {
    const d = analysis.days[t];
    const b = analysis.baseline;
    const delay = ctx.delayMin;
    const tri = (sev) => triage(sev, delay);
    const lines = [];
    lines.push('ASTROCURA DOWNLINK  •  MISSION DAY ' + d.day + '  •  CREW ' + (ctx.crew || 'CM-1'));
    lines.push('One-way delay ' + delay.toFixed(1) + ' min • ground reply ETA ≥ ' + (2 * delay).toFixed(1) + ' min');
    if (ctx.simulated) lines.push('DATA SOURCE: SIMULATED SCENARIO (not a real crew)');
    lines.push('Overall readiness ' + d.overall + '/100  |  ' + DOMAINS.filter((x) => x.scored).map((x) => x.short + ' ' + d.domain[x.id].score).join('  '));
    lines.push('');
    if (!d.insights.length) lines.push('No active insights. All indicators within personal baseline.');
    d.insights.forEach((i, n) => {
      lines.push((n + 1) + '. [' + ['', 'WATCH', 'ALERT', 'CRITICAL'][i.severity] + '] ' + i.title);
      lines.push('   Why: ' + i.why);
      const ev = i.evidence.filter((e) => e.level >= 1);
      if (ev.length) lines.push('   Evidence: ' + ev.map((e) => e.label + ' ' + e.x.toFixed(e.dec) + ' ' + e.unit + ' (baseline ' + e.base.toFixed(e.dec) + ', ' + (e.z >= 0 ? '+' : '') + e.z.toFixed(1) + 'σ)').join('; '));
      lines.push('   Triage: ' + tri(i.severity).mode + ' — ' + tri(i.severity).text);
    });
    const rb = radiationBudget(analysis, t, ctx.totalDays);
    lines.push('');
    lines.push('Radiation: cumulative ' + rb.cum.toFixed(0) + ' mSv (' + Math.round(rb.pctNow * 100) + '% of ' + rb.budget + ' mSv budget); forecast at mission end ' + rb.forecast.toFixed(0) + ' mSv (' + Math.round(rb.pctForecast * 100) + '%).');
    const trend = INDICATORS.map((ind) => {
      const v = analysis.days.slice(Math.max(0, t - 6), t + 1).map((x) => x.ind[ind.id].x).filter((x) => x != null);
      if (!v.length) return null;
      const m = v.reduce((a, c) => a + c, 0) / v.length;
      return ind.label + ': 7-day mean ' + m.toFixed(ind.dec) + ' ' + ind.unit + ' (baseline ' + b[ind.id].med.toFixed(ind.dec) + ')';
    }).filter(Boolean);
    lines.push('');
    lines.push('7-day summary');
    trend.forEach((x) => lines.push('  ' + x));
    lines.push('');
    lines.push('Decision support only. Not a diagnosis. Follow flight-surgeon and onboard medical procedures.');
    const text = lines.join('\n');
    const json = JSON.stringify({
      day: d.day, crew: ctx.crew || 'CM-1', simulated: !!ctx.simulated, delayMin: +delay.toFixed(2), overall: d.overall,
      domains: Object.fromEntries(Object.entries(d.domain).map(([k, v]) => [k, v.score])),
      insights: d.insights.map((i) => ({ id: i.id, severity: i.severity, title: i.title, evidence: i.evidence.filter((e) => e.level >= 1).map((e) => ({ id: e.id, x: +e.x.toFixed(2), z: +e.z.toFixed(2) })) })),
      radiation: { cum: +rb.cum.toFixed(1), forecast: +rb.forecast.toFixed(1), budget: rb.budget },
    });
    return { text, json, bytesText: new TextEncoder().encode(text).length, bytesJson: new TextEncoder().encode(json).length };
  }

  /* ------------------------------------------------------------------ *
   * 8. Scenario simulator (SYNTHETIC — clearly labelled in the UI)
   * ------------------------------------------------------------------ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ramp = (d, d0, d1, v0, v1) => (d < d0 ? 0 : d >= d1 ? v1 : v0 + ((v1 - v0) * (d - d0)) / (d1 - d0));

  const MARS_EVENTS = [
    { id: 'spe', day: 41, end: 43, label: 'Solar particle event', domain: 'radiation' },
    { id: 'sleep', day: 55, end: 125, label: 'Progressive sleep restriction', domain: 'isolation' },
    { id: 'decond', day: 90, end: 150, label: 'Exercise compliance falls', domain: 'gravity' },
    { id: 'illness', day: 131, end: 135, label: 'Acute illness episode', domain: 'environment' },
    { id: 'co2', day: 140, end: 180, label: 'Cabin CO₂ scrubber degradation', domain: 'environment' },
  ];

  function marsEffects(d) {
    // returns additive/multiplicative effects per indicator for mission day d
    const fx = {};
    const add = (id, v) => (fx[id] = (fx[id] || 0) + v);
    // SPE
    const spe = { 41: 4.5, 42: 3.2, 43: 1.6 }[d];
    if (spe) { fx.doseMul = spe; add('stress', 1.5); }
    // sleep restriction ramp, then recovery after day 125
    const sl = d < 55 ? 0 : d <= 112 ? ramp(d, 55, 112, 0, -2.0) : d <= 125 ? -2.0 : ramp(d, 125, 145, -2.0, 0);
    if (sl) { add('sleep', sl); add('pvt', -sl * 12); add('mood', sl * 0.55); add('stress', -sl * 0.4); }
    // exercise/deconditioning
    const ex = d < 90 ? 0 : d <= 120 ? ramp(d, 90, 120, 0, -32) : ramp(d, 120, 150, -32, -14);
    if (ex) { add('exercise', ex); add('rhr', -ex * 0.2); add('hrv', ex * 0.45); }
    if (d >= 60) add('mass', -0.02 * (d - 60));
    // illness
    const ill = { 131: [0.4, 4, -8, -0.3], 132: [0.9, 9, -18, -0.9], 133: [0.8, 10, -20, -1.2], 134: [0.5, 7, -12, -0.6], 135: [0.2, 3, -5, -0.2] }[d];
    if (ill) { add('temp', ill[0]); add('rhr', ill[1]); add('hrv', ill[2]); add('spo2', ill[3]); }
    // CO2 degradation
    if (d >= 140) { const c = ramp(d, 140, 180, 0, 1500); add('co2', c); add('pvt', (c / 1500) * 8); }
    return fx;
  }

  function simulate(cfg) {
    const c = Object.assign({ seed: 2026, days: 180, scenario: 'mars', ar: 0.25 }, cfg || {});
    const rand = mulberry32(c.seed);
    const prev = {};
    const rows = [];
    for (let d = 1; d <= c.days; d++) {
      const fx = c.scenario === 'mars' ? marsEffects(d) : {};
      const values = {};
      INDICATORS.forEach((ind) => {
        const [mu, sd] = ind.sim;
        const e = gaussian(rand);
        const n = (prev[ind.id] === undefined ? e : c.ar * prev[ind.id] + Math.sqrt(1 - c.ar * c.ar) * e);
        prev[ind.id] = n;
        let x = mu + sd * n + (fx[ind.id] || 0);
        if (ind.id === 'dose' && fx.doseMul) x = (mu + sd * n) * fx.doseMul;
        if (ind.id === 'mood' || ind.id === 'stress') x = clamp(x, 1, 10);
        if (ind.id === 'exercise') x = clamp(x, 0, 100);
        if (ind.id === 'spo2') x = Math.min(100, x);
        values[ind.id] = +x.toFixed(ind.dec + 1);
      });
      rows.push({ day: d, values });
    }
    return rows;
  }

  /* ------------------------------------------------------------------ *
   * 8b. Simulated crew of four (SYNTHETIC). Each person has their own normal, so the same number
   *     means different things for different people. Personal normals are plausible, not measured.
   * ------------------------------------------------------------------ */
  const CREW = [
    { id: 'cmd', role: 'Commander', code: 'CDR', seed: 2026, scenario: 'mars', day: 132, story: 'The Mars-transit scenario crew member. Typical normals, five injected problems.',
      normal: {}, drifts: ['dose', 'sleep', 'pvt', 'mood', 'stress', 'exercise', 'rhr', 'hrv', 'mass', 'temp', 'spo2', 'co2'], events: MARS_EVENTS },
    { id: 'plt', role: 'Pilot', code: 'PLT', seed: 4101, scenario: 'nominal', day: 108, story: 'Endurance athlete: resting heart rate near 47 bpm and high HRV. One drift, resting heart rate creeping up.',
      normal: { rhr: [47, 2.0], hrv: [88, 9], sleep: [7.3, 0.4], sbp: [108, 4.5], mass: [72.0, 0.35] }, drifts: ['rhr', 'hrv'],
      events: [{ id: 'rhr-drift', day: 70, end: 140, label: 'Resting heart rate creeps up', domain: 'gravity' }] },
    { id: 'eng', role: 'Flight engineer', code: 'FLE', seed: 4102, scenario: 'nominal', day: 140, story: 'Higher resting pressure and shorter sleep than the others. One drift, blood pressure creeping up.',
      normal: { rhr: [72, 3.2], sbp: [126, 5.5], sleep: [6.1, 0.5], mass: [86.0, 0.4] }, drifts: ['sbp'],
      events: [{ id: 'bp-drift', day: 80, end: 180, label: 'Blood pressure creeps up', domain: 'gravity' }] },
    { id: 'med', role: 'Physician', code: 'PHY', seed: 4103, scenario: 'nominal', day: 126, story: 'Long sleeper, light and lean. One drift, sleep getting shorter.',
      normal: { rhr: [54, 2.2], sleep: [8.0, 0.4], sbp: [104, 4.5], mass: [62.0, 0.3] }, drifts: ['sleep', 'pvt', 'mood', 'stress'],
      events: [{ id: 'sleep-short', day: 100, end: 180, label: 'Sleep gets shorter', domain: 'isolation' }] },
  ];
  function crewFx(id, d) {
    const fx = {}, add = (k, v) => (fx[k] = (fx[k] || 0) + v);
    if (id === 'plt') { const r = d < 70 ? 0 : d <= 105 ? ramp(d, 70, 105, 0, 11) : d <= 125 ? 11 : ramp(d, 125, 140, 11, 0); if (r) { add('rhr', r); add('hrv', -r * 2.2); } }
    if (id === 'eng') { const r = ramp(d, 80, 125, 0, 17); if (r) add('sbp', r); }
    if (id === 'med') { const s = ramp(d, 100, 130, 0, -1.4); if (s) { add('sleep', s); add('pvt', -s * 12); add('mood', s * 0.55); add('stress', -s * 0.4); } }
    return fx;
  }
  function simulateCrew(id, days) {
    const m = CREW.find((c) => c.id === id);
    if (!m) throw new Error('unknown crew member ' + id);
    const n = days || 180;
    if (m.scenario === 'mars') return simulate({ seed: m.seed, scenario: 'mars', days: n });
    return simulate({ seed: m.seed, scenario: 'nominal', days: n }).map((row) => {
      const fx = crewFx(id, row.day), values = {};
      INDICATORS.forEach((ind) => {
        const [mu, sd] = ind.sim, own = m.normal[ind.id] || [mu, sd];
        let x = own[0] + (row.values[ind.id] - mu) * (own[1] / sd) + (fx[ind.id] || 0);
        if (ind.id === 'mood' || ind.id === 'stress') x = clamp(x, 1, 10);
        if (ind.id === 'exercise') x = clamp(x, 0, 100);
        if (ind.id === 'spo2') x = Math.min(100, x);
        values[ind.id] = +x.toFixed(ind.dec + 1);
      });
      return { day: row.day, values };
    });
  }

  /* ------------------------------------------------------------------ *
   * 9. Monte-Carlo validation of the detector on synthetic data
   * ------------------------------------------------------------------ */
  function mcRows(rand, days, shift, ar) {
    // shift: {id, sigmas, day} step shift in adverse direction for one indicator
    const prev = {};
    const rows = [];
    for (let d = 1; d <= days; d++) {
      const values = {};
      INDICATORS.forEach((ind) => {
        const [mu, sd] = ind.sim;
        const e = gaussian(rand);
        const n = prev[ind.id] === undefined ? e : ar * prev[ind.id] + Math.sqrt(1 - ar * ar) * e;
        prev[ind.id] = n;
        let x = mu + sd * n;
        if (shift && shift.id === ind.id && d >= shift.day) x += (ind.dir === 0 ? 1 : ind.dir) * shift.sigmas * sd;
        values[ind.id] = x;
      });
      rows.push({ day: d, values });
    }
    return rows;
  }

  function quantile(arr, q) {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(q * a.length))];
  }

  function validate(cfg, opts) {
    const c = Object.assign({ trials: 400, days: 180, seed: 7, ar: 0 }, cfg || {});
    const rand = mulberry32(c.seed);
    const res = { cfg: c, falseAlarm: {}, detection: [] };
    let anyWatch = 0, anyAlert = 0, anyInsightAlert = 0, anyIndAlert = 0;
    let indDays = 0, watchDays = 0;
    for (let k = 0; k < c.trials; k++) {
      const a = analyze(mcRows(rand, c.days, null, c.ar), opts);
      let w = false, al = false, ia = false, ii = false;
      a.days.forEach((d) => {
        if (d.calibrating) return;
        indDays += 1;
        const maxInd = Math.max.apply(null, INDICATORS.map((i) => d.ind[i.id].level));
        if (d.insights.some((i) => i.severity >= 1)) w = true, watchDays++;
        if (d.insights.some((i) => i.severity >= 2)) ia = true;
        if (maxInd >= 2) ii = true;
      });
      if (w) anyWatch++;
      if (ia) anyInsightAlert++;
      if (ii) anyIndAlert++;
    }
    res.falseAlarm = {
      trials: c.trials,
      missionsWithAnyWatch: anyWatch / c.trials,
      missionsWithAnyAlert: anyInsightAlert / c.trials,
      missionsWithAnySingleIndicatorAlert: anyIndAlert / c.trials,
      watchDayFraction: watchDays / indDays,
    };
    // detection delay for sustained step shifts
    const probes = [
      { id: 'sleep', name: 'Sleep duration' },
      { id: 'rhr', name: 'Resting heart rate' },
      { id: 'co2', name: 'Cabin CO₂' },
      { id: 'pvt', name: 'Reaction time' },
    ];
    const startDay = 40;
    [1, 1.5, 2, 3].forEach((sig) => {
      probes.forEach((p) => {
        const delaysWatch = [], delaysAlert = [];
        let missWatch = 0, missAlert = 0;
        const n = Math.max(60, Math.floor(c.trials / 2));
        for (let k = 0; k < n; k++) {
          const a = analyze(mcRows(rand, 100, { id: p.id, sigmas: sig, day: startDay }, c.ar), opts);
          let fw = null, fa = null;
          for (let t = startDay - 1; t < a.days.length; t++) {
            const lvl = a.days[t].ind[p.id].level;
            if (fw === null && lvl >= 1) fw = t + 1 - startDay;
            if (fa === null && lvl >= 2) fa = t + 1 - startDay;
          }
          if (fw === null) missWatch++; else delaysWatch.push(fw);
          if (fa === null) missAlert++; else delaysAlert.push(fa);
        }
        res.detection.push({
          indicator: p.name, sigma: sig, n,
          watchMedian: quantile(delaysWatch, 0.5), watchP90: quantile(delaysWatch, 0.9), watchMiss: missWatch / n,
          alertMedian: quantile(delaysAlert, 0.5), alertP90: quantile(delaysAlert, 0.9), alertMiss: missAlert / n,
        });
      });
    });
    return res;
  }

  /* ------------------------------------------------------------------ *
   * 9b. Stress-test lab: one injected problem in a fresh simulated crew member
   * ------------------------------------------------------------------ */
  function simulateShift(cfg) {
    // Healthy simulated crew member plus ONE sustained adverse shift in one indicator.
    // sigmas is measured in that indicator's normal day-to-day spread; ramp = days to reach full size (0 = sudden).
    const c = Object.assign({ seed: 11, days: 180, ar: 0.25, id: 'sleep', sigmas: 2, day: 60, ramp: 0 }, cfg || {});
    const rand = mulberry32(c.seed), prev = {}, rows = [];
    for (let d = 1; d <= c.days; d++) {
      const values = {};
      INDICATORS.forEach((ind) => {
        const [mu, sd] = ind.sim;
        const e = gaussian(rand);
        const n = prev[ind.id] === undefined ? e : c.ar * prev[ind.id] + Math.sqrt(1 - c.ar * c.ar) * e;
        prev[ind.id] = n;
        let x = mu + sd * n;
        if (ind.id === c.id && d >= c.day) x += (ind.dir === 0 ? 1 : ind.dir) * c.sigmas * sd * (c.ramp > 0 ? Math.min(1, (d - c.day + 1) / c.ramp) : 1);
        if (ind.id === 'mood' || ind.id === 'stress') x = clamp(x, 1, 10);
        if (ind.id === 'exercise') x = clamp(x, 0, 100);
        if (ind.id === 'spo2') x = Math.min(100, x);
        values[ind.id] = +x.toFixed(ind.dec + 1);
      });
      rows.push({ day: d, values });
    }
    return rows;
  }
  // First day a plain fixed-limit alarm would fire. undefined: this signal has no fixed limit. null: limit never crossed.
  function fixedLimitDay(rows, id, from) {
    const h = IND[id].hard;
    if (!h) return undefined;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].day < (from || 1)) continue;
      const x = rows[i].values[id];
      if (x == null) continue;
      if ((h.hi != null && x >= h.hi) || (h.lo != null && x <= h.lo)) return rows[i].day;
    }
    return null;
  }
  function labRun(cfg, opts) {
    const c = Object.assign({ seed: 11, days: 180, ar: 0.25, id: 'sleep', sigmas: 2, day: 60, ramp: 0 }, cfg || {});
    const rows = simulateShift(c), a = analyze(rows, opts), B = a.opts.baselineDays;
    let watch = null, alert = null, early = false;
    for (let t = c.day - 1; t < rows.length; t++) {
      const l = a.days[t].ind[c.id].level;
      if (watch === null && l >= 1) watch = t + 1;
      if (alert === null && l >= 2) alert = t + 1;
    }
    for (let t = B; t < c.day - 1; t++) if (a.days[t].ind[c.id].level >= 1) { early = true; break; }
    return { cfg: c, rows, a, watch, alert, early, fixed: fixedLimitDay(rows, c.id, c.day) };
  }
  function labCohort(cfg, n, opts) {
    const base = Object.assign({}, cfg), dW = [], dA = [];
    let missW = 0, missA = 0, early = 0, fixedMiss = 0, hasLimit = true;
    for (let k = 0; k < n; k++) {
      const r = labRun(Object.assign({}, base, { seed: ((base.seed * 2654435761) + k * 40503 + 17) >>> 0 }), opts);
      if (r.watch === null) missW++; else dW.push(r.watch - base.day);
      if (r.alert === null) missA++; else dA.push(r.alert - base.day);
      if (r.early) early++;
      if (r.fixed === undefined) hasLimit = false; else if (r.fixed === null) fixedMiss++;
    }
    return { n, watchMedian: quantile(dW, 0.5), watchP90: quantile(dW, 0.9), watchMiss: missW, alertMedian: quantile(dA, 0.5), alertMiss: missA, early, hasLimit, fixedMiss };
  }

  /* ------------------------------------------------------------------ *
   * 10. CSV helpers
   * ------------------------------------------------------------------ */
  function toCSV(rows) {
    const head = ['day'].concat(INDICATORS.map((i) => i.id));
    const lines = [head.join(',')];
    rows.forEach((r) => lines.push([r.day].concat(INDICATORS.map((i) => (r.values[i.id] == null ? '' : r.values[i.id]))).join(',')));
    return lines.join('\n');
  }
  function fromCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const head = lines[0].split(',').map((s) => s.trim());
    const di = head.indexOf('day');
    if (di < 0) throw new Error('CSV needs a "day" column');
    const known = INDICATORS.filter((i) => head.indexOf(i.id) >= 0);
    if (!known.length) throw new Error('CSV has no known indicator columns (' + INDICATORS.map((i) => i.id).join(', ') + ')');
    return lines.slice(1).map((ln) => {
      const p = ln.split(',');
      const values = {};
      INDICATORS.forEach((i) => {
        const idx = head.indexOf(i.id);
        const v = idx >= 0 && p[idx] !== undefined && p[idx].trim() !== '' ? parseFloat(p[idx]) : null;
        values[i.id] = v != null && isFinite(v) ? v : null;
      });
      return { day: parseInt(p[di], 10), values };
    });
  }

  return { DOMAINS, INDICATORS, IND, DEFAULTS, MARS_EVENTS, CREW, simulateCrew, analyze, triage, commDelay, radiationBudget, buildPacket, simulate, simulateShift, fixedLimitDay, labRun, labCohort, validate, toCSV, fromCSV, mulberry32, median };
});
