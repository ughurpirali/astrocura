const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [label, rate] of [['normal CPU', 1], ['4x slower CPU', 4]]) {
    for (const tab of ['overview', 'trends', 'crew']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.goto('file:///home/claude/astrocura/dist/index.html#' + tab); await page.waitForSelector('#view h1, #view h2');
      await page.evaluate(() => window.__astrocura.setT(10)); await page.waitForTimeout(100);
      const r = await page.evaluate(() => new Promise((resolve) => {
        const times = [], lefts = new Set(); let prev = performance.now(); const ph = document.getElementById('ph');
        document.getElementById('play').click();
        function loop(ts) { times.push(ts - prev); prev = ts; lefts.add(ph.style.transform); if (times.length < 90) requestAnimationFrame(loop); else { document.getElementById('play').click(); resolve({ frames: times.length, avgMs: times.reduce((a, b) => a + b) / times.length, worstMs: Math.max.apply(null, times.slice(2)), over20: times.slice(2).filter((x) => x > 20).length, distinctPlayheadPositions: lefts.size }); } }
        requestAnimationFrame(loop);
      }));
      console.log(label.padEnd(14), tab.padEnd(9), 'avg frame ' + r.avgMs.toFixed(1) + ' ms (' + (1000 / r.avgMs).toFixed(0) + ' fps), worst ' + r.worstMs.toFixed(1) + ' ms, frames over 20 ms: ' + r.over20 + '/' + (r.frames - 2) + ', distinct playhead positions: ' + r.distinctPlayheadPositions + '/' + r.frames);
      await page.close();
    }
  }
  await browser.close();
})();
