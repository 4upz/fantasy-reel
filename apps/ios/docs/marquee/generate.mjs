// Draws the Marquee illustrations (docs/IOS-DELIGHT-PLAN.md section 5.2) and writes
// them into the asset catalog, one image set per layer with a light and a dark SVG.
//
//   node apps/ios/docs/marquee/generate.mjs
//
// Every layer shares the same 240 × 132 canvas, so stacking the layers of one piece
// in a ZStack rebuilds the whole drawing with no offsets, and each layer can slide or
// scale on its own. The SVGs stay inside what Xcode's asset catalog draws: paths,
// rects and circles with solid fills and strokes, transforms and fill-opacity. No
// clip paths, masks, gradients, filters, text or CSS. Shapes that the mockups clipped
// are clipped here, in the geometry. Edit this file and rerun it; never hand-edit
// the generated SVGs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.resolve(HERE, '../../FantasyReel/Resources/Assets.xcassets/Marquee');
const W = 240, H = 132;

// ---------------------------------------------------------------- palettes
// Brand colors (CLAUDE.md design tokens, the delight plan's Marquee palette).
// Fills are flat. The light theme keeps the same colors and adds an ink keyline
// where an ivory edge would otherwise dissolve into the light page.
const BASE = {
  gold: '#c9a227', goldLight: '#e3c35a', burgundy: '#a8505c', ivory: '#ead8b3',
  slate: '#718691', ink: '#0f0f0f',
};
const PALETTES = {
  dark: { ...BASE, keyline: null, page: '#0f0f0f', rayOpacity: 0.5, accent: BASE.ivory },
  light: { ...BASE, keyline: '#3a3226', page: '#f5f5f4', rayOpacity: 0.62, accent: '#b08a17' },
};

// ---------------------------------------------------------------- geometry
const n = (v) => {
  const s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};
const mix = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('');
};
const d = (pts) => 'M' + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L') + 'Z';

/** A rounded rectangle centered on 0,0 as a convex polygon (for clipping). */
const roundedPoly = (w, h, r, seg = 8) => {
  const out = [];
  const corners = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
};
const circlePoly = (cx, cy, r, seg = 120) =>
  Array.from({ length: seg }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / seg), cy + r * Math.sin((2 * Math.PI * i) / seg)]);

/** Sutherland–Hodgman: clips any polygon to a convex, clockwise (screen) polygon. */
const clip = (subject, clipper) => {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length; i++) {
    const [a, b] = [clipper[i], clipper[(i + 1) % clipper.length]];
    const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const cross = (p, q) => {
      const [x1, y1, x2, y2, x3, y3, x4, y4] = [...p, ...q, ...a, ...b];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const [p, q] = [input[j], input[(j + 1) % input.length]];
      if (inside(q)) {
        if (!inside(p)) out.push(cross(p, q));
        out.push(q);
      } else if (inside(p)) out.push(cross(p, q));
    }
  }
  return out;
};

/** Wedges of a sunburst fanning upward from 0,0: every other slice of the half circle. */
const rayWedges = (count, radius, from = 180, to = 360) => {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a0 = ((from + ((to - from) * i) / count) * Math.PI) / 180;
    const a1 = ((from + ((to - from) * (i + 0.5)) / count) * Math.PI) / 180;
    out.push([[0, 0], [radius * Math.cos(a0), radius * Math.sin(a0)], [radius * Math.cos(a1), radius * Math.sin(a1)]]);
  }
  return out;
};
const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);

