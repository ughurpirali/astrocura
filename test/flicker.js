const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file:///home/claude/astrocura/dist/index.html'); await p.waitForSelector('#view h1');
  // 1) patched DOM equals a fresh render
  let bad = 0;
  for (const tab of ['overview', 'actions', 'crew']) {
    await p.click('#tab-' + tab);
    for (const d of [5, 28, 41, 60, 90, 133, 170, 12, 133]) {
      await p.evaluate(async (d) => { const sl = document.getElementById('day'); sl.value = d; sl.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 160)); }, d);
      const a = await p.evaluate(() => document.getElementById('view').innerHTML);
      await p.click('#tab-' + (tab === 'overview' ? 'methods' : 'overview')); await p.click('#tab-' + tab);
      const c = await p.evaluate(() => document.getElementById('view').innerHTML);
      if (a !== c) { bad++; console.log('MISMATCH', tab, d, a.length, c.length); }
    }
  }
  console.log('patched == fresh render, mismatches:', bad);
  // 2) node identity and clicks while playing
  await p.click('#tab-overview'); await p.evaluate(() => { const sl = document.getElementById('day'); sl.value = 0; sl.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(200);
  await p.evaluate(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false }); window.__btn = document.querySelector('.stepbtn[data-tab=actions]'); window.__det = null; });
  await p.click('.stepbtn[data-act=play]');
  await p.waitForTimeout(1500);
  console.log('playing:', await p.getAttribute('#play', 'aria-pressed'), '| day', await p.textContent('#daylabel'));
  const same = await p.evaluate(() => window.__btn === document.querySelector('.stepbtn[data-tab=actions]') && document.body.contains(window.__btn));
  console.log('start-here button is the same DOM node after ~10 daily updates:', same);
  // hover + slow click (mousedown, wait 400 ms spanning several updates, mouseup)
  const bb = await p.locator('.stepbtn[data-tab=actions]').boundingBox();
  await p.mouse.move(bb.x + 40, bb.y + 20); await p.mouse.down(); await p.waitForTimeout(450); await p.mouse.up(); await p.waitForTimeout(200);
  console.log('slow click while playing switched to:', await p.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').textContent));
  await p.click('#tab-overview'); await p.waitForTimeout(300);
  // details survive updates
  const det = p.locator('details').first();
  if (await det.count()) { await det.locator('summary').click(); await p.waitForTimeout(700); console.log('details still open while playing:', await det.evaluate((d) => d.open)); }
  await p.waitForTimeout(500);
  const cls = await p.evaluate(() => window.__cls); console.log('layout shift while playing (CLS):', cls.toFixed(4));
  // speed
  const days0 = await p.evaluate(() => +document.querySelector('#daylabel b').textContent);
  await p.waitForTimeout(2000); const days1 = await p.evaluate(() => +document.querySelector('#daylabel b').textContent);
  console.log('speed 1x: days per second ≈', ((days1 - days0) / 2).toFixed(1), '| label', await p.textContent('#speed'), '|', await p.getAttribute('#speed', 'aria-label'));
  await p.click('#speed'); const d2 = await p.evaluate(() => +document.querySelector('#daylabel b').textContent); await p.waitForTimeout(2000); const d3 = await p.evaluate(() => +document.querySelector('#daylabel b').textContent);
  console.log('speed', await p.textContent('#speed'), '≈', ((d3 - d2) / 2).toFixed(1), 'd/s');
  await p.click('#play');
  // 3) cost of one update
  const ms = await p.evaluate(async () => { const sl = document.getElementById('day'); const t0 = performance.now(); for (let i = 0; i < 60; i++) { sl.value = 50 + i; sl.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); } return (performance.now() - t0) / 60; });
  console.log('avg ms per slider step (includes 90 ms throttle waits)', ms.toFixed(1));
  console.log('ERRORS', JSON.stringify(errs));
  await b.close();
})();
