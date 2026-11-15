const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const AXE = fs.readFileSync('/tmp/axe/node_modules/axe-core/axe.min.js', 'utf8');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let total = 0;
  for (const [label, vp] of [['desktop 1280', { width: 1280, height: 900 }], ['mobile 390', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto('file:///home/claude/astrocura/dist/index.html'); await page.waitForSelector('#view h1');
    for (const tab of ['overview', 'trends', 'crew', 'actions', 'checkin', 'lab', 'osdr', 'methods', 'validation']) {
      await page.evaluate((t) => window.__astrocura.setTab(t), tab); await page.waitForTimeout(700);
      await page.evaluate(AXE);
      const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
      total += r.violations.length;
      console.log(label.padEnd(13), tab.padEnd(10), 'violations:', r.violations.length, '| passes:', r.passes.length, '| incomplete:', r.incomplete.length);
      r.violations.forEach((v) => console.log('   -', v.id, '[' + v.impact + ']', v.nodes.length + ' nodes', '|', v.help, '|', v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')));
      r.incomplete.filter((v) => v.id === 'color-contrast').forEach((v) => console.log('   ? contrast needs review:', v.nodes.length, 'nodes', v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')));
    }
    // the report dialog, open
    await page.evaluate(() => window.__astrocura.setTab('overview')); await page.click('[data-act=report]'); await page.waitForTimeout(300);
    await page.evaluate(AXE);
    const rr = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
    total += rr.violations.length;
    console.log(label.padEnd(13), 'report dlg'.padEnd(10), 'violations:', rr.violations.length);
    rr.violations.forEach((v) => console.log('   -', v.id, '[' + v.impact + ']', v.nodes.length + ' nodes', '|', v.help, '|', v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')));
    await page.close();
  }
  console.log('TOTAL violations', total);
  await browser.close();
})();