const g = (x, y, r, inner) => `<g transform="translate(${n(x)} ${n(y)})${r ? ` rotate(${n(r)})` : ''}">${inner}</g>`;
const rect = (x, y, w, h, rx, fill, extra = '') =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}" fill="${fill}"${extra}/>`;
const circle = (cx, cy, r, fill) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>`;
const pathEl = (dd, fill, extra = '') => `<path d="${dd}" fill="${fill}"${extra}/>`;

const starPts = (r, inner = 0.45) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, R = i % 2 ? r * inner : r;
    return [Math.cos(a) * R, Math.sin(a) * R];
  });
const star = (x, y, r, fill) => pathEl(d(shift(starPts(r), x, y)), fill);
const heart = (x, y, s, fill) =>
  `<path transform="translate(${n(x)} ${n(y)}) scale(${n(s)})" d="M0 12C-16 0 -11 -12 -4 -11C-1.5 -11 0 -8.5 0 -7C0 -8.5 1.5 -11 4 -11C11 -12 16 0 0 12Z" fill="${fill}"/>`;

/** Ink keyline behind a shape, light theme only: the same outline grown by `grow`. */
const keylineRect = (p, x, y, w, h, rx, grow = 3) => (p.keyline ? rect(x - grow, y - grow, w + 2 * grow, h + 2 * grow, rx + grow, p.keyline) : '');

// ---------------------------------------------------------------- vocabulary
/**
 * The poster card: a flat color, a half sun rising from its bottom edge with rays
 * behind it, and an ivory border. Centered on x,y and tilted by `rot` degrees.
 */
const posterCard = (p, x, y, rot, fill, { w = 60, h = 84, badge = '' } = {}) => {
  const body = roundedPoly(w, h, 6);
  const sunY = h / 2 + 2;
  const rays = rayWedges(7, 120).map((t) => d(clip(shift(t, 0, sunY), body))).join('');
  const sun = d(clip(circlePoly(0, sunY, 26), body));
  const hole = d(clip(circlePoly(0, sunY, 16), body));
  return g(x, y, rot, [
    keylineRect(p, -w / 2, -h / 2, w, h, 6),
    rect(-w / 2, -h / 2, w, h, 6, fill),
    pathEl(rays, mix(fill, '#ffffff', 0.16)),
    pathEl(sun, p.ivory),
    pathEl(hole, fill),
    rect(-w / 2, -h / 2, w, h, 6, 'none', ` stroke="${p.ivory}" stroke-width="3"`),
    badge,
  ].join(''));
};

/** A round ink badge with a symbol in it, the Marquee "medal". */
const badge = (x, y, r, inner) => circle(x, y, r, BASE.ink) + inner;

/** A chunky deco arrow pointing right, tip at 0,0. */
const arrowPts = (len, shaft = 9, head = 15, headLen = 18) => [
  [-len, -shaft / 2], [-headLen, -shaft / 2], [-headLen, -head], [0, 0], [-headLen, head], [-headLen, shaft / 2], [-len, shaft / 2],
];

/** A string of marquee bulbs along a line. */
const bulbs = (x0, y0, x1, y1, count, r, fill) =>
  Array.from({ length: count }, (_, i) => circle(x0 + ((x1 - x0) * i) / (count - 1), y0 + ((y1 - y0) * i) / (count - 1), r, fill)).join('');

// ---------------------------------------------------------------- the pieces
// Each piece is a list of layers, back to front: [name, (palette) => svg body].
const PIECES = {
  // I1 · Trades, empty: two poster cards and a pair of arrows.
  trades: [
    ['left', (p) => posterCard(p, 62, 66, -10, p.burgundy)],
    ['right', (p) => posterCard(p, 178, 66, 10, p.slate)],
    ['arrows', (p) => {
      const top = shift(arrowPts(44), 144, 50), bottom = shift(arrowPts(44).map(([x, y]) => [-x, y]), 96, 82);
      const fill = p.keyline ? p.accent : p.gold;
      return pathEl(d(top) + d(bottom), fill);
    }],
  ],

  // I2 · Wishlist, empty: a fan of cards with a heart badge.
  wishlist: [
    ['back', (p) => posterCard(p, 90, 70, -15, p.slate) + posterCard(p, 150, 70, 15, p.burgundy)],
    ['front', (p) => posterCard(p, 120, 64, 0, p.gold)],
    ['heart', (p) => badge(120, 56, 20, heart(120, 57, 1.05, p.ivory))],
  ],

  // I3 · Bids, empty: a card, a bid slip and a coin. No gavel.
  bids: [
    ['card', (p) => posterCard(p, 88, 68, -9, p.slate)],
    ['slip', (p) => g(156, 72, 8, [
      keylineRect(p, -31, -37, 62, 74, 6, 1.5),
      rect(-31, -37, 62, 74, 6, p.ivory),
      rect(-22, -26, 28, 6, 3, mix(p.ivory, p.ink, 0.42)),
      rect(-22, -13, 44, 5, 2.5, mix(p.ivory, p.ink, 0.22)),
      rect(-22, -3, 36, 5, 2.5, mix(p.ivory, p.ink, 0.22)),
      rect(-22, 12, 44, 14, 7, p.burgundy),
    ].join(''))],
    ['coin', (p) => g(196, 34, 0, [
      circle(0, 0, 18, p.keyline ?? p.ink),
      circle(0, 0, 15, p.gold),
      circle(0, 0, 11, 'none').replace('fill="none"', `fill="none" stroke="${mix(p.gold, p.ink, 0.25)}" stroke-width="1.2"`),
      `<path d="M0 -8.5V8.5M4.5 -4.5C2 -7 -5 -6.5 -5 -2.5C-5 1 5 -1 5 3C5 6.5 -2 7 -5 4.5" fill="none" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>`,
    ].join(''))],
  ],

  // I4 · Notifications, empty: a quiet cinema marquee, its bulbs dark, its board blank.
  notifications: [
    ['crest', (p) => {
      const rays = rayWedges(9, 40).map((t) => d(clip(t, halfDisc(40)))).join('');
      return g(120, 40, 0, pathEl(rays, p.gold, ` fill-opacity="${p.rayOpacity}"`) + pathEl(d(halfDisc(15)), p.gold) + pathEl(d(halfDisc(8)), p.keyline ? p.page : p.ink));
    }],
    ['board', (p) => [
      keylineRect(p, 36, 40, 168, 66, 8),
      rect(36, 40, 168, 66, 8, p.burgundy),
      rect(36, 40, 168, 66, 8, 'none', ` stroke="${p.ivory}" stroke-width="3"`),
      rect(56, 54, 128, 38, 4, p.ivory),
      // Empty letter rows: the slots are there, nothing is spelled out.
      ...[63, 73, 83].map((y) => rect(66, y - 1.5, 108, 3, 1.5, mix(p.ivory, p.ink, 0.14))),
      rect(52, 106, 136, 10, 3, p.slate),
      rect(76, 116, 8, 10, 2, p.slate),
      rect(156, 116, 8, 10, 2, p.slate),
    ].join('')],
    ['bulbs', (p) => {
      // Bulbs are off: a dim gold, not the lit ivory of a busy night.
      const off = mix(p.gold, p.burgundy, 0.55);
      return bulbs(46, 47, 194, 47, 13, 2.6, off) + bulbs(46, 99, 194, 99, 13, 2.6, off)
        + bulbs(45, 60, 45, 86, 3, 2.6, off) + bulbs(195, 60, 195, 86, 3, 2.6, off);
    }],
  ],

  // I5 · Draft before it starts, roster before the draft: seats and a ticket.
  draft: [
    ['seats', (p) => [80, 120, 160].map((x) => seat(p, x, 126)).join('')
      + rect(54, 120, 132, 6, 3, mix(p.slate, p.ink, 0.25))],
    ['ticket', (p) => g(136, 34, -9, ticket(p))],
  ],

  // I6 · No leagues yet, season not open: the cinema entrance, a smaller cut of I8.
  entrance: [
    ['building', (p) => [
      g(120, 28, 0, pathEl(rayWedges(9, 36).map((t) => d(clip(t, halfDisc(36)))).join(''), p.gold, ` fill-opacity="${p.rayOpacity}"`)
        + pathEl(d(halfDisc(13)), p.gold)),
      rect(102, 28, 36, 14, 2, p.slate),
      rect(86, 36, 68, 12, 2, p.slate),
      rect(64, 44, 112, 88, 2, p.slate),
      // Deco pilasters either side of the doors.
      rect(70, 80, 4, 52, 2, mix(p.slate, p.ink, 0.25)), rect(166, 80, 4, 52, 2, mix(p.slate, p.ink, 0.25)),
    ].join('')],
    ['canopy', (p) => [
      keylineRect(p, 44, 56, 152, 22, 5),
      rect(44, 56, 152, 22, 5, p.burgundy),
      rect(44, 56, 152, 22, 5, 'none', ` stroke="${p.ivory}" stroke-width="3"`),
      rect(70, 62.5, 100, 9, 4.5, p.ivory),
      bulbs(52, 67, 62, 67, 2, 2.4, p.goldLight),
      bulbs(178, 67, 188, 67, 2, 2.4, p.goldLight),
    ].join('')],
    ['doors', (p) => [
      rect(98, 86, 44, 46, 3, p.ivory),
      rect(101, 89, 18.5, 43, 2, p.ink),
      rect(120.5, 89, 18.5, 43, 2, p.ink),
      circle(115, 112, 1.8, p.gold),
      circle(125, 112, 1.8, p.gold),
      posterCard(p, 80, 106, 0, p.burgundy, { w: 22, h: 30 }).replace(/stroke-width="3"/, 'stroke-width="2"'),
      posterCard(p, 160, 106, 0, p.gold, { w: 22, h: 30 }).replace(/stroke-width="3"/, 'stroke-width="2"'),
    ].join('')],
  ],

  // I7 · Season complete: a sunburst behind the winning card.
  champion: [
    ['sunburst', (p) => g(120, 132, 0, pathEl(rayWedges(11, 118).map((t) => d(t)).join(''), p.gold, ` fill-opacity="${p.rayOpacity}"`))],
    ['card', (p) => posterCard(p, 120, 74, 0, p.gold, { badge: badge(0, -12, 19, star(0, -12, 12, p.goldLight)) })],
    ['stars', (p) => star(42, 36, 6, p.keyline ? p.accent : p.ivory) + star(200, 48, 5, p.keyline ? p.accent : p.ivory) + star(178, 22, 3.5, p.keyline ? p.accent : p.ivory)],
  ],
};

/** The upper half of a circle centered on 0,0, as a polygon. */
function halfDisc(r, seg = 60) {
  return Array.from({ length: seg + 1 }, (_, i) => {
    const a = Math.PI + (Math.PI * i) / seg;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/** A theatre seat: a rounded back with deco channels, a cushion and arms. Bottom at y. */
function seat(p, x, y) {
  const back = `M${n(x - 17)} ${n(y - 10)}V${n(y - 46)}A17 17 0 0 1 ${n(x + 17)} ${n(y - 46)}V${n(y - 10)}Z`;
  const channel = mix(p.burgundy, p.ink, 0.22);
  return [
    p.keyline ? pathEl(`M${n(x - 18.5)} ${n(y - 8.5)}V${n(y - 46)}A18.5 18.5 0 0 1 ${n(x + 18.5)} ${n(y - 46)}V${n(y - 8.5)}Z`, p.keyline) : '',
    pathEl(back, p.burgundy),
    rect(x - 9, y - 50, 3, 34, 1.5, channel), rect(x - 1.5, y - 54, 3, 38, 1.5, channel), rect(x + 6, y - 50, 3, 34, 1.5, channel),
    rect(x - 19, y - 16, 38, 10, 4, mix(p.burgundy, p.ink, 0.35)),
    rect(x - 22, y - 26, 5, 20, 2.5, p.slate), rect(x + 17, y - 26, 5, 20, 2.5, p.slate),
  ].join('');
}

/** An admit-one ticket centered on 0,0: notched sides, a stub, a star. */
function ticket(p) {
  const w = 92, h = 44, r = 7;
  const shape = `M${-w / 2} ${-h / 2}H${w / 2}V${-r}A${r} ${r} 0 0 0 ${w / 2} ${r}V${h / 2}H${-w / 2}V${r}A${r} ${r} 0 0 0 ${-w / 2} ${-r}Z`;
  const grown = `M${-w / 2 - 2} ${-h / 2 - 2}H${w / 2 + 2}V${-r + 2}A${r - 2} ${r - 2} 0 0 0 ${w / 2 + 2} ${r - 2}V${h / 2 + 2}H${-w / 2 - 2}V${r - 2}A${r - 2} ${r - 2} 0 0 0 ${-w / 2 - 2} ${-r + 2}Z`;
  const perf = mix(p.gold, p.ink, 0.45);
  return [
    pathEl(grown, p.keyline ?? p.ink),
    pathEl(shape, p.gold),
    rect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 3, 'none').replace('fill="none"', `fill="none" stroke="${p.ivory}" stroke-width="1.6"`),
    ...[-14, -7, 0, 7, 14].map((y) => rect(20, y - 2, 2, 4, 1, perf)),
    star(-8, 0, 11, p.ink),
    rect(28, -9, 9, 3, 1.5, perf), rect(28, -2, 9, 3, 1.5, perf), rect(28, 5, 6, 3, 1.5, perf),
  ].join('');
}

// ---------------------------------------------------------------- output
const svg = (body, { width = 216 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${n((width * H) / W)}" viewBox="0 0 ${W} ${H}">${body}</svg>\n`;
const camel = (s) => s[0].toUpperCase() + s.slice(1);

