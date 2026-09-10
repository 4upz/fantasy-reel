// Run from the repository root: node docs/brand/source/build-assets.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(source, '../../../apps/frontend/public/brand/v1');
const gold = '#c9a227';
const dark = '#0f0f0f';
const charcoal = '#1c1c1c';
const white = '#e8e8e8';
const master = await fs.readFile(path.join(source, 'mark.svg'), 'utf8');
const micro = await fs.readFile(path.join(source, 'micro-mark.svg'), 'utf8');
const wordmarks = JSON.parse(await fs.readFile(path.join(source, 'wordmarks.json'), 'utf8'));
await fs.mkdir(out, { recursive: true });

const markPath = master.match(/\sd="([^"]+)"/)[1];
const microPath = micro.match(/\sd="([^"]+)"/)[1];
const mark = (color, transform = '') => `<path fill="${color}" fill-rule="evenodd" transform="${transform}" d="${markPath}"/>`;
const svg = (w, h, label, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${content}</svg>\n`;
const save = (name, data) => fs.writeFile(path.join(out, name), data);

for (const [name, color] of [['gold', gold], ['white', white], ['ink', dark]]) {
  await save(`mark-${name}.svg`, svg(128, 112, 'Fantasy Reel', mark(color)));
}

function wordmark(which, color, x, y, height) {
  const w = wordmarks[which];
  return `<g transform="translate(${x} ${y}) scale(${height / w.height})"><path fill="${color}" transform="${w.transform}" d="${w.path}"/></g>`;
}

for (const [name, which, symbolColor, typeColor] of [
  ['logo-dark', 'regular', gold, white],
  ['logo-gold', 'regular', gold, gold],
  ['logo-light', 'regular', dark, dark],
  ['logo-compact-dark', 'compact', gold, white],
]) {
  const width = 130 + wordmarks[which].width * 64 / wordmarks[which].height;
  await save(`${name}.svg`, svg(Number(width.toFixed(3)), 112, 'Fantasy Reel',
    mark(symbolColor, 'translate(0 1) scale(.94)') + wordmark(which, typeColor, 130, 27, 64)));
}
const stackedWidth = wordmarks.regular.width * 56 / wordmarks.regular.height;
await save('logo-stacked-dark.svg', svg(Number((stackedWidth + 32).toFixed(3)), 214, 'Fantasy Reel',
  mark(gold, `translate(${(stackedWidth + 32 - 140.8) / 2} 0) scale(1.1)`) + wordmark('regular', white, 16, 146, 56)));

const pngs = [];
for (const [name, background, foreground] of [['charcoal', charcoal, gold], ['gold', gold, dark]]) {
  const base = `<rect width="512" height="512" fill="${background}"/>`;
  const normal = svg(512, 512, 'Fantasy Reel', base + mark(foreground, 'translate(48 65) scale(3.25)'));
  const maskable = svg(512, 512, 'Fantasy Reel', base + mark(foreground, 'translate(85.12 96) scale(2.67)'));
  await save(`app-${name}.svg`, normal);
  await save(`maskable-${name}.svg`, maskable);
  for (const size of [180, 192, 512, 1024]) {
    const filename = `app-${name}-${size}.png`;
    await sharp(Buffer.from(normal), { density: 288 }).resize(size, size).removeAlpha().png().toFile(path.join(out, filename));
    pngs.push(filename);
  }
  await sharp(Buffer.from(maskable), { density: 288 }).resize(512, 512).removeAlpha().png().toFile(path.join(out, `maskable-${name}-512.png`));
  pngs.push(`maskable-${name}-512.png`);
}

const favicon = svg(16, 16, 'Fantasy Reel', `<rect width="16" height="16" rx="3" fill="${charcoal}"/><path fill="${gold}" fill-rule="evenodd" d="${microPath}"/>`);
await save('favicon.svg', favicon);
const icoBuffers = [];
for (const size of [16, 32, 48]) {
  const buffer = await sharp(Buffer.from(favicon), { density: 288 }).resize(size, size).png().toBuffer();
  await save(`favicon-${size}.png`, buffer);
  icoBuffers.push({ size, buffer });
  pngs.push(`favicon-${size}.png`);
}
// ICO directory with PNG payloads at each explicitly rendered size.
const header = Buffer.alloc(6 + 16 * icoBuffers.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoBuffers.length, 4);
let offset = header.length;
icoBuffers.forEach(({ size, buffer }, i) => {
  const p = 6 + i * 16;
  header[p] = size;
  header[p + 1] = size;
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(buffer.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += buffer.length;
});
await save('favicon.ico', Buffer.concat([header, ...icoBuffers.map(x => x.buffer)]));
await save('pinned-tab.svg', svg(16, 16, 'Fantasy Reel', `<path fill="#000" fill-rule="evenodd" d="${microPath}"/>`));

await save('asset-index.json', JSON.stringify({
  status: 'Candidate assets; app metadata and navigation are not switched to these files.',
  colors: { gold, dark, charcoal, white },
  pngs,
  recommended: {
    logo: 'logo-dark.svg', favicon: 'favicon.svg', fallback: 'favicon.ico',
    apple: 'app-charcoal-180.png', android: 'app-charcoal-192.png',
    large: 'app-charcoal-512.png', maskable: 'maskable-charcoal-512.png',
  },
}, null, 2) + '\n');
console.log(`Built vector logos and ${pngs.length} PNG exports in ${out}`);
