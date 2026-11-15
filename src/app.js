(function () {
  'use strict';
  const E = window.AstroEngine;
  const O = window.OSDR_CBC;
  const PRE = window.VALIDATION_PRECOMPUTED || null;

  /* ---------- helpers ---------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LV = ['Nominal', 'Watch', 'Alert', 'Critical'];
  const LC = ['ok', 'watch', 'alert', 'crit'];
  const LI = ['●', '◆', '▲', '■'];
  const chip = (l) => '<span class="st ' + LC[l] + '"><i aria-hidden="true">' + LI[l] + '</i>' + LV[l] + '</span>';
  const calChip = '<span class="st cal">Calibrating</span>';
  const scoreLevel = (s) => (s >= 80 ? 0 : s >= 60 ? 1 : s >= 40 ? 2 : 3);
  const lvCls = (l, cal) => (cal ? 'lvc' : 'lv' + l);
  const f = (x, d) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d));
  const fmtDelay = (m) => (m * 60 < 0.1 ? '≈ 0 s' : m < 1 ? (m * 60 < 10 ? (m * 60).toFixed(1) : Math.round(m * 60)) + ' s' : (m < 10 ? m.toFixed(1) : Math.round(m)) + ' min');
  const sign = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);
  const modeLabel = (m) => m.charAt(0) + m.slice(1).toLowerCase().replace(' + ', ' and ');
  const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const list = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);


  function niceNum(x, round) {
    const e = Math.floor(Math.log10(x)), fr = x / Math.pow(10, e);
    const nf = round ? (fr < 1.5 ? 1 : fr < 3 ? 2 : fr < 7 ? 5 : 10) : (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 5 ? 5 : 10);
    return nf * Math.pow(10, e);
  }
  // round tick values, and an axis range that starts and ends on a tick
  function niceScale(lo, hi, n) {
    if (!(hi - lo > 1e-12)) { lo -= 0.5; hi += 0.5; }
    const step = niceNum(niceNum(hi - lo, false) / (n - 1), true);
    const min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step, ticks = [];
    for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return { min, max, step, ticks, dec: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
  }
  // monotone cubic path: smooth, and it never overshoots the data
  function monoPath(pts) {
    const n = pts.length; if (n < 2) return '';
    const dx = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
    const t = [m[0]];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    t[n - 1] = m[n - 2];
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
      if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = 'M' + pts[0][0].toFixed(2) + ',' + pts[0][1].toFixed(2);
    for (let i = 0; i < n - 1; i++) d += 'C' + (pts[i][0] + dx[i] / 3).toFixed(2) + ',' + (pts[i][1] + t[i] * dx[i] / 3).toFixed(2) + ' ' + (pts[i + 1][0] - dx[i] / 3).toFixed(2) + ',' + (pts[i + 1][1] - t[i + 1] * dx[i] / 3).toFixed(2) + ' ' + pts[i + 1][0].toFixed(2) + ',' + pts[i + 1][1].toFixed(2);
    return d;
  }

  /* ---------- state ---------- */
  const DATASETS = {
    mars: { name: 'Simulated Mars-transit scenario', rows: E.simulate({ seed: 2026, scenario: 'mars', days: 180 }), total: 180, simulated: true, events: E.MARS_EVENTS },
    nominal: { name: 'Simulated nominal crew member', rows: E.simulate({ seed: 99, scenario: 'nominal', days: 180 }), total: 180, simulated: true, events: [] },
  };
  // The Commander is the Mars scenario above. The other three are simulated people with their own normals.
  E.CREW.forEach((m) => { if (m.id !== 'cmd') DATASETS['crew-' + m.id] = { name: 'Simulated crew member: ' + m.role, rows: E.simulateCrew(m.id), total: 180, simulated: true, events: m.events, crew: m.code, t: m.day - 1 }; });
  const S = { lab: { id: 'sleep', sig: 2, day: 60, ramp: 0, seed: 11 }, labRun: null, labCoh: null, pos: 132, ds: 'mars', name: '', rows: [], total: 180, simulated: true, events: [], t: 132, tab: 'overview', ind: 'sleep', delayMode: 'model', playing: false, crew: 'CM-1', analysis: null, cache: {}, osCrew: 'C002', osAn: 'alc', osView: 'both', valRun: null };
  const DAY_DEPENDENT = { overview: 1, trends: 1, crew: 1, actions: 1 };
  const DELAY_LABELS = { model: 'Follow the mission model (about 3 s to 12.4 min)', leo: 'Low Earth orbit (under 0.1 s)', moon: 'Moon (1.3 s)', marsNear: 'Mars, close approach (3 min)', marsFar: 'Mars, far side of the Sun (22 min)' };

  function delayNow() {
    return { model: E.commDelay(S.rows[S.t].day, S.total), leo: 0.0003, moon: 0.0217, marsNear: 3, marsFar: 22 }[S.delayMode];
  }
  function loadDataset(key) {
    const d = DATASETS[key];
    S.ds = key; S.name = d.name; S.rows = d.rows.map((r) => ({ day: r.day, values: Object.assign({}, r.values) }));
    S.total = d.total; S.simulated = d.simulated; S.events = d.events;
    S.t = d.t != null ? d.t : key === 'mars' ? 132 : Math.min(60, S.rows.length - 1); S.crew = d.crew;
    recompute();
  }
  function recompute() {
    S.analysis = E.analyze(S.rows);
    S.t = Math.max(0, Math.min(S.t, S.rows.length - 1));
    S.cache = {}; S.pos = S.t;
    buildRibbon();
    $('#pills').innerHTML = (S.simulated ? '<span class="badge" title="Every daily value in this demo is synthetic. Data marked as real comes from NASA OSDR.">Simulated data</span>' : '<span class="badge own">Your data</span>') + '<span class="delay" id="delaytxt"></span>';
  }

  /* ---------- time bar ---------- */
  function buildRibbon() {
    const a = S.analysis, N = a.days.length;
    // viewBox runs 0..N-1 so day i is centred on x = i: exactly where the playhead and the chart cursor go
    let s = '<svg viewBox="0 0 ' + Math.max(1, N - 1) + ' 34" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true">';
    a.days.forEach((d, i) => { s += '<rect class="' + (d.calibrating ? 'dc' : 'd' + d.level) + '" x="' + (i - 0.5) + '" y="0" width="1.08" height="21"/>'; });
    S.events.forEach((e, k) => { s += '<rect class="ev" x="' + (e.day - 1.5) + '" y="' + (25 + (k % 2) * 5) + '" width="' + Math.max(1, e.end - e.day + 1) + '" height="3"><title>Injected event: ' + esc(e.label) + ', days ' + e.day + ' to ' + e.end + '</title></rect>'; });
    $('#ribbon').innerHTML = s + '</svg>';
    $('#day').max = String(N - 1);
  }
  const phEl = $('#ph');
  function movePlayhead(pos) {
    phEl.style.transform = 'translate3d(' + (100 * pos / Math.max(1, S.rows.length - 1)).toFixed(3) + '%,0,0)';
  }
  // per-frame update: only the day number, the slider and the playhead (no layout of the page content)
  function fastChrome() {
    const d = S.analysis.days[S.t], b = $('#daylabel b');
    if (b && b.textContent !== String(d.day)) b.textContent = d.day;
    const sl = $('#day'); if (sl.value !== String(S.t)) { sl.value = String(S.t); sl.setAttribute('aria-valuetext', 'Day ' + d.day + ' of ' + S.total); }
    movePlayhead(S.pos);
  }
  function chrome() {
    const d = S.analysis.days[S.t];
    $('#daylabel').innerHTML = 'Day <b>' + d.day + '</b> of ' + S.total;
    const sl = $('#day'); if (sl.value !== String(S.t)) sl.value = String(S.t);
    sl.setAttribute('aria-valuetext', 'Day ' + d.day + ' of ' + S.total);
    movePlayhead(S.pos);
    const dt = $('#delaytxt'); if (dt) dt.textContent = fmtDelay(delayNow()) + ' to ground, one way';
    const pb = $('#play'); pb.textContent = S.playing ? 'Pause' : 'Play'; pb.setAttribute('aria-pressed', S.playing ? 'true' : 'false');
  }
  function speedChrome() { const b = $('#speed'); if (!b) return; const x = SPEEDS[speedI] + '×'; b.textContent = x; b.setAttribute('aria-label', 'Playback speed ' + x + '. Press to change.'); }
  function tabsChrome() { $$('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab ? 'true' : 'false')); }

  /* ---------- svg bits ---------- */
  function spark(vals, lv, min, max) {
    if (vals.length < 2) return '';
    const w = 100, h = 32;
    const lo = min != null ? min : Math.min.apply(null, vals), hi = max != null ? max : Math.max.apply(null, vals), rng = hi - lo || 1;
    let line = '';
    for (let i = 0; i < vals.length; i++) line += ((i / (vals.length - 1)) * w).toFixed(1) + ',' + (h - 2 - ((vals[i] - lo) / rng) * (h - 4)).toFixed(1) + ' ';
    return '<svg class="sp ' + (lv || '') + '" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,32 ' + line + '100,32"/><polyline points="' + line + '"/></svg>';
  }

  /* ---------- OVERVIEW ---------- */
  function heroHTML(d, delay) {
    const n = d.insights.length;
    let h1, lede;
    if (d.calibrating) {
      h1 = 'Day ' + d.day + '. Learning this crew member’s normal.';
      lede = 'AstroCura raises no alerts until the personal baseline is built from the first ' + S.analysis.opts.baselineDays + ' days.';
    } else if (!n) {
      h1 = 'Day ' + d.day + '. Everything is inside this crew member’s normal.';
      lede = 'All ' + E.INDICATORS.length + ' indicators are within their personal baseline.';
    } else {
      h1 = 'Day ' + d.day + '. ' + (n > 10 ? n : WORDS[n]) + (n === 1 ? ' finding needs' : ' findings need') + ' attention.';
      lede = 'Most urgent first: ' + list(d.insights.slice(0, 3).map((i) => lowerFirst(i.title))) + '.';
    }
    const comms = delay <= 1 ? 'Ground is ' + fmtDelay(delay) + ' away, so a live call is practical.' : 'Ground is ' + fmtDelay(delay) + ' away one way, so a reply takes at least ' + fmtDelay(2 * delay) + (n ? '. Work the onboard protocol while you wait.' : '.');
    return '<h1 class="hero hl">' + esc(h1) + '</h1><p class="lede hl">' + esc(lede) + ' ' + esc(comms) + '</p>';
  }
  function hazardRows(d, delay) {
    const a = S.analysis, t = S.t, cal = d.calibrating;
    const hist = (fn) => a.days.slice(Math.max(0, t - 59), t + 1).map(fn);
    const lvlAll = cal ? 'lvc' : 'lv' + d.level;
    let h = '<div class="panel flush">';
    h += '<div class="hz all"><div><h3>Overall readiness</h3><p>The weakest domain counts as much as the average.</p></div><div class="meter ' + lvlAll + '"><b>' + d.overall + '</b><span class="bar"><i style="transform:scaleX(' + (d.overall / 100) + ')"></i></span></div><div>' + spark(hist((x) => x.overall), lvlAll, 0, 100) + '</div>' + (cal ? calChip : chip(d.level)) + '</div>';
    E.DOMAINS.forEach((dm) => {
      if (!dm.scored) {
        const mode = delay <= 1 ? 'Real time' : delay <= 5 ? 'Asynchronous' : 'Autonomy first';
        h += '<div class="hz"><div><h3>' + dm.name + '</h3><p>Changes what to do with a finding, not the health score.</p></div><div class="dly">' + fmtDelay(delay) + ' <small>one way</small></div><div>' + spark(hist((x) => E.commDelay(x.day, S.total)), '') + '</div><span class="st cal">' + mode + '</span></div>';
        return;
      }
      const ds = d.domain[dm.id];
      const mine = d.insights.filter((i) => i.domain === dm.id);
      const sev = mine.reduce((m, i) => Math.max(m, i.severity), 0);
      const lv = cal ? 'lvc' : 'lv' + Math.max(sev, scoreLevel(ds.score));
      h += '<div class="hz"><div><h3>' + dm.name + '</h3><p>' + (cal ? 'Collecting baseline.' : mine.length ? esc(mine.slice(0, 2).map((i) => i.title).join('; ')) : 'Within personal baseline.') + '</p></div><div class="meter ' + lv + '"><b>' + ds.score + '</b><span class="bar"><i style="transform:scaleX(' + (ds.score / 100) + ')"></i></span></div><div>' + spark(hist((x) => x.domain[dm.id].score), lv, 0, 100) + '</div>' + (cal ? calChip : chip(sev)) + '</div>';
    });
    return h + '</div>';
  }
  function findHTML(ins, delay) {
    const tri = E.triage(ins.severity, delay);
    const ev = ins.evidence.filter((e) => e.level >= 1).concat(ins.evidence.filter((e) => e.level < 1)).slice(0, 6);
    const evs = ev.map((e) => '<span class="' + (e.level >= 1 ? 'on lv' + e.level : '') + '">' + esc(e.label) + ' <b>' + f(e.x, e.dec) + '</b> ' + esc(e.unit) + ' <i>' + sign(e.z) + 'σ</i></span>').join('');
    const dom = ins.domain === 'multi' ? 'Across several hazards' : (E.DOMAINS.find((d) => d.id === ins.domain) || {}).name;
    return '<article class="find lv' + ins.severity + '"><div class="hd"><h3>' + esc(ins.title) + '</h3>' + chip(ins.severity) + '</div><p class="sub dom">' + esc(dom || '') + '</p><p class="why">' + esc(ins.why) + '</p>' + (evs ? '<div class="evs">' + evs + '</div>' : '') +
      '<div class="act lv' + ins.severity + '"><b>' + modeLabel(tri.mode) + '</b><span>' + esc(tri.text) + '</span></div>' +
      '<details><summary>Crew actions (' + ins.actions.length + ')</summary><ul>' + ins.actions.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></details></article>';
  }
  function radiationHTML() {
    const rb = E.radiationBudget(S.analysis, S.t, S.total);
    const scale = Math.max(rb.budget, rb.forecast) * 1.05;
    const col = rb.pctForecast > 1 ? 'color:var(--crit-fg)' : rb.pctForecast > 0.85 ? 'color:var(--watch-fg)' : '';
    return '<div class="panel rad"><p class="sub" style="margin:0">Cumulative dose equivalent from the onboard dosimeter against a configurable budget of ' + rb.budget + ' mSv. The forecast uses the 14-day median dose rate, so one solar particle event does not distort it.</p>' +
      '<div class="barwrap" role="img" aria-label="' + rb.cum.toFixed(0) + ' millisieverts so far, forecast ' + rb.forecast.toFixed(0) + ' at mission end, budget ' + rb.budget + '"><div class="fc" style="width:' + (100 * Math.min(1, rb.forecast / scale)).toFixed(1) + '%"></div><div class="now" style="width:' + (100 * Math.min(1, rb.cum / scale)).toFixed(1) + '%"></div><div class="bud" style="left:' + (100 * rb.budget / scale).toFixed(1) + '%" title="Budget"></div></div>' +
      '<div class="figs"><div><b>' + rb.cum.toFixed(0) + '</b><span>mSv so far, ' + Math.round(rb.pctNow * 100) + '% of budget</span></div><div><b>' + rb.rate.toFixed(2) + '</b><span>mSv per day, 14-day median</span></div><div><b style="' + col + '">' + rb.forecast.toFixed(0) + '</b><span>mSv forecast at day ' + S.total + ', ' + Math.round(rb.pctForecast * 100) + '% of budget</span></div></div></div>';
  }
  function startHTML() {
    const steps = [
      ['play', 'Play the mission', 'Watch 180 days of a simulated Mars transit. The day bar turns amber and orange as problems appear.'],
      ['actions', 'Change the delay', 'Open Actions and downlink and slide the one-way delay. The advice changes with the distance.'],
      ['lab', 'Break it on purpose', 'Inject a drift into a simulated crew member and see what AstroCura catches, and what it misses.'],
    ];
    return '<section class="startsec" aria-label="Start here"><h2 class="h3">Start here</h2><ol class="start">' + steps.map((st, i) => '<li><button class="stepbtn" ' + (st[0] === 'play' ? 'data-act="play"' : 'data-tab="' + st[0] + '"') + '><span class="stepn" aria-hidden="true">' + (i + 1) + '</span><span><b>' + st[1] + '</b><span>' + st[2] + '</span></span></button></li>').join('') + '</ol></section>';
  }
  function diffHTML() {
    const items = [
      ['Your own normal, not the average', 'Fixed limits describe the average person. On real Inspiration4 blood counts the four crew members differed from each other up to about three times more than each varied from themselves, so a slow drift can sit well inside the textbook range. AstroCura learns each person’s baseline and watches for drift away from it.'],
      ['Advice that follows the distance', 'The same finding reads “call ground” near Earth and “act now, then send a short note” at twelve minutes one way. Change the delay on the Actions tab and the advice changes with it.'],
      ['It tells you where it fails', 'One small file (about 230 KB) that runs offline and keeps the data on the device. The stress test lets you break a simulated crew member on purpose and shows how many problems AstroCura misses, not only the ones it catches.'],
    ];
    return '<section class="diff" aria-label="What makes AstroCura different"><h2 class="sr">What makes AstroCura different</h2>' + items.map((i) => '<div><h3>' + i[0] + '</h3><p>' + i[1] + '</p></div>').join('') + '<div class="diffgo"><button class="btn primary" data-tab="lab">Stress-test it yourself</button></div></section>';
  }
  function viewOverview() {
    const a = S.analysis, d = a.days[S.t], delay = delayNow();
    const finds = d.insights.length ? d.insights.map((i) => findHTML(i, delay)).join('') : '<div class="empty">' + (d.calibrating ? 'Still calibrating. Drag the day bar forward to see detection begin.' : 'Nothing needs attention. AstroCura keeps checking every indicator against this crew member’s own baseline.') + '</div>';
    const jumps = S.events.length ? '<div class="jumps"><span class="sub">Jump to an injected event</span>' + S.events.map((e) => '<button class="btn sm" data-jump="' + e.day + '">' + esc(e.label) + ', day ' + e.day + '</button>').join('') + '</div>' : '';
    return heroHTML(d, delay) + startHTML() + diffHTML() +
      '<p class="legend" aria-label="Day bar colours"><span class="lvc"><i class="sw"></i>Building baseline</span><span class="lv0"><i class="sw"></i>Nominal</span><span class="lv1"><i class="sw"></i>Watch</span><span class="lv2"><i class="sw"></i>Alert</span><span class="lv3"><i class="sw"></i>Critical</span>' + (S.events.length ? '<span><i class="sw ev"></i>Injected event (simulation ground truth)</span>' : '') + '</p>' + jumps +
      '<section class="sec"><h2>Hazards</h2><p class="sub">NASA groups spaceflight risk into five hazards. Each row scores the indicators that belong to it against this crew member’s own baseline.</p>' + hazardRows(d, delay) + '</section>' +
      '<section class="sec"><h2>What needs attention</h2><p class="sub">Sorted by severity. The advice in each finding adapts to the current ' + fmtDelay(delay) + ' one-way delay.</p>' + finds + '<div class="row repbtn"><button class="btn" data-act="report">Open the flight-surgeon report</button><span class="sub" style="margin:0">A short summary for the ground team, ready to print or save as PDF.</span></div></section>' +
      '<section class="sec"><h2>Radiation budget</h2>' + radiationHTML() + '</section>' + earthHTML();
  }

  /* ---------- TRENDS ---------- */
  const C = { W: 900, H: 300, L: 58, R: 18, T: 14, B: 34 };
  // Narrow screens get a narrower drawing so chart text stays readable instead of shrinking with the page.
  function syncChartW() { const w = window.innerWidth < 720 ? 520 : 900; if (w === C.W) return false; C.W = w; S.cache = {}; return true; }
  const cx = (i, N) => C.L + ((C.W - C.L - C.R) * i) / Math.max(1, N - 1);
  function ewmaRaw(vals, lam) { const out = []; let e = null; vals.forEach((v) => { if (v != null) e = e == null ? v : lam * v + (1 - lam) * e; out.push(e); }); return out; }
  function xAxis(a, N, bottom, labelY, tickTo) {
    let s = '<line class="axis" x1="' + C.L + '" x2="' + (C.W - C.R) + '" y1="' + bottom + '" y2="' + bottom + '"/>';
    a.days.forEach((d, i) => { if (d.day % 30 === 0) { const x = cx(i, N).toFixed(2); s += '<line class="vg" x1="' + x + '" x2="' + x + '" y1="' + tickTo + '" y2="' + bottom + '"/><line class="tick" x1="' + x + '" x2="' + x + '" y1="' + bottom + '" y2="' + (bottom + 5) + '"/><text x="' + x + '" y="' + labelY + '" text-anchor="middle">' + d.day + '</text>'; } });
    return s;
  }
  const KC = { H: 160, T: 12, B: 34 };
  const ovBox = (T, H, B) => 'top:' + (100 * T / H).toFixed(3) + '%;height:' + (100 * (H - B - T) / H).toFixed(3) + '%';
  function ovMain() { const st = ovBox(C.T, C.H, C.B); return '<div class="ov hov" id="hov" hidden style="' + st + '"><i></i></div><div class="ov cur" id="cur" style="' + st + '"><i></i></div><div class="ov dot" id="curdot" hidden><i></i></div>'; }
  function ovCus() { const st = ovBox(KC.T, KC.H, KC.B); return '<div class="ov hov" id="hov2" hidden style="' + st + '"><i></i></div><div class="ov cur" id="cur2" style="' + st + '"><i></i></div>'; }
  const pct = (pos) => (100 * cx(pos, S.rows.length) / C.W).toFixed(3);
  function trendSVG(id, o) {
    o = o || {};
    const ind = E.IND[id], a = o.a || S.analysis, evs = o.events || S.events, N = a.days.length, b = a.baseline[id];
    const xs = a.days.map((d) => d.ind[id].x), vals = xs.filter((v) => v != null);
    let lo = Math.min.apply(null, vals.concat([b.med - 3 * b.sigma])), hi = Math.max.apply(null, vals.concat([b.med + 3 * b.sigma]));
    if (ind.hard) { if (ind.hard.hi != null && ind.hard.hi - hi < (hi - lo)) hi = Math.max(hi, ind.hard.hi); if (ind.hard.lo != null && lo - ind.hard.lo < (hi - lo)) lo = Math.min(lo, ind.hard.lo); }
    const sc = niceScale(lo, hi, 6); lo = sc.min; hi = sc.max;
    const Y = (v) => C.T + (C.H - C.T - C.B) * (1 - (v - lo) / (hi - lo));
    const bottom = C.H - C.B, innerW = C.W - C.L - C.R;
    let s = '<svg class="chart"' + (o.live === false ? '' : ' data-hover="1"') + ' viewBox="0 0 ' + C.W + ' ' + C.H + '" role="img" aria-label="' + esc(ind.label) + ' across the mission with the personal baseline band">';
    sc.ticks.forEach((v) => { const y = Y(v).toFixed(2); s += '<line class="gl" x1="' + C.L + '" x2="' + (C.W - C.R) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (C.L - 10) + '" y="' + y + '" dy=".35em" text-anchor="end">' + v.toFixed(sc.dec) + '</text>'; });
    s += xAxis(a, N, bottom, C.H - 8, C.T);
    evs.forEach((e) => { s += '<rect class="evband" x="' + cx(e.day - 1, N).toFixed(2) + '" y="' + C.T + '" width="' + Math.max(2, cx(e.end - 1, N) - cx(e.day - 1, N)).toFixed(2) + '" height="' + (bottom - C.T) + '"><title>Injected event: ' + esc(e.label) + '</title></rect>'; });
    const B = Math.min(a.opts.baselineDays, N);
    s += '<rect class="bwin" x="' + cx(0, N).toFixed(2) + '" y="' + C.T + '" width="' + (cx(B - 1, N) - cx(0, N)).toFixed(2) + '" height="' + (bottom - C.T) + '"/><text x="' + (cx(0, N) + 8) + '" y="' + (C.T + 16) + '">baseline window</text>';
    s += '<rect class="band" x="' + C.L + '" y="' + Y(b.med + 2 * b.sigma).toFixed(2) + '" width="' + innerW + '" height="' + (Y(b.med - 2 * b.sigma) - Y(b.med + 2 * b.sigma)).toFixed(2) + '"/><line class="med" x1="' + C.L + '" x2="' + (C.W - C.R) + '" y1="' + Y(b.med).toFixed(2) + '" y2="' + Y(b.med).toFixed(2) + '"/>';
    if (ind.hard) ['hi', 'lo'].forEach((k) => { if (ind.hard[k] != null && ind.hard[k] > lo && ind.hard[k] < hi) s += '<line class="hard" x1="' + C.L + '" x2="' + (C.W - C.R) + '" y1="' + Y(ind.hard[k]).toFixed(2) + '" y2="' + Y(ind.hard[k]).toFixed(2) + '"/><text class="hardt" x="' + (C.W - C.R - 4) + '" y="' + (Y(ind.hard[k]) - 7).toFixed(2) + '" text-anchor="end">hard limit (placeholder)</text>'; });
    const ew = ewmaRaw(xs, 0.2), pts = [];
    ew.forEach((v, i) => { if (v != null) pts.push([cx(i, N), Y(v)]); });
    s += '<path class="ewma" d="' + monoPath(pts) + '"/>';
    a.days.forEach((d, i) => { const st = d.ind[id]; if (st.x != null) s += '<circle class="pt' + (st.level ? ' l' + st.level : '') + '" cx="' + cx(i, N).toFixed(2) + '" cy="' + Y(st.x).toFixed(2) + '" r="' + (st.level ? 3.8 : 2.3) + '"/>'; });
    const mk = o.marks || [];
    mk.forEach((m) => { const x = cx(m.day - 1, N).toFixed(2); s += '<line class="mk ' + m.cls + '" x1="' + x + '" x2="' + x + '" y1="' + C.T + '" y2="' + bottom + '"/>'; });
    mk.forEach((m, k) => {
      const x = cx(m.day - 1, N), right = x > C.W - 160;
      s += '<text class="mkt ' + m.cls + '" x="' + (right ? x - 7 : x + 7).toFixed(2) + '" y="' + (C.T + 36 + k * 18) + '" text-anchor="' + (right ? 'end' : 'start') + '">' + esc(m.label) + '</text>';
    });
    return { svg: s + '</svg>', meta: { lo, hi, xs } };
  }
  function cusumSVG(id) {
    const a = S.analysis, N = a.days.length, o = a.opts, K = KC;
    const sc = niceScale(0, o.hAlert * 2.2, 5), hi = sc.max, bottom = K.H - K.B;
    const Y = (v) => K.T + (bottom - K.T) * (1 - Math.min(v, hi) / hi);
    let s = '<svg class="chart" data-hover="1" viewBox="0 0 ' + C.W + ' ' + K.H + '" role="img" aria-label="Sustained-drift score for ' + esc(E.IND[id].label) + '">';
    sc.ticks.forEach((v) => { const y = Y(v).toFixed(2); s += '<line class="gl" x1="' + C.L + '" x2="' + (C.W - C.R) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (C.L - 10) + '" y="' + y + '" dy=".35em" text-anchor="end">' + v.toFixed(sc.dec) + '</text>'; });
    s += xAxis(a, N, bottom, K.H - 8, K.T);
    [[o.hWatch, 'thw', 'thwt', 'Watch', 15], [o.hAlert, 'tha', 'that', 'Alert', -6]].forEach((t) => { s += '<line class="' + t[1] + '" x1="' + C.L + '" x2="' + (C.W - C.R) + '" y1="' + Y(t[0]).toFixed(2) + '" y2="' + Y(t[0]).toFixed(2) + '"/><text class="' + t[2] + '" x="' + (C.W - C.R - 4) + '" y="' + (Y(t[0]) + t[4]).toFixed(2) + '" text-anchor="end">' + t[3] + ' at ' + t[0] + '</text>'; });
    const pts = a.days.map((d, i) => [cx(i, N), Y(d.ind[id].cusum)]);
    s += '<path class="cus" d="' + monoPath(pts) + '"/></svg>';
    return s;
  }
  function cached(key, fn) { return S.cache[key] || (S.cache[key] = fn()); }
  function readoutFor(i) {
    const a = S.analysis, ind = E.IND[S.ind], st = a.days[i].ind[S.ind];
    if (st.x == null) return 'Day ' + a.days[i].day + ': no measurement';
    return 'Day <b>' + a.days[i].day + '</b>: <b>' + f(st.x, ind.dec) + '</b> ' + esc(ind.unit) + ', ' + sign(st.z) + 'σ from own baseline, drift score ' + st.cusum.toFixed(1) + ' ' + chip(st.level) + (a.days[i].calibrating ? ' <span class="sub">(baseline window)</span>' : '');
  }
  function ilistHTML() {
    const a = S.analysis, t = S.t;
    return E.INDICATORS.map((i) => {
      const hist = []; for (let k = Math.max(0, t - 59); k <= t; k++) { const v = a.days[k].ind[i.id].x; if (v != null) hist.push(v); }
      const st = a.days[t].ind[i.id];
      return '<button class="irow" data-ind="' + i.id + '" aria-pressed="' + (i.id === S.ind) + '"><span><span class="l">' + esc(i.label) + '</span><span class="v">' + f(st.x, i.dec) + ' ' + esc(i.unit) + (st.level ? chip(st.level) : '') + '</span></span>' + spark(hist, st.level ? 'lv' + st.level : '') + '</button>';
    }).join('');
  }
  function viewTrends() {
    const a = S.analysis, id = S.ind, ind = E.IND[id], b = a.baseline[id];
    const dir = ind.dir > 0 ? 'high is adverse' : ind.dir < 0 ? 'low is adverse' : 'both directions are adverse';
    const chart = cached('t:' + id, () => { const r = trendSVG(id); S.cache['m:' + id] = r.meta; return r.svg; });
    return '<h1 class="sr">Trends</h1><div class="trends"><div class="ilist" id="ilist" role="group" aria-label="Choose an indicator">' + ilistHTML() + '</div><section><h2>' + esc(ind.label) + '</h2><p class="sub" style="margin:0">Unit: ' + esc(ind.unit) + '. ' + dir.charAt(0).toUpperCase() + dir.slice(1) + '. Personal baseline ' + f(b.med, ind.dec + 1) + ' ± ' + f(b.sigma, ind.dec + 2) + ', day-to-day autocorrelation ' + b.rho.toFixed(2) + '.</p>' +
      '<div class="readout" id="readout" aria-live="polite">' + readoutFor(S.t) + '</div><div class="panel"><div class="cw">' + chart + ovMain() + '</div></div>' +
      '<div class="key"><span><i style="background:#4A5468"></i>Measurement</span><span><i style="background:var(--accent)"></i>Smoothed trend</span><span><i style="background:var(--accent-tint);border:1px solid var(--accent)"></i>Baseline ± 2σ</span><span><i style="background:var(--watch)"></i>Watch</span><span><i style="background:var(--alert)"></i>Alert</span><span><i style="background:var(--crit)"></i>Critical</span></div>' +
      '<h3 style="margin-bottom:var(--s1)">Sustained drift</h3><p class="sub" style="margin:0 0 var(--s2)">The score is in σ units. Crossing a dashed line raises that severity.</p><div class="panel"><div class="cw">' + cached('c:' + id, () => cusumSVG(id)) + ovCus() + '</div></div></section></div>';
  }
  function moveCursor(pos) {
    const N = S.rows.length, p = pct(pos), tx = 'translate3d(' + p + '%,0,0)';
    ['cur', 'cur2'].forEach((k) => { const el = $('#' + k); if (el) el.style.transform = tx; });
    const dot = $('#curdot'), m = S.cache['m:' + S.ind];
    if (!dot || !m) return;
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(pos))), i1 = Math.min(N - 1, i0 + 1), fr = pos - i0, v0 = m.xs[i0], v1 = m.xs[i1];
    const v = v0 == null ? v1 : v1 == null ? v0 : v0 + (v1 - v0) * fr;
    if (v == null) { dot.hidden = true; return; }
    const y = C.T + (C.H - C.T - C.B) * (1 - (v - m.lo) / (m.hi - m.lo));
    dot.style.transform = 'translate3d(' + p + '%,' + (100 * y / C.H).toFixed(3) + '%,0)'; dot.hidden = false;
  }
  function liveTrendsContent() {
    const ro = $('#readout'); if (ro && !S.hoverIdx && S.hoverIdx !== 0) ro.innerHTML = readoutFor(S.t);
    const il = $('#ilist'); if (il) il.innerHTML = ilistHTML();
  }

  /* ---------- STRESS TEST LAB ---------- */
  function labCfg() { const l = S.lab; return { seed: l.seed, id: l.id, sigmas: l.sig, day: l.day, ramp: l.ramp, days: 180, ar: 0.25 }; }
  function labSizeText() {
    const ind = E.IND[S.lab.id], amt = S.lab.sig * ind.sim[1], word = ind.dir < 0 ? 'lower' : 'higher';
    return f(amt, ind.dec + (amt < 1 && ind.dec < 2 ? 1 : 0)) + (ind.unit === '/10' ? ' points' : ' ' + ind.unit) + ' ' + word + ' than usual';
  }
  function labDays(n) { return n === 0 ? 'the day it began' : n + (n === 1 ? ' day' : ' days') + ' after it began'; }
  function labOutHTML() {
    const r = S.labRun, c = r.cfg, ind = E.IND[c.id], remaining = c.days - c.day + 1;
    const head = r.watch == null ? 'Not noticed in the ' + remaining + ' days after it began.' : 'Noticed on day ' + r.watch + ', ' + labDays(r.watch - c.day) + '.';
    const sub = (r.alert == null ? (r.watch == null ? '' : 'It never reached an Alert.') : 'Alert on day ' + r.alert + ', ' + labDays(r.alert - c.day) + '.') + (r.early ? ' A Watch was also raised before the problem began, which is a false alarm.' : '');
    const after = r.rows.filter((x) => x.day >= c.day && x.values[c.id] != null).map((x) => x.values[c.id]);
    const worst = ind.dir < 0 ? Math.min.apply(null, after) : Math.max.apply(null, after), h = ind.hard;
    const lim = h ? (ind.dir < 0 ? 'below ' + h.lo : ind.dir > 0 ? 'above ' + h.hi : 'outside ' + h.lo + ' to ' + h.hi) + ' ' + ind.unit : '';
    const row = (name, day, note) => '<tr><td><b>' + name + '</b><span class="tnote">' + note + '</span></td><td class="n">' + (day == null ? 'Never' : 'Day ' + day) + '</td><td class="n">' + (day == null ? '–' : day - c.day) + '</td></tr>';
    const table = '<div class="panel flush"><table class="labtab"><thead><tr><th>Alarm</th><th class="n">Fires on</th><th class="n">Days after start</th></tr></thead><tbody>' +
      row('AstroCura Watch', r.watch, 'Personal baseline and drift score') + row('AstroCura Alert', r.alert, 'Stronger, sustained drift') +
      (h ? row('Fixed-limit alarm', r.fixed, 'Limit ' + lim + '. Closest this run came: ' + f(worst, ind.dec) + ' ' + esc(ind.unit)) : row('Fixed-limit alarm', null, esc(ind.label) + ' has no fixed limit, so a limit-only alarm never fires')) +
      '</tbody></table></div>';
    const marks = [{ day: c.day, cls: 's', label: 'Problem starts' }];
    if (r.watch != null) marks.push({ day: r.watch, cls: 'w', label: 'Watch' });
    if (r.alert != null) marks.push({ day: r.alert, cls: 'a', label: 'Alert' });
    if (r.fixed != null) marks.push({ day: r.fixed, cls: 'f', label: 'Fixed limit' });
    const chart = trendSVG(c.id, { a: r.a, events: [], live: false, marks }).svg;
    return '<h2 class="verdict">' + head + '</h2><p class="sub verdict-sub">' + sub + '</p>' + table + '<div class="panel" style="padding:var(--s3);margin-top:var(--s4)">' + chart + '</div>' +
      '<div class="key"><span><i style="background:#4A5468"></i>Measurement</span><span><i style="background:var(--accent)"></i>Smoothed trend</span><span><i style="background:var(--watch)"></i>Watch</span><span><i style="background:var(--alert)"></i>Alert</span></div>' +
      '<div class="note" id="labcoh" style="margin-top:var(--s4)">' + labCohHTML() + '</div>';
  }
  function labCohHTML() {
    const k = S.labCoh;
    if (!k) return '<p class="sub" style="margin:0">Running the same problem on ' + 40 + ' more simulated crew members…</p>';
    const w = k.watchMedian == null ? 'never noticed it' : 'raised a Watch in a median of ' + k.watchMedian + ' days (9 in 10 within ' + k.watchP90 + ' days)';
    const a = k.alertMedian == null ? 'never reached an Alert' : 'raised an Alert in a median of ' + k.alertMedian + ' days';
    return '<h3 class="h4" style="margin-bottom:var(--s2)">Across ' + k.n + ' other simulated crew members with the same problem</h3><ul>' +
      '<li>AstroCura ' + w + ', and missed it entirely in <b>' + k.watchMiss + ' of ' + k.n + '</b>.</li>' +
      '<li>It ' + a + ', and missed an Alert in <b>' + k.alertMiss + ' of ' + k.n + '</b>.</li>' +
      '<li>' + (k.hasLimit ? 'A fixed-limit alarm never fired in <b>' + k.fixedMiss + ' of ' + k.n + '</b>.' : 'This signal has no fixed limit, so a limit-only alarm never fires.') + '</li>' +
      '<li>' + k.early + ' of ' + k.n + ' raised a false Watch on this signal before the problem began.</li></ul>';
  }
  function labReadouts() {
    const l = S.lab, set = (id, t) => { const el = $('#' + id); if (el) el.textContent = t; };
    set('labsigv', l.sig + 'σ'); set('labdayv', 'day ' + l.day); set('labsize', labSizeText()); set('labcrew', 'Crew member ' + l.seed);
    $$('[data-labramp]').forEach((b) => b.setAttribute('aria-pressed', String(parseInt(b.dataset.labramp, 10) === l.ramp)));
  }
  let labT = 0, labQd = false;
  function labCohortLater() {
    clearTimeout(labT);
    labT = setTimeout(() => { if (S.tab !== 'lab') return; S.labCoh = E.labCohort(labCfg(), 40); const el = $('#labcoh'); if (el) el.innerHTML = labCohHTML(); }, 180);
  }
  function labRender() {
    S.labRun = E.labRun(labCfg()); S.labCoh = null;
    const o = $('#labout'); if (!o) return;
    o.innerHTML = labOutHTML(); labReadouts(); labCohortLater();
  }
  function labUpdate() { if (labQd) return; labQd = true; requestAnimationFrame(() => { labQd = false; labRender(); }); }
  function viewLab() {
    const l = S.lab; S.labRun = E.labRun(labCfg()); S.labCoh = null;
    const opts = E.DOMAINS.filter((d) => d.scored).map((d) => '<optgroup label="' + esc(d.name) + '">' + E.INDICATORS.filter((i) => i.domain === d.id).map((i) => '<option value="' + i.id + '"' + (i.id === l.id ? ' selected' : '') + '>' + esc(i.label) + '</option>').join('') + '</optgroup>').join('');
    setTimeout(() => { labReadouts(); labCohortLater(); }, 0);
    return '<h1 class="hero">Break a crew member on purpose.</h1>' +
      '<p class="lede">Choose what goes wrong, how badly and when. AstroCura gets a fresh simulated crew member with that problem and reports how many days it needed to notice, next to an alarm that only fires at a fixed safe limit. Everything here is synthetic.</p>' +
      '<div class="labgrid"><div class="panel labctl">' +
      '<div><label class="fieldh" for="labind">What goes wrong</label><select id="labind">' + opts + '</select></div>' +
      '<div><div class="fieldh"><label for="labsig">How big</label><output id="labsigv" for="labsig"></output></div><input class="lr" type="range" id="labsig" min="1" max="8" step="0.5" value="' + l.sig + '" aria-describedby="labsize"><p class="sub" style="margin:var(--s1) 0 0" id="labsize"></p><p class="sub" style="margin:var(--s1) 0 0">σ is this person’s normal day-to-day spread.</p></div>' +
      '<div><div class="fieldh"><label for="labday">It starts on</label><output id="labdayv" for="labday"></output></div><input class="lr" type="range" id="labday" min="35" max="150" step="1" value="' + l.day + '"></div>' +
      '<div><div class="fieldh"><span id="labrampl">How it starts</span></div><div class="row" role="group" aria-labelledby="labrampl"><button class="btn sm" data-labramp="0" aria-pressed="' + (l.ramp === 0) + '">Suddenly</button><button class="btn sm" data-labramp="30" aria-pressed="' + (l.ramp === 30) + '">Over 30 days</button></div></div>' +
      '<div class="row"><button class="btn" id="labnew">New crew member</button><span class="sub" id="labcrew"></span></div>' +
      '<div><button class="btn primary" id="labload">Open in the dashboard</button><p class="sub" style="margin:var(--s2) 0 0">Loads this mission into Overview, Trends and Actions.</p></div></div>' +
      '<div id="labout" aria-live="polite">' + labOutHTML() + '</div></div>';
  }

  /* ---------- ACTIONS ---------- */
  function packetNow() { return E.buildPacket(S.analysis, S.t, { delayMin: delayNow(), crew: S.crew, totalDays: S.total, simulated: S.simulated }); }
  function viewActions() {
    const a = S.analysis, d = a.days[S.t], dl = delayNow(), pk = packetNow();
    const opts = Object.keys(DELAY_LABELS).map((k) => '<option value="' + k + '"' + (S.delayMode === k ? ' selected' : '') + '>' + DELAY_LABELS[k] + '</option>').join('');
    const mode = dl <= 1 ? 'Real time' : dl <= 5 ? 'Asynchronous' : 'Autonomy first';
    const groups = [3, 2, 1].map((sv) => {
      const items = d.insights.filter((i) => i.severity === sv);
      if (!items.length) return '';
      const tri = E.triage(sv, dl);
      return '<div class="panel"><div class="row">' + chip(sv) + '<div class="act lv' + sv + '" style="flex:1;min-width:240px"><b>' + modeLabel(tri.mode) + '</b><span>' + esc(tri.text) + '</span></div></div>' +
        items.map((i) => '<h3 class="h4" style="margin:var(--s4) 0 var(--s1)">' + esc(i.title) + '</h3><ul style="margin:0;padding-left:20px;font-size:14px">' + i.actions.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>').join('') + '</div>';
    }).join('');
    return '<h1 class="hero" style="font-size:clamp(28px,4vw,40px)">The same finding needs a different response at a different distance.</h1><p class="lede">Pick a communication scenario. The advice, and the downlink packet, change with it.</p>' +
      '<div class="grid2" style="margin-top:var(--s5)"><div class="panel"><label class="fld" for="delaysel">Communication delay</label><select id="delaysel" style="margin-top:var(--s1)">' + opts + '</select><div class="figs" style="margin-top:var(--s5)"><div><b>' + fmtDelay(dl) + '</b><span>one way</span></div><div><b>' + fmtDelay(2 * dl) + '</b><span>round trip, at best</span></div><div><b style="font-size:20px;line-height:1.6">' + mode + '</b><span>operating mode</span></div></div></div>' +
      '<div class="panel"><h2 class="h3">How escalation works</h2><ul style="margin:var(--s3) 0 0;padding-left:20px;font-size:14px"><li><b>Critical:</b> act on the onboard emergency procedure and notify ground at the same time. Never wait for a reply.</li><li><b>Alert:</b> call ground if the delay is about a minute or less. Otherwise send the packet at once and keep working the onboard protocol.</li><li><b>Watch:</b> log it, include it in the next routine downlink and re-check within 24 hours.</li></ul><p class="sub" style="margin:var(--s3) 0 0">Actions are generic and non-pharmacological. They support the flight surgeon and the onboard medical checklist, never replace them.</p></div></div>' +
      '<section class="sec"><h2>Crew actions for day ' + d.day + '</h2>' + (groups || '<div class="empty">No open actions.</div>') + '</section>' +
      '<section class="sec"><h2>Downlink packet</h2><p class="sub">A store-and-forward summary that carries the reasoning as well as the numbers, so a flight surgeon one round trip away can act without a back-and-forth. ' + pk.bytesText + ' bytes as text, ' + pk.bytesJson + ' bytes as compact JSON.</p><div class="row"><button class="btn primary" id="copy">Copy text</button><button class="btn" data-act="report">Flight-surgeon report</button><button class="btn" id="dltxt">Download .txt</button><button class="btn" id="dljson">Download .json</button><span id="toast" class="sub" role="status"></span></div><pre class="packet" tabindex="0">' + esc(pk.text) + '</pre></section>';
  }

  /* ---------- CHECK-IN ---------- */
  function viewCheckin() {
    const a = S.analysis, last = S.rows[S.rows.length - 1], b = a.baseline;
    const inputs = E.INDICATORS.map((i) => {
      const v = last.values[i.id] != null ? last.values[i.id] : b[i.id].med;
      return '<label class="fld">' + esc(i.label) + ', ' + esc(i.unit) + '<input type="number" inputmode="decimal" step="' + (i.dec >= 2 ? '0.01' : i.dec === 1 ? '0.1' : '1') + '" data-f="' + i.id + '" value="' + Number(v).toFixed(i.dec + (i.dec < 2 ? 1 : 0)) + '"><span class="src">' + esc(i.source) + '</span></label>';
    }).join('');
    const rows = S.rows.slice(-7).reverse().map((r) => '<tr><td class="n">' + r.day + '</td>' + E.INDICATORS.map((i) => '<td class="n">' + f(r.values[i.id], i.dec) + '</td>').join('') + '</tr>').join('');
    return '<h1 class="hero" style="font-size:clamp(28px,4vw,40px)">Two minutes a day. Everything stays on this device.</h1><p class="lede">Sensors fill most of this in. Mood and stress are two taps. Adding a day re-runs the analysis here, and switches the page from the simulation to your data.</p>' +
      '<div class="panel" style="margin-top:var(--s5)"><div class="form" id="form">' + inputs + '</div><div class="row" style="margin-top:var(--s5)"><button class="btn primary" id="addday">Add day ' + (last.day + 1) + ' to the log</button><span id="toast" class="sub" role="status"></span></div></div>' +
      '<div class="grid2" style="margin-top:var(--s4)"><div class="panel"><h2 class="h3">Load or bring data</h2><p class="sub" style="margin:var(--s2) 0 var(--s4)">CSV columns: <code>day</code> and any of ' + E.INDICATORS.map((i) => '<code>' + i.id + '</code>').join(' ') + '. Detection starts after ' + a.opts.baselineDays + ' days of data.</p><div class="row"><button class="btn" data-load="mars">Mars-transit simulation</button><button class="btn" data-load="nominal">Nominal, no events</button><button class="btn" id="csvout">Export CSV</button><label class="btn" style="cursor:pointer">Import CSV<input type="file" id="csvin" accept=".csv,text/csv" class="sr"></label></div></div>' +
      '<div class="panel"><h2 class="h3">Private by design</h2><p class="sub" style="margin:var(--s2) 0 0">No server, no account, no network calls. A habitat that is offline for minutes or months still has its health co-pilot, and crew data leaves the crew only when they send a packet.</p></div></div>' +
      '<section class="sec"><h2>Recent log</h2><div class="panel flush scroll"><table><thead><tr><th class="n">Day</th>' + E.INDICATORS.map((i) => '<th class="n">' + esc(i.id) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  /* ---------- NASA OSDR ---------- */
  function osdrSeries(crew, ai) { return O.TIMEPOINTS.map((tp) => { const r = O.CREW[crew][tp.id]; return r ? { id: tp.id, x: tp.x, v: r[1][ai], set: r[0] } : null; }).filter(Boolean); }
  function osdrPre(crew, ai) {
    const v = osdrSeries(crew, ai).filter((p) => p.id[0] === 'L' && p.v != null).map((p) => p.v), n = v.length;
    if (!n) return null;
    const mean = v.reduce((a, c) => a + c, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, c) => a + (c - mean) * (c - mean), 0) / (n - 1)) : null;
    return { n, mean, sd, min: Math.min.apply(null, v), max: Math.max.apply(null, v) };
  }
  const outside = (v, r) => v != null && (v < r[0] || v > r[1]);
  function osdrStats() {
    const crews = Object.keys(O.CREW);
    let pre = 0, preOut = 0, r1 = 0, r1Lab = 0, r1Pers = 0, r1Chance = 0; const preOutCrew = new Set();
    crews.forEach((c) => O.ANALYTES.forEach((an, ai) => {
      const p = osdrPre(c, ai);
      osdrSeries(c, ai).forEach((pt) => {
        if (pt.v == null) return;
        const ref = O.REF[pt.set][ai];
        if (pt.id[0] === 'L') { pre++; if (outside(pt.v, ref)) { preOut++; preOutCrew.add(c); } }
        if (pt.id === 'R+1' && p && p.n >= 2) { r1++; r1Chance += 2 / (p.n + 1); if (outside(pt.v, ref)) r1Lab++; if (pt.v < p.min || pt.v > p.max) r1Pers++; }
      });
    }));
    const spread = O.ANALYTES.map((an, ai) => {
      const means = [], sds = [];
      crews.forEach((c) => { const p = osdrPre(c, ai); if (p && p.n >= 2 && p.sd != null) { means.push(p.mean); sds.push(p.sd); } });
      const mm = means.reduce((a, c) => a + c, 0) / means.length;
      const between = Math.sqrt(means.reduce((a, c) => a + (c - mm) * (c - mm), 0) / (means.length - 1));
      const within = Math.sqrt(sds.reduce((a, c) => a + c * c, 0) / sds.length);
      return { an, between, within, ratio: between / within };
    }).sort((x, y) => y.ratio - x.ratio);
    return { pre, preOut, preOutCrew: preOutCrew.size, crews: crews.length, r1, r1Lab, r1Pers, r1Chance, spread };
  }
  const CREW_COL = { C001: '#2253F2', C002: '#E8590C', C003: '#8E3FE0', C004: '#0A9F6E' };
  const CREW_SHAPE = { C001: 'c', C002: 's', C003: 't', C004: 'd' };
  function osdrSVG(crew, ai) {
    const an = O.ANALYTES[ai], W = C.W, H = 330, L = 66, R = 18, T = 14, B = 36, xmin = -105, xmax = 210;
    const X = (x) => L + ((W - L - R) * (x - xmin)) / (xmax - xmin);
    const all = Object.keys(O.CREW).map((c) => osdrSeries(c, ai).filter((p) => p.v != null).map((p) => p.v));
    const refs = ['A', 'B'].map((k) => O.REF[k][ai]);
    const flat = [].concat.apply([], all).concat(refs[0], refs[1]);
    const sc = niceScale(Math.min.apply(null, flat), Math.max.apply(null, flat), 6), lo = sc.min, hi = sc.max, bottom = H - B;
    const Y = (v) => T + (bottom - T) * (1 - (v - lo) / (hi - lo));
    const mk = (sh, x, y, c, r, op) => sh === 'c' ? '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c + '" opacity="' + op + '"/>' : sh === 's' ? '<rect x="' + (x - r) + '" y="' + (y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" fill="' + c + '" opacity="' + op + '"/>' : sh === 't' ? '<polygon points="' + x + ',' + (y - r - 1) + ' ' + (x - r - 1) + ',' + (y + r) + ' ' + (x + r + 1) + ',' + (y + r) + '" fill="' + c + '" opacity="' + op + '"/>' : '<polygon points="' + x + ',' + (y - r - 1) + ' ' + (x + r + 1) + ',' + y + ' ' + x + ',' + (y + r + 1) + ' ' + (x - r - 1) + ',' + y + '" fill="' + c + '" opacity="' + op + '"/>';
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(an.label) + ' for four Inspiration4 crew members before and after flight">';
    sc.ticks.forEach((v) => { const y = Y(v).toFixed(2); s += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (L - 10) + '" y="' + y + '" dy=".35em" text-anchor="end">' + v.toLocaleString('en-US', { minimumFractionDigits: sc.dec, maximumFractionDigits: sc.dec }) + '</text>'; });
    s += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + bottom + '" y2="' + bottom + '"/>';
    const sel = osdrSeries(crew, ai), setSel = (sel[0] || { set: 'A' }).set, ref = O.REF[setSel][ai];
    if (S.osView !== 'personal') s += '<rect x="' + L + '" y="' + Y(ref[1]).toFixed(2) + '" width="' + (W - L - R) + '" height="' + (Y(ref[0]) - Y(ref[1])).toFixed(2) + '" fill="#9AA3B2" opacity=".22"/><text x="' + (W - R - 6) + '" y="' + (Y(ref[1]) + 16).toFixed(2) + '" text-anchor="end">lab reference range (population)</text>';
    const p = osdrPre(crew, ai);
    if (S.osView !== 'population' && p && p.n >= 2) s += '<rect x="' + X(-92).toFixed(2) + '" y="' + Y(p.max).toFixed(2) + '" width="' + (W - R - X(-92)).toFixed(2) + '" height="' + Math.max(2, Y(p.min) - Y(p.max)).toFixed(2) + '" fill="#2253F2" opacity=".18"/><text x="' + (W - R - 6) + '" y="' + (Y(p.min) + 17).toFixed(2) + '" text-anchor="end" style="fill:#2253F2">this person’s own pre-flight range</text>';
    s += '<rect x="' + X(0).toFixed(2) + '" y="' + T + '" width="' + Math.max(2, X(3) - X(0)).toFixed(2) + '" height="' + (bottom - T) + '" fill="#12161F" opacity=".08"/><text x="' + (X(0) + 6) + '" y="' + (T + 15) + '">flight, 3 days</text>';
    O.TIMEPOINTS.forEach((tp) => { const x = X(tp.x).toFixed(2); s += '<line class="vg" x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + bottom + '"/><line class="tick" x1="' + x + '" x2="' + x + '" y1="' + bottom + '" y2="' + (bottom + 5) + '"/><text x="' + x + '" y="' + (H - 10) + '" text-anchor="' + (tp.id === 'L-3' ? 'end' : tp.id === 'R+1' ? 'start' : 'middle') + '">' + tp.id + '</text>'; });
    Object.keys(O.CREW).forEach((c) => {
      const pts = osdrSeries(c, ai).filter((q) => q.v != null), isSel = c === crew;
      s += '<polyline fill="none" stroke="' + CREW_COL[c] + '" stroke-width="' + (isSel ? 3 : 1.4) + '" stroke-linejoin="round" opacity="' + (isSel ? 1 : 0.4) + '" points="' + pts.map((q) => X(q.x).toFixed(2) + ',' + Y(q.v).toFixed(2)).join(' ') + '"/>';
      pts.forEach((q) => { s += mk(CREW_SHAPE[c], X(q.x).toFixed(2), Y(q.v).toFixed(2), CREW_COL[c], isSel ? 5 : 3.2, isSel ? 1 : 0.55); });
    });
    return s + '</svg>';
  }
  function viewOsdr() {
    const ai = O.ANALYTES.findIndex((a) => a.id === S.osAn), an = O.ANALYTES[ai], crew = S.osCrew, st = osdrStats(), crews = Object.keys(O.CREW);
    const btns = (arr, attr, cur) => arr.map((x) => '<button class="btn sm" data-' + attr + '="' + x[0] + '" aria-pressed="' + (x[0] === cur) + '">' + esc(x[1]) + '</button>').join('');
    const rowsHTML = O.ANALYTES.map((a, i) => {
      const p = osdrPre(crew, i), ser = osdrSeries(crew, i), r1 = ser.find((q) => q.id === 'R+1'), ref = r1 ? O.REF[r1.set][i] : O.REF.A[i];
      const dev = p && p.n >= 3 && p.sd > 0 && r1 && r1.v != null ? (r1.v - p.mean) / p.sd : null;
      const labOut = r1 && outside(r1.v, ref), persOut = r1 && p && p.n >= 2 && r1.v != null && (r1.v < p.min || r1.v > p.max);
      const flag = (x) => '<span class="st ' + (x ? 'alert' : 'ok') + '">' + (x ? 'Outside' : 'Inside') + '</span>';
      return '<tr><td>' + esc(a.label) + ' <span class="sub">' + esc(a.unit) + '</span></td><td class="n">' + (p ? f(p.mean, a.dec) + (p.sd != null ? ' ± ' + f(p.sd, a.dec) : '') + ' <span class="sub">n=' + p.n + '</span>' : '–') + '</td><td class="n">' + (r1 ? f(r1.v, a.dec) : '–') + '</td><td class="n">' + (dev == null ? '<span class="sub">n/a</span>' : sign(dev)) + '</td><td>' + (r1 ? flag(labOut) : '') + '</td><td>' + (r1 && p && p.n >= 2 ? flag(persOut) : '') + '</td></tr>';
    }).join('');
    const spreadRows = st.spread.map((x) => '<tr><td>' + esc(x.an.label) + '</td><td class="n">' + f(x.between, x.an.dec + 1) + '</td><td class="n">' + f(x.within, x.an.dec + 1) + '</td><td class="n"><b>' + x.ratio.toFixed(1) + '×</b></td></tr>').join('');
    return '<span class="tag real">Real NASA data</span><h1 class="hero" style="font-size:clamp(28px,4vw,40px);margin-top:var(--s4)">Inspiration4 blood counts: people differ more from each other than from themselves.</h1>' +
      '<p class="lede">Dataset <b>' + O.accession + '</b> (' + O.identifiers + '), ' + esc(O.title) + '. ' + esc(O.mission) + '. Public file <code>' + esc(O.file) + '</code>, retrieved from the OSDR API on ' + O.retrieved + '. Four crew members, three samples before flight and up to four after. <a href="' + O.studyUrl + '" target="_blank" rel="noopener">Open the study in OSDR</a>.</p>' +
      '<div class="note" style="margin-top:var(--s4)">No public crew dataset has daily health data, so the Mars scenario is simulated. This page checks one premise of AstroCura on real NASA data: do people differ more from each other than from themselves, so that one population range fits no one well? It does not claim to detect anything. Four people with 2 to 3 baseline samples each is far too little for that.</div>' +
      '<section class="sec"><h2>What the numbers say</h2><div class="panel"><div class="figs"><div><b>' + st.preOut + ' of ' + st.pre + '</b><span>pre-flight values already outside the lab’s population range (' + Math.round(100 * st.preOut / st.pre) + '%), in ' + st.preOutCrew + ' of ' + st.crews + ' crew members</span></div><div><b>' + st.r1Lab + ' of ' + st.r1 + '</b><span>R+1 values outside the lab range</span></div><div><b>' + st.r1Pers + ' of ' + st.r1 + '</b><span>R+1 values outside the person’s own 2 to 3-sample pre-flight range. Chance alone gives about ' + st.r1Chance.toFixed(0) + ', so no flight effect can be claimed.</span></div></div></div></section>' +
      '<section class="sec"><h2>Explore</h2><div class="panel"><p class="sub" style="margin:0 0 var(--s2)">Analyte</p><div class="row" style="margin-bottom:var(--s4)">' + btns(O.ANALYTES.map((a) => [a.id, a.label]), 'osan', S.osAn) + '</div><p class="sub" style="margin:0 0 var(--s2)">Crew member to highlight</p><div class="row" style="margin-bottom:var(--s4)">' + btns(crews.map((c) => [c, c]), 'oscrew', crew) + '</div><p class="sub" style="margin:0 0 var(--s2)">Reference bands</p><div class="row" style="margin-bottom:var(--s5)">' + btns([['both', 'Both ranges'], ['population', 'Population only'], ['personal', 'Personal only']], 'osview', S.osView) + '</div>' +
      '<h3>' + esc(an.label) + ' <span class="sub" style="font-weight:400">' + esc(an.unit) + ', days from launch</span></h3>' + osdrSVG(crew, ai) +
      '<div class="key">' + crews.map((c) => '<span><i style="background:' + CREW_COL[c] + '"></i>' + c + '</span>').join('') + '</div></div></section>' +
      '<section class="sec"><h2>' + crew + ' in detail</h2><p class="sub">Personal pre-flight baseline against the R+1 sample. With only 2 or 3 samples, the personal range and the SD units are exploratory.</p><div class="panel flush scroll"><table><thead><tr><th>Analyte</th><th class="n">Pre-flight mean ± SD</th><th class="n">R+1</th><th class="n">R+1 in own SD units</th><th>Lab range</th><th>Own range</th></tr></thead><tbody>' + rowsHTML + '</tbody></table></div></section>' +
      '<section class="sec"><h2>Do people differ more from each other than from themselves?</h2><p class="sub">The SD of the four people’s pre-flight means, against the typical pre-flight SD within one person. A high ratio means a single population threshold is a poor detector for that analyte.</p><div class="panel flush scroll"><table><thead><tr><th>Analyte</th><th class="n">Between-person SD</th><th class="n">Within-person SD</th><th class="n">Ratio</th></tr></thead><tbody>' + spreadRows + '</tbody></table></div></section>' +
      '<section class="sec"><h2>Data handling notes</h2><div class="note"><ul>' + O.excluded.map((x) => '<li>' + esc(x) + '</li>').join('') + '<li>Attribution: NASA OSDR, Inspiration4 and the Space Omics and Medical Atlas (SOMA) consortium. The crew consented to public release of processed data.</li></ul></div></section>';
  }

  /* ---------- METHOD ---------- */
  function viewMethods() {
    const o = S.analysis.opts;
    const map = [
      ['Space radiation', 'Radiation-induced cancers', 'Dose rate, cumulative dose against a budget, event detection', 'Dose bookkeeping and solar particle event flagging. It does not estimate cancer risk.'],
      ['Isolation and confinement', 'Behavioral changes and psychiatric disorders; inadequate sleep and irregular schedules; inadequate teamwork', 'Sleep duration, mood, stress, reaction time (PVT)', 'Individual drift only. Teamwork and crew dynamics are not modelled for a single crew member.'],
      ['Gravity fields (altered gravity)', 'Cardiovascular adaptations; reduced cardiorespiratory and musculoskeletal fitness; spaceflight-induced bone changes; inadequate food and nutrition', 'Resting heart rate, HRV, blood pressure, body mass, exercise completed', 'Bone and eyes are not measured. Exercise completion stands in for bone and muscle loading.'],
      ['Hostile and closed environments', 'Altered immune system responses; hypoxia; host–microorganism interactions', 'Cabin CO₂, body temperature, SpO₂, illness pattern', 'Early illness and air-quality drift. The microbiome is out of scope.'],
      ['Distance from Earth', 'Inadequate systems operations support', 'Communication delay, triage mode, store-and-forward packet', 'A policy layer, not a health score. It changes what to do with a finding.'],
    ].map((r) => '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('');
    const prov = [
      ['pub', 'NASA-published', 'The five hazards and the risk list that organise the whole app', 'NASA Human Research Program'],
      ['pub', 'NASA-published', 'Average cruise galactic-cosmic-ray dose equivalent of 1.8 mSv/day, about 330 mSv over a six-month cruise (basis for the simulated dose-rate baseline)', 'Zeitlin et al. 2013, Curiosity RAD, Science; SwRI and NASA release'],
      ['pub', 'NASA-funded', 'Astronauts average about 6 h of sleep against 8.5 h scheduled (basis for the 6.5 h simulated sleep baseline)', 'Barger et al. 2014, Lancet Neurology'],
      ['real', 'Real data', 'Inspiration4 complete blood counts, four crew members (NASA OSDR tab only)', 'OSD-569 through the OSDR API'],
      ['ass', 'Assumed', 'Typical resting physiology, self-report scales, cabin CO₂, PVT: baselines and spreads used to build the simulation', 'Illustrative values, not NASA measurements'],
      ['sim', 'Simulated', 'Every daily value in the Mars scenario, the injected events and their sizes, and the communication-delay curve (about 3 s to 12.4 min)', 'Generated by simulate(), seeded and reproducible'],
      ['ass', 'Assumed', 'Hard limits (SpO₂ ≤ 92 %, temperature ≥ 38.0 °C, CO₂ ≥ 7000 ppm) and all crew action text', 'Placeholders. A real mission replaces them with its medical requirements'],
    ].map((r) => '<tr><td><span class="tag ' + r[0] + '">' + r[1] + '</span></td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('');
    const params = [['Baseline window', o.baselineDays + ' days', 'Median and MAD-based robust σ per indicator, with a floor so a quiet baseline cannot create hair-trigger alarms'], ['Evidence', 'adverse z', 'z = (x − median) / σ, signed so that worse is positive. Two-sided indicators use |z| − 0.80'], ['Autocorrelation', 'on', 'Evidence is divided by √((1+ρ)/(1−ρ)) using each indicator’s own baseline lag-1 ρ'], ['Smoothing λ', o.lambda, 'Used for the domain readiness scores'], ['Drift detector', 'leaky CUSUM', 'S = max(0, γ·S + a − k), with γ = ' + o.gamma + ' and k = ' + o.k], ['Watch and Alert thresholds', o.hWatch + ' and ' + o.hAlert, 'Single-indicator drift score. A one-day spike of at least ' + o.spikeZ + 'σ is also an Alert'], ['Domain readiness', '100 − 25·m', 'm is the mean positive smoothed adverse z across the domain’s indicators'], ['Overall readiness', '0.5·min + 0.5·mean', 'The weakest domain counts as much as the average']].map((r) => '<tr><td>' + r[0] + '</td><td><code>' + r[1] + '</code></td><td>' + r[2] + '</td></tr>').join('');
    const refs = [
      ['NASA Human Research Program: Five hazards of human spaceflight', 'https://www.nasa.gov/hrp/hazards/'],
      ['NASA Human Research Program: Risks of human spaceflight', 'https://www.nasa.gov/hrp/risks/'],
      ['NASA Human Research Program: Ongoing research in space', 'https://www.nasa.gov/hrp/ongoing-hrp-research/'],
      ['Canadian Space Agency: Monitoring radiation for astronaut health', 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp'],
      ['NASA Open Science Data Repository, study OSD-569', 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-569'],
      ['Sanders et al. (2024). Inspiration4 data access through the NASA Open Science Data Repository. npj Microgravity', 'https://www.nature.com/articles/s41526-024-00393-5'],
      ['Zeitlin et al. (2013). Measurements of energetic particle radiation in transit to Mars on the Mars Science Laboratory. Science (SwRI release)', 'https://www.swri.org/press-release/swri-led-team-calculates-radiation-exposure-associated-trip-mars'],
      ['Barger et al. (2014). Prevalence of sleep deficiency and use of hypnotic drugs in astronauts before, during, and after spaceflight. Lancet Neurology', 'https://doi.org/10.1016/S1474-4422(14)70122-X'],
      ['Garrett-Bakelman et al. (2019). The NASA Twins Study. Science 364(6436)', 'https://doi.org/10.1126/science.aau8650'],
      ['Abadie and Francisco (2024). Human Health and Performance: Keeping Astronauts Safe & Productive on a Mission to Mars. NASA Technical Reports Server 20230015521', 'https://ntrs.nasa.gov/citations/20230015521'],
    ].map((r) => '<li><a href="' + r[1] + '" target="_blank" rel="noopener">' + esc(r[0]) + '</a></li>').join('');
    return '<h1 class="hero" style="font-size:clamp(28px,4vw,40px)">Where every number comes from, and what it cannot do.</h1>' +
      '<p class="lede">On a Mars mission a crew member is minutes from any help and weeks from any resupply. NASA’s Human Research Program groups the threats into five coupled hazards. Mission Control’s real-time view fades as the delay grows, so astronauts carry much of the responsibility for spotting changes in themselves.</p>' +
      '<section class="sec"><h2>What AstroCura does differently</h2><div class="panel"><ul style="margin:0;padding-left:20px"><li><b>Personal baselines, not population ranges.</b> Each crew member is compared with their own normal. The OSDR tab shows why on real NASA data.</li><li><b>Explainable pattern reasoning across hazards.</b> Drift in several indicators combines into named patterns such as illness, sleep restriction, deconditioning and cabin air, with the evidence shown.</li><li><b>Distance-aware triage.</b> The recommended response changes with the communication delay, and a compact packet carries the reasoning to the ground.</li><li><b>Offline and private.</b> It runs on the habitat computer with no network dependency.</li></ul></div></section>' +
      '<section class="sec"><h2>How the hazards map to what is monitored</h2><div class="panel flush scroll"><table><thead><tr><th>NASA hazard</th><th>HRP risks</th><th>AstroCura monitors</th><th>Scope and limits</th></tr></thead><tbody>' + map + '</tbody></table></div></section>' +
      '<section class="sec"><h2>Detection method</h2><p class="sub">Per indicator, per day: robust personal baseline, adverse z-score, autocorrelation-scaled evidence, then a leaky CUSUM for sustained drift and a one-day spike test. Indicator states feed rule-based pattern reasoning across hazards. Hard limits override everything.</p><div class="panel flush scroll"><table><thead><tr><th>Parameter</th><th>Value</th><th>Meaning</th></tr></thead><tbody>' + params + '</tbody></table></div></section>' +
      '<section class="sec"><h2>Data provenance</h2><div class="panel flush scroll"><table><thead><tr><th>Type</th><th>What</th><th>Source</th></tr></thead><tbody>' + prov + '</tbody></table></div><p class="sub" style="margin-top:var(--s3)">Nothing simulated is presented as real, and no dataset is invented. The Mars scenario is a test bench with known ground truth, and the page says so wherever it appears.</p></section>' +
      '<section class="sec"><h2>Limitations</h2><div class="note"><ul><li><b>Not a medical device</b> and not clinically validated. It is decision support for a crew member and flight surgeon, never a diagnosis.</li><li>The daily detector is validated on synthetic data with known ground truth. Public daily crew data does not exist, and the real-data tab uses sparse blood counts from four people on a three-day flight.</li><li>Thresholds were tuned on synthetic noise. Real physiology is messier: sensor dropouts, circadian rhythm, workload and microgravity adaptation all shift baselines. The flight surgeon decides when to re-baseline.</li><li>A crew member who is already drifting during the baseline window teaches the baseline the problem. Pre-flight data should seed it.</li><li>Each crew member is analysed on their own. The Crew tab compares four simulated people, but there is no team, workload or social modelling.</li><li>Action text is generic and non-pharmacological, and a mission would replace it with its own procedures.</li></ul></div></section>' +
      '<section class="sec"><h2>Next steps</h2><div class="note"><ul><li>Ingest more OSDR data: ISS cabin telemetry (Environmental Data Application) and RadLab dosimetry for realistic dose-rate and environment baselines.</li><li>Validate on analog missions such as NASA’s HERA through the formal data-request process.</li><li>Add a crew-level view, bone and vision modules, and a flight-surgeon console on the ground.</li></ul></div></section>' +
      '<section class="sec"><h2>References</h2><div class="panel"><ol style="margin:0;padding-left:20px;font-size:14px">' + refs + '</ol></div></section>';
  }

  /* ---------- VALIDATION ---------- */
  function scenarioTable() {
    if (S.ds !== 'mars') return '<p class="sub" style="margin:0">Load the Mars-transit simulation on the Check-in tab to see detection against the injected events.</p>';
    const a = S.analysis;
    const map = { spe: ['rad-event'], sleep: ['sleep-cluster', 'drift-sleep', 'drift-pvt', 'drift-mood'], decond: ['deconditioning', 'mass-exercise', 'drift-exercise', 'drift-hrv', 'drift-rhr'], illness: ['illness'], co2: ['cabin-co2', 'drift-co2'] };
    const rows = S.events.map((e) => {
      const ids = map[e.id]; let w = null, al = null;
      a.days.forEach((d) => { if (d.day < e.day || d.day > e.end + 10) return; d.insights.forEach((n) => { if (ids.indexOf(n.id) < 0) return; if (w == null && n.severity >= 1) w = d.day; if (al == null && n.severity >= 2) al = d.day; }); });
      return '<tr><td>' + esc(e.label) + '</td><td class="n">' + e.day + ' to ' + e.end + '</td><td class="n">' + (w == null ? '<span class="st alert">Missed</span>' : 'day ' + w + ' <span class="sub">(+' + (w - e.day) + ')</span>') + '</td><td class="n">' + (al == null ? '<span class="st alert">None</span>' : 'day ' + al + ' <span class="sub">(+' + (al - e.day) + ')</span>') + '</td></tr>';
    }).join('');
    const calibDays = a.opts.baselineDays;
    const fa = a.days.filter((d) => !d.calibrating && d.day < 40 && d.level >= 1).length;
    return '<table><thead><tr><th>Injected event</th><th class="n">Days</th><th class="n">First Watch</th><th class="n">First Alert</th></tr></thead><tbody>' + rows + '</tbody></table><p class="sub" style="margin:var(--s3) 0 0">Healthy stretch, days ' + (calibDays + 1) + ' to 39 before any event: ' + (fa ? fa + ' day(s) with an insight' : '<b>no days with an insight</b>') + '. Drift events are ramps, so the lag reflects how long the effect takes to rise out of the noise. The radiation event is flagged on its first day.</p>';
  }
  function viewValidation() {
    const v = S.valRun || (PRE && PRE.results);
    let tables = '';
    if (v) {
      const fa = v.map((x) => '<tr><td>' + (x.cfg.ar === 0 ? 'Independent daily noise' : 'Autocorrelated noise, ρ = ' + x.cfg.ar) + '</td><td class="n">' + x.falseAlarm.trials + '</td><td class="n">' + (100 * x.falseAlarm.missionsWithAnyWatch).toFixed(1) + '%</td><td class="n">' + (100 * x.falseAlarm.missionsWithAnyAlert).toFixed(1) + '%</td></tr>').join('');
      const det = v[0].detection.map((d) => '<tr><td>' + esc(d.indicator) + '</td><td class="n">' + d.sigma + 'σ</td><td class="n">' + (d.watchMedian == null ? '–' : d.watchMedian) + ' / ' + (d.watchP90 == null ? '–' : d.watchP90) + '</td><td class="n">' + Math.round(100 * d.watchMiss) + '%</td><td class="n">' + (d.alertMedian == null ? '–' : d.alertMedian) + ' / ' + (d.alertP90 == null ? '–' : d.alertP90) + '</td><td class="n">' + Math.round(100 * d.alertMiss) + '%</td></tr>').join('');
      const detRows = (run) => run.detection.map((d) => '<tr><td>' + esc(d.indicator) + '</td><td class="n">' + d.sigma + 'σ</td><td class="n">' + (d.watchMedian == null ? '–' : d.watchMedian) + ' / ' + (d.watchP90 == null ? '–' : d.watchP90) + '</td><td class="n">' + Math.round(100 * d.watchMiss) + '%</td><td class="n">' + (d.alertMedian == null ? '–' : d.alertMedian) + ' / ' + (d.alertP90 == null ? '–' : d.alertP90) + '</td><td class="n">' + Math.round(100 * d.alertMiss) + '%</td></tr>').join('');
      const detHead = '<thead><tr><th>Indicator</th><th class="n">Shift</th><th class="n">Watch, median / P90</th><th class="n">Watch missed</th><th class="n">Alert, median / P90</th><th class="n">Alert missed</th></tr></thead>';
      const det2 = v[1] ? '<h3 style="margin:var(--s5) 0 var(--s1)">With realistic, autocorrelated noise (ρ = ' + v[1].cfg.ar + ')</h3><p class="sub" style="margin:0 0 var(--s2)">This is the setting the stress test uses. Slow-moving real signals make small shifts harder to separate from noise, so more of them are missed.</p><div class="panel flush scroll"><table>' + detHead + '<tbody>' + detRows(v[1]) + '</tbody></table></div>' : '';
      tables = '<section class="sec"><h2>False alarms</h2><p class="sub">A healthy crew member, no events, 180 days.</p><div class="panel flush scroll"><table><thead><tr><th>Noise model</th><th class="n">Missions</th><th class="n">Any Watch</th><th class="n">Any Alert</th></tr></thead><tbody>' + fa + '</tbody></table></div><p class="sub" style="margin-top:var(--s3)">Real signals are autocorrelated. AstroCura scales its evidence by each indicator’s own measured autocorrelation, which holds false alerts down but does not remove the effect. Watch-level noise is the price of sensitivity.</p></section>' +
        '<section class="sec"><h2>Detection delay</h2><p class="sub">A sustained step shift that begins on day 40. Delays are in days. First, independent daily noise.</p><div class="panel flush scroll"><table><thead><tr><th>Indicator</th><th class="n">Shift</th><th class="n">Watch, median / P90</th><th class="n">Watch missed</th><th class="n">Alert, median / P90</th><th class="n">Alert missed</th></tr></thead><tbody>' + det + '</tbody></table></div>' + det2 + '<p class="sub" style="margin-top:var(--s3)">Misses are runs with no detection within 60 days. Shifts of 1σ sit inside normal day-to-day variation and mostly go unreported, by design. With independent noise a 2σ shift reaches Watch in a median of about a week (the slowest 10% take about three weeks) and 2 to 4% are missed. With autocorrelated noise the median is 8 to 9 days, the slowest 10% take 24 to 34 days and 10 to 21% are missed. Alert takes about twice as long and is missed in 30 to 37% of 2σ shifts. 3σ shifts are caught reliably in both settings. These are single-indicator results. The cross-indicator pattern rules are only exercised on the Mars scenario below, not in this Monte-Carlo test.</p></section>';
    }
    return '<span class="tag sim">Synthetic validation</span><h1 class="hero" style="font-size:clamp(28px,4vw,40px);margin-top:var(--s4)">Does the detector work, and how often does it cry wolf?</h1>' +
      '<p class="lede">Monte-Carlo tests with known ground truth. All thirteen indicators are generated at their simulated baselines for a 180-day mission, and the baseline is re-estimated from the first ' + S.analysis.opts.baselineDays + ' days every time. This tests the statistics, not clinical accuracy.</p>' +
      '<div class="row"><button class="btn primary" id="runval">Re-run in this browser (200 missions per row)</button><span class="sub" id="valstatus" role="status">' + (S.valRun ? 'Fresh run from this browser.' : PRE ? 'Pre-computed with Node ' + esc(PRE.node) + ', fixed seeds, ' + PRE.trials + ' missions per row.' : '') + '</span></div>' +
      tables + '<section class="sec"><h2>The Mars-transit scenario</h2><p class="sub">Detection against the injected events, computed live from the engine.</p><div class="panel flush scroll" style="padding:var(--s4)">' + scenarioTable() + '</div></section>' +
      '<section class="sec"><h2>Reproduce</h2><div class="note">The tests live in <code>test/engine.test.js</code> in the source folder. Run <code>node test/engine.test.js</code>. The engine is one dependency-free file shared by this page and the tests.</div></section>';
  }

  /* ---------- render ---------- */
  /* ---------- CREW OF FOUR ---------- */
  const CREW_INDS = ['sleep', 'rhr', 'sbp'];
  const CW = { W: 480, H: 210, L: 46, R: 12, T: 14, B: 30 };
  const crewKey = (m) => (m.id === 'cmd' ? 'mars' : 'crew-' + m.id);
  const crewX = (i, N) => CW.L + ((CW.W - CW.L - CW.R) * i) / (N - 1);
  const crewY = (v, sc) => CW.T + (CW.H - CW.T - CW.B) * (1 - (v - sc.min) / (sc.max - sc.min));
  // The four simulated people are analysed once, on first use, and kept for the rest of the session.
  function crewData() {
    if (!S.crewData) S.crewData = E.CREW.map((m) => { const rows = DATASETS[crewKey(m)].rows; return { m, rows, a: E.analyze(rows), st: {}, ch: {} }; });
    return S.crewData;
  }
  function crewStat(c, id) {
    if (c.st[id]) return c.st[id];
    let w = null, al = null;
    c.a.days.forEach((d) => { if (d.calibrating) return; const l = d.ind[id].level; if (w === null && l >= 1) w = d.day; if (al === null && l >= 2) al = d.day; });
    return (c.st[id] = { b: c.a.baseline[id], w, al, fixed: E.fixedLimitDay(c.rows, id), drift: c.m.drifts.indexOf(id) >= 0 });
  }
  // One shared scale for all four people, so a difference in normal is a visible difference on the page.
  function crewScale(id) {
    S.crewSc = S.crewSc || {};
    if (S.crewSc[id]) return S.crewSc[id];
    let lo = Infinity, hi = -Infinity;
    crewData().forEach((c) => {
      const b = c.a.baseline[id];
      c.rows.forEach((r) => { const v = r.values[id]; if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
      lo = Math.min(lo, b.med - 2 * b.sigma); hi = Math.max(hi, b.med + 2 * b.sigma);
    });
    const h = E.IND[id].hard, span = hi - lo;
    if (h) ['hi', 'lo'].forEach((k) => { if (h[k] != null && Math.abs(h[k] - (k === 'hi' ? hi : lo)) < 0.35 * span) { lo = Math.min(lo, h[k]); hi = Math.max(hi, h[k]); } });
    return (S.crewSc[id] = niceScale(lo, hi, 5));
  }
  // Everything that does not depend on the day is drawn once and cached; only the day marker is added per update.
  function crewStatic(c, id, sc) {
    if (c.ch[id]) return c.ch[id];
    const a = c.a, N = a.days.length, ind = E.IND[id], b = a.baseline[id], st = crewStat(c, id), B = Math.min(a.opts.baselineDays, N);
    const X = (i) => crewX(i, N), Y = (v) => crewY(v, sc), bot = CW.H - CW.B, rt = CW.W - CW.R;
    let s = '';
    sc.ticks.forEach((v) => { const y = Y(v).toFixed(1); s += '<line class="gl" x1="' + CW.L + '" x2="' + rt + '" y1="' + y + '" y2="' + y + '"/><text x="' + (CW.L - 8) + '" y="' + y + '" dy=".35em" text-anchor="end">' + f(v, sc.dec) + '</text>'; });
    s += '<line class="axis" x1="' + CW.L + '" x2="' + rt + '" y1="' + bot + '" y2="' + bot + '"/>';
    [60, 120, 180].forEach((dd) => { if (dd > N) return; const x = X(dd - 1).toFixed(1); s += '<line class="tick" x1="' + x + '" x2="' + x + '" y1="' + bot + '" y2="' + (bot + 5) + '"/><text x="' + x + '" y="' + (CW.H - 6) + '" text-anchor="' + (dd === 180 ? 'end' : 'middle') + '">' + (dd === 60 ? 'Day 60' : dd) + '</text>'; });
    s += '<rect class="bwin" x="' + X(0).toFixed(1) + '" y="' + CW.T + '" width="' + (X(B - 1) - X(0)).toFixed(1) + '" height="' + (bot - CW.T) + '"/>';
    const yh = Y(b.med + 2 * b.sigma), yl = Y(b.med - 2 * b.sigma);
    s += '<rect class="band" x="' + CW.L + '" y="' + yh.toFixed(1) + '" width="' + (rt - CW.L) + '" height="' + (yl - yh).toFixed(1) + '"/><line class="med" x1="' + CW.L + '" x2="' + rt + '" y1="' + Y(b.med).toFixed(1) + '" y2="' + Y(b.med).toFixed(1) + '"/>';
    const h = ind.hard;
    ['hi', 'lo'].forEach((k) => { if (h && h[k] != null && h[k] >= sc.min && h[k] <= sc.max) { const y = Y(h[k]); s += '<line class="hard" x1="' + CW.L + '" x2="' + rt + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="hardt" x="' + (rt - 2) + '" y="' + (k === 'hi' ? y - 6 : y + 15).toFixed(1) + '" text-anchor="end">Fixed limit ' + f(h[k], ind.dec) + '</text>'; } });
    [[st.w, 'w'], [st.al, 'a']].forEach((p) => { if (p[0] != null) { const x = X(p[0] - 1).toFixed(1); s += '<line class="fl ' + p[1] + '" x1="' + x + '" x2="' + x + '" y1="' + CW.T + '" y2="' + bot + '"/>'; } });
    const xs = a.days.map((d) => d.ind[id].x), ew = ewmaRaw(xs, 0.2), pts = [];
    ew.forEach((v, i) => { if (v != null) pts.push([X(i), Y(v)]); });
    a.days.forEach((d, i) => { const q = d.ind[id]; if (q.x != null) s += '<circle class="pt' + (q.level ? ' l' + q.level : '') + '" cx="' + X(i).toFixed(1) + '" cy="' + Y(q.x).toFixed(1) + '" r="' + (q.level ? 2.6 : 1.7) + '"/>'; });
    s += '<path class="ewma" d="' + monoPath(pts) + '"/>';
    if (st.w != null) { const x = X(st.w - 1); s += '<path class="fm w" d="M' + x.toFixed(1) + ',' + (bot - 13) + 'l6.5,6.5l-6.5,6.5l-6.5,-6.5z"/>'; }
    if (st.al != null) { const x = X(st.al - 1); s += '<path class="fm a" d="M' + x.toFixed(1) + ',' + (bot - 13) + 'l7.5,13h-15z"/>'; }
    return (c.ch[id] = s);
  }
  function crewCardHTML(c, id, sc) {
    const a = c.a, N = a.days.length, ti = Math.min(S.t, N - 1), d = a.days[ti], ind = E.IND[id], st = crewStat(c, id), q = d.ind[id], b = st.b;
    const cx0 = crewX(ti, N).toFixed(1);
    const cur = '<line class="cur" x1="' + cx0 + '" x2="' + cx0 + '" y1="' + CW.T + '" y2="' + (CW.H - CW.B) + '"/>' + (q.x != null ? '<circle class="curd" cx="' + cx0 + '" cy="' + crewY(q.x, sc).toFixed(1) + '" r="4.5"/>' : '');
    const svg = '<svg class="chart" viewBox="0 0 ' + CW.W + ' ' + CW.H + '" role="img" aria-label="' + esc(ind.label + ' for the ' + c.m.role + ': daily values, the personal normal band and the day marker') + '">' + crewStatic(c, id, sc) + cur + '</svg>';
    const rng = f(b.med - 2 * b.sigma, ind.dec) + ' to ' + f(b.med + 2 * b.sigma, ind.dec);
    const now = d.calibrating ? 'Day ' + d.day + ': still building the baseline' : q.x == null ? 'Day ' + d.day + ': no measurement' : 'Day ' + d.day + ': ' + f(q.x, ind.dec) + ' ' + ind.unit + ', ' + sign(q.z) + 'σ from own normal';
    const flags = (st.w != null ? 'AstroCura flagged it on day ' + st.w + (st.al != null ? ', Alert on day ' + st.al : '') : 'AstroCura raised no flag') + '. ' + (st.fixed === undefined ? 'No fixed limit exists for this signal.' : st.fixed === null ? 'The fixed limit never fired.' : 'The fixed limit fired on day ' + st.fixed + '.');
    const loaded = S.ds === crewKey(c.m);
    return '<article class="panel crewc"><div class="hd"><h3>' + esc(c.m.role) + '</h3>' + (d.calibrating ? calChip : chip(d.level)) + '</div><p class="story">' + esc(c.m.story) + '</p>' + svg +
      '<dl class="kv"><dt>Own normal</dt><dd>' + f(b.med, ind.dec) + ' ' + esc(ind.unit) + ', usual range ' + rng + '</dd><dt>Now</dt><dd class="kvd">' + esc(now) + '</dd><dt>Flags</dt><dd>' + esc(flags) + '</dd></dl>' +
      (loaded ? '<button class="btn" data-tab="overview">Showing in the dashboard. Go to Overview</button>' : '<button class="btn" data-opencrew="' + crewKey(c.m) + '">Open the ' + esc(c.m.role.toLowerCase()) + ' in the dashboard</button>') + '</article>';
  }
  function viewCrew() {
    const cd = crewData(), id = CREW_INDS.indexOf(S.crewInd) >= 0 ? S.crewInd : 'sleep', ind = E.IND[id], sc = crewScale(id);
    const picks = CREW_INDS.map((k) => '<button class="btn sm" data-crewind="' + k + '" aria-pressed="' + (k === id ? 'true' : 'false') + '">' + esc(E.IND[k].label) + '</button>').join('');
    const sts = cd.map((c) => crewStat(c, id));
    const real = sts.filter((x) => x.drift).length, caught = sts.filter((x) => x.drift && x.w != null).length;
    const fixedHit = sts.filter((x) => x.drift && typeof x.fixed === 'number').length, falseF = sts.filter((x) => !x.drift && x.w != null).length;
    const figs = '<div class="figs" style="margin-top:var(--s5)"><div><b>' + real + '</b><span>real drifts injected on this indicator</span></div><div><b>' + caught + '</b><span>caught against each person’s own normal</span></div><div><b>' + (ind.hard ? fixedHit : '–') + '</b><span>' + (ind.hard ? 'caught by the fixed limit' : 'no fixed limit exists for this signal') + '</span></div><div><b>' + falseF + '</b><span>false flags on people with no injected drift</span></div></div>';
    const rows = cd.map((c, i) => {
      const s = sts[i], b = s.b, vals = c.rows.map((r) => r.values[id]).filter((v) => v != null);
      const fx = s.fixed === undefined ? 'no limit' : s.fixed === null ? 'never' : 'day ' + s.fixed;
      return '<tr><th scope="row">' + esc(c.m.role) + '</th><td class="n">' + f(b.med, ind.dec) + '</td><td class="n">' + f(b.med - 2 * b.sigma, ind.dec) + ' to ' + f(b.med + 2 * b.sigma, ind.dec) + '</td><td class="n">' + f(Math.min.apply(null, vals), ind.dec) + ' to ' + f(Math.max.apply(null, vals), ind.dec) + '</td><td class="n">' + (s.w != null ? 'day ' + s.w : 'no flag') + '</td><td class="n">' + fx + '</td><td>' + (s.drift ? 'Yes' : 'No') + '</td></tr>';
    }).join('');
    return '<h1 class="hero" style="font-size:clamp(28px,4vw,40px)">The same number means different things to different people.</h1>' +
      '<p class="lede">Four simulated crew members, each with their own normal. A fixed limit treats everyone the same. AstroCura learns each person first, then watches for drift from that person. Press Play to watch all four at once.</p>' +
      '<div class="row" role="group" aria-label="Indicator to compare" style="margin-top:var(--s5)">' + picks + '</div>' +
      '<p class="sub" style="margin:var(--s3) 0 0;max-width:70ch">All four charts use one scale. The shaded band is each person’s usual range, the dotted red line is a fixed placeholder limit, and the status chip is that person’s overall status across all ' + E.INDICATORS.length + ' indicators on the day shown on the day bar.</p>' +
      '<h2 class="sr">The four crew members</h2><div class="crewgrid">' + cd.map((c) => crewCardHTML(c, id, sc)).join('') + '</div>' +
      '<section class="sec"><h2>The same indicator, four normals</h2><p class="sub">' + esc(ind.label) + ', in ' + esc(ind.unit) + '. Because these four people are simulated, the real drifts are known, so each flag can be checked against the truth.</p>' +
      '<div class="panel flush scroll crewtab"><table><caption class="sr">' + esc(ind.label) + ' for four simulated crew members</caption><thead><tr><th scope="col">Crew member</th><th scope="col" class="n">Own normal</th><th scope="col" class="n">Usual range</th><th scope="col" class="n">Lowest to highest seen</th><th scope="col" class="n">First flagged by AstroCura</th><th scope="col" class="n">Fixed limit fires</th><th scope="col">Real drift injected</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + figs +
      '<p class="sub" style="margin-top:var(--s4);max-width:70ch">The four personal normals are plausible, not measured from real astronauts, and this is one random draw. The Validation tab repeats the test across many simulated missions.</p></section>';
  }

  /* ---------- FLIGHT-SURGEON REPORT (print or save as PDF) ---------- */
  const isFramed = () => { try { return window.top !== window.self; } catch (x) { return true; } };
  function reportHTML() {
    const a = S.analysis, t = S.t, d = a.days[t], delay = delayNow(), rb = E.radiationBudget(a, t, S.total), ins = d.insights;
    const mode = delay <= 1 ? 'Real time' : delay <= 5 ? 'Asynchronous' : 'Autonomy first';
    const doms = E.DOMAINS.filter((x) => x.scored).map((x) => {
      const ds = d.domain[x.id], sev = ins.filter((i) => i.domain === x.id).reduce((m, i) => Math.max(m, i.severity), 0);
      return '<tr><td>' + esc(x.name) + '</td><td class="n">' + ds.score + '</td><td>' + (d.calibrating ? calChip : chip(Math.max(sev, scoreLevel(ds.score)))) + '</td></tr>';
    }).join('');
    const finds = ins.length ? ins.slice(0, 8).map((i) => {
      const tri = E.triage(i.severity, delay);
      const ev = i.evidence.filter((e) => e.level >= 1).slice(0, 5).map((e) => esc(e.label) + ' ' + f(e.x, e.dec) + ' ' + esc(e.unit) + ' (own normal ' + f(e.base, e.dec) + ', ' + sign(e.z) + 'σ)').join('; ');
      return '<div class="rf lv' + i.severity + '"><div class="rfh"><b>' + esc(i.title) + '</b>' + chip(i.severity) + '</div><p>' + esc(i.why) + '</p>' + (ev ? '<p>Evidence: ' + ev + '</p>' : '') + '<p><b>' + modeLabel(tri.mode) + ':</b> ' + esc(tri.text) + '</p></div>';
    }).join('') + (ins.length > 8 ? '<p class="sub">' + (ins.length - 8) + ' more findings are not shown here. Open the Overview for all of them.</p>' : '') : '<p class="sub">' + (d.calibrating ? 'Still building the personal baseline, so no findings are raised yet.' : 'No active findings. Every indicator is inside this crew member’s own normal.') + '</p>';
    let bar = '<svg viewBox="0 0 ' + a.days.length + ' 10" preserveAspectRatio="none" role="img" aria-label="Mission day bar from day 1 to day ' + d.day + '"><rect class="rbg" x="0" y="0" width="' + a.days.length + '" height="10"/>';
    a.days.forEach((x, i) => { if (i <= t) bar += '<rect class="' + (x.calibrating ? 'rc' : 'r' + x.level) + '" x="' + i + '" y="0" width="1.05" height="10"/>'; });
    bar += '</svg>';
    const ind = E.INDICATORS.map((def) => {
      const vals = a.days.slice(Math.max(0, t - 6), t + 1).map((y) => y.ind[def.id].x).filter((v) => v != null);
      const m = vals.length ? vals.reduce((p, c) => p + c, 0) / vals.length : null, b = a.baseline[def.id], z = m == null ? null : (m - b.med) / b.sigma;
      return '<tr><td>' + esc(def.label) + '</td><td class="n">' + f(m, def.dec) + ' ' + esc(def.unit) + '</td><td class="n">' + f(b.med, def.dec) + '</td><td class="n">' + (z == null ? '–' : sign(z) + 'σ') + '</td><td>' + (d.calibrating ? calChip : chip(d.ind[def.id].level)) + '</td></tr>';
    }).join('');
    return '<header class="rh"><div><h2 id="rpttitle">Flight-surgeon report</h2><p>AstroCura · ' + esc(S.name) + ' · Day ' + d.day + ' of ' + S.total + '</p></div><div class="rbadge">' + (S.simulated ? 'Simulated data' : 'Your data') + '</div></header>' +
      '<div class="rkpi"><div><b>' + d.overall + '/100</b><span>Overall readiness</span></div><div><b>' + ins.length + '</b><span>' + (ins.length === 1 ? 'Open finding' : 'Open findings') + '</span></div><div><b>' + fmtDelay(delay) + '</b><span>One-way delay, ' + mode.toLowerCase() + '</span></div></div>' +
      '<div class="rbar">' + bar + '</div>' +
      '<h3>Readiness by hazard</h3><table><thead><tr><th scope="col">Hazard</th><th scope="col" class="n">Score</th><th scope="col">Status</th></tr></thead><tbody>' + doms + '</tbody></table>' +
      '<h3>Findings, most urgent first</h3>' + finds +
      '<h3>Radiation budget</h3><p class="rline">' + rb.cum.toFixed(0) + ' mSv so far, ' + Math.round(rb.pctNow * 100) + '% of the ' + rb.budget + ' mSv budget. Forecast at day ' + S.total + ': ' + rb.forecast.toFixed(0) + ' mSv, ' + Math.round(rb.pctForecast * 100) + '% of budget. Dose rate ' + rb.rate.toFixed(2) + ' mSv per day (14-day median).</p>' +
      '<h3>Last seven days against this crew member’s own normal</h3><table><thead><tr><th scope="col">Indicator</th><th scope="col" class="n">7-day mean</th><th scope="col" class="n">Own normal</th><th scope="col" class="n">Difference</th><th scope="col">Today</th></tr></thead><tbody>' + ind + '</tbody></table>' +
      '<p class="rfoot">' + (S.simulated ? 'Every value in this report is simulated. It describes no real person. ' : '') + 'Decision support only. This is not a diagnosis and AstroCura is not a medical device. Follow the flight surgeon and the onboard medical procedures. Made offline on this device by AstroCura, a NASA Space Apps Challenge 2026 prototype. Code and text produced with AI assistance (Claude, Anthropic) under the team’s direction.</p>';
  }
  let rptTrigger = null;
  function openReport(trigger) {
    const dlg = $('#rptdlg'); if (!dlg || typeof dlg.showModal !== 'function') return;
    stop(); rptTrigger = trigger || document.activeElement;
    $('#rptbody').innerHTML = reportHTML();
    $('#rptmsg').textContent = isFramed() ? 'Printing is blocked inside an embedded view. Open the page on its own to print or save a PDF.' : '';
    document.body.classList.add('rptopen'); dlg.showModal(); dlg.scrollTop = 0;
  }
  function earthHTML() {
    const items = [
      ['Remote and isolated crews', 'Winter-over teams at polar stations, ship and submarine crews and offshore workers also live far from a doctor with slow communication. Space agencies already study crews in Earth analogs like these to prepare for exploration.'],
      ['Care that works offline', 'Watching for drift from a person’s own normal helps a patient at home with a wearable and a weak connection too. AstroCura keeps everything on the device and sends nothing out, which suits places with poor internet and strict privacy.'],
      ['What it would take', 'None of this has been tried on real patients. It would need real clinical data, a clinical partner and regulatory approval before anyone relied on it.'],
    ];
    return '<section class="sec" aria-label="Beyond the spacecraft"><h2>Beyond the spacecraft</h2><p class="sub">The hard parts of a Mars mission are not unique to Mars. These are places where the same idea could help. They are possibilities, not tested uses.</p><div class="diff">' + items.map((i) => '<div><h3>' + i[0] + '</h3><p>' + i[1] + '</p></div>').join('') + '</div></section>';
  }

  const VIEWS = { overview: viewOverview, trends: viewTrends, crew: viewCrew, actions: viewActions, checkin: viewCheckin, osdr: viewOsdr, lab: viewLab, methods: viewMethods, validation: viewValidation };
  function renderView() {
    syncChartW();
    const v = $('#view');
    v.innerHTML = VIEWS[S.tab]();
    v.setAttribute('aria-labelledby', 'tab-' + S.tab);
    S.hoverIdx = null;
    document.body.dataset.tab = S.tab;
    if (S.tab === 'trends') moveCursor(S.pos);
  }
  // In-place patching: unchanged nodes are kept, so hover, focus, open <details> and a button that is being pressed survive a daily update.
  function syncNode(o, n) {
    if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) { o.replaceWith(n.cloneNode(true)); return; }
    if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
    if (o.isEqualNode(n)) return;
    for (let i = 0; i < n.attributes.length; i++) { const at = n.attributes[i]; if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value); }
    for (let i = o.attributes.length - 1; i >= 0; i--) { const nm = o.attributes[i].name; if (!n.hasAttribute(nm) && !(nm === 'open' && o.nodeName === 'DETAILS')) o.removeAttribute(nm); }
    syncKids(o, n);
  }
  function syncKids(o, n) {
    const ok = o.childNodes, nk = n.childNodes;
    for (let i = 0; i < nk.length; i++) { if (i < ok.length) syncNode(ok[i], nk[i]); else o.appendChild(nk[i].cloneNode(true)); }
    while (ok.length > nk.length) o.removeChild(o.lastChild);
  }
  function patchView() {
    syncChartW();
    const t = document.createElement('template'); t.innerHTML = VIEWS[S.tab]();
    syncKids($('#view'), t.content);
  }
  function paintContent() { if (S.tab === 'trends') liveTrendsContent(); else if (DAY_DEPENDENT[S.tab]) patchView(); }
  let cT = 0, cLast = 0, cDirty = false;
  function scheduleContent() {
    cDirty = true; if (cT) return;
    cT = setTimeout(() => { cT = 0; cLast = performance.now(); if (cDirty) { cDirty = false; paintContent(); } }, Math.max(0, 90 - (performance.now() - cLast)));
  }
  function flushContent() { clearTimeout(cT); cT = 0; if (cDirty) { cDirty = false; cLast = performance.now(); paintContent(); } }
  function paintFrame() { fastChrome(); if (S.tab === 'trends') moveCursor(S.pos); scheduleContent(); }
  function renderAll() { tabsChrome(); chrome(); renderView(); }
  let queued = false;
  function queue() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paintFrame(); }); }
  function setT(t) { S.t = Math.max(0, Math.min(S.rows.length - 1, t)); S.pos = S.t; queue(); }
  function setTab(tab) {
    if (!VIEWS[tab]) return;
    if (S.playing && tab === 'lab') stop();
    S.tab = tab; tabsChrome(); chrome(); renderView(); window.scrollTo(0, 0);
    try { if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab); } catch (e) { /* sandboxed frames refuse URL changes; the tab has already switched */ }
  }
  function toast(msg) { const el = $('#toast'); if (el) { el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2500); } }
  function copyText(txt) {
    return (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : Promise.reject()).catch(() => new Promise((res, rej) => { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let okc = false; try { okc = document.execCommand('copy'); } catch (x) { okc = false; } ta.remove(); okc ? res() : rej(); }));
  }
  function download(name, text, type) {
    let framed = false; try { framed = window.top !== window.self; } catch (x) { framed = true; }
    if (framed) { copyText(text).then(() => toast('Downloads are blocked in this embedded view, so it was copied to the clipboard instead'), () => toast('Downloads are blocked in this embedded view. Open the page on its own to download.')); return; }
    const b = new Blob([text], { type: type || 'text/plain' }), u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 500);
  }

  /* ---------- playback ---------- */
  // The playhead and chart cursor move every frame (60 fps). The page content updates only when the whole day changes.
  let raf = 0, lastTs = 0;
  const SPEEDS = [0.5, 1, 2], BASE = 7; // mission days per second at 1x: about 26 s for the whole 180-day mission
  let speedI = 1;
  function stop() {
    S.playing = false; cancelAnimationFrame(raf); S.pos = S.t;
    const pb = $('#play'); pb.textContent = 'Play'; pb.setAttribute('aria-pressed', 'false');
    chrome(); if (S.tab === 'trends') moveCursor(S.pos); flushContent();
  }
  function tick(ts) {
    if (!S.playing) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(50, ts - lastTs) / 1000, last = S.rows.length - 1;
    lastTs = ts;
    S.pos = Math.min(last, S.pos + dt * BASE * SPEEDS[speedI]);
    const t = Math.round(S.pos);
    if (t !== S.t) { S.t = t; fastChrome(); scheduleContent(); }
    movePlayhead(S.pos); if (S.tab === 'trends') moveCursor(S.pos);
    if (S.pos >= last) { stop(); return; }
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (S.t >= S.rows.length - 1) { S.t = 0; S.pos = 0; }
    S.playing = true; lastTs = 0; chrome(); raf = requestAnimationFrame(tick);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, label, a[data-tab]');
    if (!t) return;
    const ds = t.dataset || {};
    if (ds.tab) { if (t.tagName === 'A') e.preventDefault(); return setTab(ds.tab); }
    if (ds.act === 'play') { if (!S.playing) play(); return; }
    if (ds.act === 'report') { openReport(t); return; }
    if (ds.crewind) { S.crewInd = ds.crewind; renderView(); return; }
    if (ds.opencrew) { stop(); loadDataset(ds.opencrew); setTab('overview'); return; }
    if (ds.jump) { stop(); setT(parseInt(ds.jump, 10) - 1); return; }
    if (ds.ind) { S.ind = ds.ind; S.hoverIdx = null; renderView(); return; }
    if (ds.osan) { S.osAn = ds.osan; renderView(); return; }
    if (ds.oscrew) { S.osCrew = ds.oscrew; renderView(); return; }
    if (ds.osview) { S.osView = ds.osview; renderView(); return; }
    if (ds.load) { stop(); loadDataset(ds.load); renderAll(); return; }
    if (ds.labramp !== undefined) { S.lab.ramp = parseInt(ds.labramp, 10); labUpdate(); return; }
    switch (t.id) {
      case 'labnew': S.lab.seed += 1; labUpdate(); return;
      case 'labload': {
        const r = S.labRun, c = r.cfg, ind = E.IND[c.id];
        stop(); S.rows = r.rows.map((x) => ({ day: x.day, values: Object.assign({}, x.values) })); S.ds = 'lab'; S.crew = undefined; S.name = 'Stress test: ' + ind.label;
        S.simulated = true; S.total = c.days; S.events = [{ day: c.day, end: c.days, label: 'Injected: ' + ind.label }];
        S.t = Math.min(S.rows.length - 1, (r.alert || r.watch || c.day + 10) - 1); S.pos = S.t; recompute(); setTab('overview'); toast('Loaded into the dashboard. Drag the day bar to replay it.'); return;
      }
      case 'play': S.playing ? stop() : play(); return;
      case 'rptprint': try { window.print(); } catch (x) { $('#rptmsg').textContent = 'Printing is blocked here. Open the page on its own to print or save a PDF.'; } return;
      case 'rptclose': $('#rptdlg').close(); return;
      case 'speed': speedI = (speedI + 1) % SPEEDS.length; speedChrome(); return;
      case 'copy': copyText(packetNow().text).then(() => toast('Copied'), () => toast('Select the text and copy it manually')); return;
      case 'dltxt': download('astrocura-downlink-day' + S.rows[S.t].day + '.txt', packetNow().text); return;
      case 'dljson': download('astrocura-downlink-day' + S.rows[S.t].day + '.json', packetNow().json, 'application/json'); return;
      case 'csvout': download('astrocura-log.csv', E.toCSV(S.rows), 'text/csv'); return;
      case 'addday': {
        const values = {}; let bad = false;
        $$('#form input[data-f]').forEach((i) => { const v = parseFloat(i.value); if (i.value === '') values[i.dataset.f] = null; else if (!isFinite(v)) bad = true; else values[i.dataset.f] = v; });
        if (bad) { toast('Check the numbers'); return; }
        stop(); S.rows.push({ day: S.rows[S.rows.length - 1].day + 1, values }); S.ds = 'custom'; S.crew = undefined; S.name = 'Your data'; S.simulated = false; S.events = []; S.total = Math.max(S.total, S.rows.length); S.t = S.rows.length - 1; recompute(); renderAll(); return;
      }
      case 'runval': { const st = $('#valstatus'); if (st) st.textContent = 'Running 600 missions. This takes a few seconds.'; setTimeout(() => { S.valRun = [0, 0.25, 0.4].map((ar) => E.validate({ trials: 200, ar, seed: 7 })); renderView(); }, 40); return; }
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'labsig') { S.lab.sig = parseFloat(e.target.value); labUpdate(); }
    else if (e.target.id === 'labday') { S.lab.day = parseInt(e.target.value, 10); labUpdate(); }
  });
  let rsz = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rsz); rsz = requestAnimationFrame(() => { if (syncChartW()) renderView(); }); });
  $('#day').addEventListener('input', (e) => { if (S.playing) stop(); setT(parseInt(e.target.value, 10)); });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'labind') { S.lab.id = e.target.value; labUpdate(); }
    if (e.target.id === 'delaysel') { S.delayMode = e.target.value; chrome(); renderView(); }
    if (e.target.id === 'csvin' && e.target.files[0]) {
      const fr = new FileReader();
      fr.onload = () => { try { const rows = E.fromCSV(String(fr.result)).filter((r) => isFinite(r.day)).sort((a, b) => a.day - b.day); if (rows.length < 3) throw new Error('Need at least a few rows'); stop(); S.rows = rows; S.ds = 'custom'; S.crew = undefined; S.name = 'Your data'; S.simulated = false; S.events = []; S.total = Math.max(rows.length, 60); S.t = rows.length - 1; recompute(); renderAll(); toast('Imported ' + rows.length + ' days'); } catch (err) { toast('Import failed: ' + err.message); } };
      fr.readAsText(e.target.files[0]);
    }
  });
  // chart hover and click: one rAF-throttled pointer handler
  let hoverQueued = false, hoverEvt = null;
  function chartIndex(ev, svg) {
    const r = svg.getBoundingClientRect(), N = S.rows.length, x = ((ev.clientX - r.left) / r.width) * C.W;
    return Math.max(0, Math.min(N - 1, Math.round(((x - C.L) / (C.W - C.L - C.R)) * (N - 1))));
  }
  document.addEventListener('pointermove', (e) => {
    const svg = e.target.closest && e.target.closest('svg.chart[data-hover]');
    if (!svg) return;
    hoverEvt = { clientX: e.clientX, svg };
    if (hoverQueued) return; hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false; const h = hoverEvt; if (!h || S.tab !== 'trends') return;
      const i = chartIndex(h, h.svg); if (i === S.hoverIdx) return; S.hoverIdx = i;
      const tx = 'translate3d(' + pct(i) + '%,0,0)';
      ['hov', 'hov2'].forEach((k) => { const el = $('#' + k); if (el) { el.style.transform = tx; el.hidden = false; } });
      const ro = $('#readout'); if (ro) ro.innerHTML = readoutFor(i);
    });
  });
  document.addEventListener('pointerleave', () => {}, true);
  $('#view').addEventListener('pointerout', (e) => {
    if (!(e.target.closest && e.target.closest('svg.chart[data-hover]')) || (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('svg.chart[data-hover]'))) return;
    S.hoverIdx = null; ['hov', 'hov2'].forEach((k) => { const el = $('#' + k); if (el) el.hidden = true; });
    const ro = $('#readout'); if (ro) ro.innerHTML = readoutFor(S.t);
  });
  $('#view').addEventListener('click', (e) => {
    const svg = e.target.closest && e.target.closest('svg.chart[data-hover]');
    if (svg) { stop(); setT(chartIndex(e, svg)); }
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (VIEWS[h] && h !== S.tab) setTab(h); });
  $('nav.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = $$('nav.tabs button'), i = tabs.findIndex((b) => b.dataset.tab === S.tab);
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); setTab(n.dataset.tab);
  });

  const rptDlg = $('#rptdlg');
  if (rptDlg) {
    rptDlg.addEventListener('close', () => { document.body.classList.remove('rptopen'); if (rptTrigger && rptTrigger.focus && document.contains(rptTrigger)) rptTrigger.focus(); });
    rptDlg.addEventListener('click', (e) => { if (e.target === rptDlg) rptDlg.close(); });
  }

  /* ---------- boot ---------- */
  loadDataset('mars');
  try { const h0 = location.hash.slice(1); if (VIEWS[h0]) S.tab = h0; } catch (e) { /* ignore */ }
  renderAll();
  document.body.classList.add('ready');
  window.__astrocura = { S, E, O, setT, setTab };
})();