export function render(piece, theme, layers = null) {
  return PIECES[piece].filter(([name]) => !layers || layers.includes(name)).map(([, draw]) => draw(PALETTES[theme])).join('');
}
export const pieces = Object.fromEntries(Object.entries(PIECES).map(([k, v]) => [k, v.map(([name]) => name)]));
export { svg, W, H };

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.rmSync(CATALOG, { recursive: true, force: true });
  write(path.join(CATALOG, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 }, properties: { 'provides-namespace': true } }, null, 2) + '\n');
  let total = 0;
  for (const [piece, layers] of Object.entries(PIECES)) {
    for (const [layer, draw] of layers) {
      const name = `${camel(piece)}${camel(layer)}`;
      const dir = path.join(CATALOG, `${name}.imageset`);
      const light = svg(draw(PALETTES.light)), dark = svg(draw(PALETTES.dark));
      write(path.join(dir, `${name}-light.svg`), light);
      write(path.join(dir, `${name}-dark.svg`), dark);
      total += light.length + dark.length;
      write(path.join(dir, 'Contents.json'), JSON.stringify({
        images: [
          { filename: `${name}-light.svg`, idiom: 'universal' },
          { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: `${name}-dark.svg`, idiom: 'universal' },
        ],
        info: { author: 'xcode', version: 1 },
        properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'original' },
      }, null, 2) + '\n');
    }
  }
  console.log(`wrote ${Object.values(PIECES).flat().length} layers, ${(total / 1024).toFixed(1)} KB`);
}
