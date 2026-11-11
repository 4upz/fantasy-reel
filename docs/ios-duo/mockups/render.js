// Renders every mockup HTML in this folder to a PNG beside it: node render.js [name ...]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(__dirname).filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 });
  for (const n of names) {
    await page.goto('file://' + path.join(__dirname, n + '.html'));
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.device').first().screenshot({ path: path.join(__dirname, n + '.png') });
    console.log('rendered', n);
  }
  await browser.close();
})();
