// Renders the preview sheet (preview.png) of every Marquee piece in both themes,
// at the size the app shows it (216 pt), from the same code that writes the assets.
//   node apps/ios/docs/marquee/preview.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { render, pieces, svg } from './generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const LABELS = {
  trades: 'I1 · Trades', wishlist: 'I2 · Wishlist', bids: 'I3 · Bids', notifications: 'I4 · Notifications',
  draft: 'I5 · Draft and roster, before the draft', entrance: 'I6 · No leagues, season not open', champion: 'I7 · Champion',
};
const THEMES = { dark: { bg: '#0f0f0f', fg: '#e8e8e8', sub: '#b8b0a4' }, light: { bg: '#f5f5f4', fg: '#242424', sub: '#55514b' } };
const col = (theme) => Object.keys(pieces).map((p) => `
  <figure>${svg(render(p, theme))}<figcaption style="color:${THEMES[theme].sub}">${LABELS[p]}<br><small>${pieces[p].join(' · ')}</small></figcaption></figure>`).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;font:13px -apple-system,system-ui,sans-serif;background:#000}
  .sheet{display:flex}
  .theme{padding:24px 20px;display:grid;grid-template-columns:repeat(4,232px);gap:22px 14px}
  figure{margin:0;display:flex;flex-direction:column;align-items:center}
  figcaption{margin-top:8px;text-align:center;line-height:1.35}
  h2{grid-column:1/-1;margin:0 0 4px;font-size:15px}
  small{opacity:.8}
</style><div class="sheet">${Object.entries(THEMES).map(([t, c]) => `<div class="theme" style="background:${c.bg}"><h2 style="color:${c.fg}">${t === 'dark' ? 'Dark' : 'Light'}</h2>${col(t)}</div>`).join('')}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2000, height: 900 } });
await page.setContent(html);
await page.locator('.sheet').screenshot({ path: path.join(HERE, process.argv[2] ?? 'preview.png') });
await browser.close();
console.log('wrote preview');
