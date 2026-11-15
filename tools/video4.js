const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  fs.mkdirSync('/tmp/v2', { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, env: { ...process.env, DISPLAY: ':99' }, args: ['--no-sandbox',  '--window-position=0,0', '--window-size=1300,900', '--force-device-scale-factor=1.5', '--disable-infobars', '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 726 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto('file:///home/claude/astrocura/dist/index.html');
  await page.waitForSelector('#view h1');
  await page.evaluate(() => {
    const css = document.createElement('style');
    css.textContent = `
    *{cursor:none!important}
    #cap{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);max-width:1010px;z-index:9999;background:rgba(14,18,27,.94);color:#fff;font:600 28px/1.28 Inter,system-ui,sans-serif;padding:15px 28px;border-radius:16px;text-align:center;opacity:0;transition:opacity .3s;pointer-events:none;letter-spacing:-.01em;box-shadow:0 10px 40px rgba(8,12,24,.35)}
    #cap.on{opacity:1}
    .card{position:fixed;inset:0;z-index:10000;background:radial-gradient(120% 90% at 50% 40%,#1B2440 0%,#0E121B 62%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;opacity:0;transition:opacity .7s;pointer-events:none}
    .card.on{opacity:1}
    .card .w{font:520 72px/1 Wordmark,Inter,sans-serif;letter-spacing:.46em;margin-right:-.46em}
    .card p{margin:0;font:500 26px/1.4 Inter,sans-serif;color:#C9D1E0;text-align:center}
    .card small{font:400 15px/1.5 Inter,sans-serif;color:#8E99AE;text-align:center;max-width:820px}
    .card .rule{width:64px;height:2px;background:#2253F2;border-radius:2px}`;
    document.head.appendChild(css);
    const mk = (id, cls, html) => { const d = document.createElement('div'); d.id = id; if (cls) d.className = cls; if (html) d.innerHTML = html; document.body.appendChild(d); return d; };
    mk('cap');
    mk('intro', 'card on', '<div class="w">ASTROCURA</div><div class="rule"></div><p>The astronaut’s health co-pilot</p><small>NASA Space Apps Challenge 2026</small>');
    mk('endc', 'card', '<div class="w">ASTROCURA</div><div class="rule"></div><p>Offline. Explainable. Honest about what is simulated.</p><small>Demo data is simulated. Video and music made with AI assistance (Claude, Anthropic).</small>');
    window.__cap = (t) => { const c = document.getElementById('cap'); c.classList.remove('on'); if (!t) return; setTimeout(() => { c.textContent = t; c.classList.add('on'); }, 160); };
    window.__sweep = (sel, to, ms) => new Promise((res) => { const el = document.querySelector(sel); const from = +el.value, t0 = performance.now(); const f = (n) => { const k = Math.min(1, (n - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; el.value = Math.round(from + (to - from) * e); el.dispatchEvent(new Event('input', { bubbles: true })); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
  });
  await page.mouse.move(1270, 715);
  // warm-up: JIT, crew analysis, chart caches, report and lab are all prepared before recording starts
  for (const id of ['#tab-crew', '#tab-actions', '#tab-lab', '#tab-overview']) { await page.click(id); await sleep(700); }
  await page.click('#tab-crew'); await sleep(300);
  await page.evaluate(() => window.__sweep('#day', 100, 600)); await sleep(900);
  await page.evaluate(() => window.__sweep('#day', 132, 400)); await sleep(600);
  await page.click('#tab-actions'); await sleep(300); await page.click('#view [data-act=report]'); await sleep(500); await page.keyboard.press('Escape'); await sleep(300);
  await page.click('#tab-overview'); await sleep(300);
  await page.evaluate(() => { window.scrollTo(0, 0); const sl = document.getElementById('day'); sl.value = 132; sl.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.mouse.move(1270, 715); await sleep(800);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '60', '-draw_mouse', '0', '-video_size', '1920x1080', '-i', ':99.0+0,131', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', '/tmp/v2/raw.mkv'], { env: { ...process.env, DISPLAY: ':99' }, stdio: ['pipe', 'inherit', 'inherit'] });
  await sleep(1200);
  const T0 = Date.now() / 1000; const events = [];
  const ev = (n) => events.push({ t: +(Date.now() / 1000 - T0).toFixed(2), n });
  const until = async (t) => { const w = (T0 + t) * 1000 - Date.now(); if (w > 0) await sleep(w); };
  const cap = (t) => page.evaluate((x) => window.__cap(x), t);
  const click = async (sel, name) => { ev(name); await page.click(sel); await page.mouse.move(1270, 715); };
  // storyboard v2 (29.5 s): intro, radiation day, findings day, crew of four, actions, report, stress test, end card
  ev('intro');
  await until(1.7); await page.evaluate(() => document.getElementById('intro').classList.remove('on')); ev('reveal');
  await until(2.3); await cap('On a Mars mission, help is 20 minutes away.'); ev('cap1');
  await until(4.3); ev('scene2'); await cap('Day 41: a radiation event, flagged on its first day.');
  page.evaluate(() => window.__sweep('#day', 40, 1000));
  await until(6.6); ev('scene3'); await cap('Day 133: sleep loss, deconditioning, an illness pattern. Each with its evidence.');
  page.evaluate(() => window.__sweep('#day', 132, 1200));
  await sleep(250);
  await page.evaluate(() => { const h = [...document.querySelectorAll('#view h2')].find((x) => /needs attention/i.test(x.textContent)); window.scrollTo({ top: h.getBoundingClientRect().top + scrollY - 190, behavior: 'smooth' }); });
  await until(9.9); await cap('');
  await until(10.1); await page.evaluate(() => window.scrollTo(0, 0)); await click('#tab-crew', 'click1');
  await until(10.5); await page.evaluate(() => { const sl = document.getElementById('day'); sl.value = 60; sl.dispatchEvent(new Event('input', { bubbles: true })); });
  await until(10.7); await cap('Four people, four normals. The same number means different things.'); ev('crew');
  page.evaluate(() => window.__sweep('#day', 138, 3100));
  await until(14.0); await cap('');
  await until(14.2); await page.evaluate(() => window.scrollTo(0, 0)); await click('#tab-actions', 'click2');
  await until(14.6); await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
  await until(14.9); await cap('Near Earth: call ground.'); ev('select1'); await page.selectOption('#delaysel', 'leo');
  await until(17.1); await cap('At Mars: act now, then send a compact packet.'); ev('select2'); await page.selectOption('#delaysel', 'marsFar');
  await until(19.2); await cap('');
  await until(19.4); await page.evaluate(() => window.scrollTo(0, 400)); ev('report'); await page.click('#view [data-act=report]'); await page.mouse.move(1270, 715);
  await until(19.7); await page.evaluate(() => { const c = document.getElementById('cap'); document.getElementById('rptdlg').appendChild(c); }); await cap('A report for the ground team, ready to print.');
  await until(20.5); await page.evaluate(() => document.getElementById('rptdlg').scrollTo({ top: 560, behavior: 'smooth' })); ev('rptscroll');
  await until(21.9); await cap('');
  await until(22.1); await page.keyboard.press('Escape'); ev('rptclose'); await page.evaluate(() => document.body.appendChild(document.getElementById('cap')));
  await until(22.4); await page.evaluate(() => window.scrollTo(0, 0)); await click('#tab-lab', 'click3');
  await until(22.8); await page.evaluate(() => window.scrollTo({ top: 330, behavior: 'smooth' }));
  await until(23.0); await cap('Break a simulated crew member on purpose.');
  await until(24.6); ev('scene5b'); await cap('See how fast it notices, and how often it misses.'); await page.evaluate(() => window.scrollTo({ top: 720, behavior: 'smooth' }));
  await until(26.0); await cap('');
  await until(26.15); ev('end'); await page.evaluate(() => document.getElementById('endc').classList.add('on'));
  await until(29.8);
  ff.stdin.write('q'); await new Promise((r) => ff.on('close', r));
  fs.writeFileSync('/tmp/v2/meta.json', JSON.stringify({ events }));
  console.log(JSON.stringify(events));
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
