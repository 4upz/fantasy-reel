// Three candidate illustration styles for the iOS app, each drawing the same three subjects
// (trade, wishlist, champion) so they can be compared. Usage: <span data-style="line:trade"></span>
(() => {
  const G = '#c9a227', GL = '#e3c35a', B = '#a8505c', I = '#ead8b3', S = '#718691', K = '#0f0f0f';
  document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute"><defs>
    <filter id="gb" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="gs" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/></linearGradient>
    <linearGradient id="gst" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".65"/><stop offset=".5" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity=".30"/></linearGradient>
  </defs></svg>`);
  const at = (x, y, r, inner) => `<g transform="translate(${x} ${y}) rotate(${r})">${inner}</g>`;
  const heart = (s) => `<path transform="scale(${s})" d="M0 12 C-16 0 -11 -12 -4 -11 C-1.500 -11 0 -8.500 0 -7 C0 -8.500 1.500 -11 4 -11 C11 -12 16 0 0 12Z"/>`;
  const star = (r) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, R = i % 2 ? r * .45 : r; d += (i ? 'L' : 'M') + (Math.cos(a) * R).toFixed(1) + ' ' + (Math.sin(a) * R).toFixed(1); } return `<path d="${d}Z"/>`; };

  // ---- A. Gold line: thin gold outlines, one small filled accent. Sits next to the app's line icons.
  const lc = (x, y, r, acc) => at(x, y, r, `<rect x="-29" y="-41" width="58" height="82" rx="8" fill="rgba(201,162,39,.07)" stroke="${G}" stroke-width="2.400"/>
    <circle cx="9" cy="-17" r="8" fill="${acc}"/><path d="M-29 14 C-12 0 4 6 29 20" fill="none" stroke="${G}" stroke-width="2.400" stroke-linecap="round"/><path d="M-29 30 C-8 18 10 22 29 12" fill="none" stroke="${G}" stroke-width="2.400" stroke-linecap="round" opacity=".5"/>`);
  const line = {
    trade: () => `<g fill="none" stroke="${I}" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"><path d="M98 50 C112 40 128 40 142 50"/><path d="M135 41 l8 9 l-12 2"/><path d="M142 82 C128 92 112 92 98 82"/><path d="M105 91 l-8 -9 l12 -2"/></g>` + lc(62, 66, -11, I) + lc(178, 66, 11, B),
    wishlist: () => lc(98, 68, -12, 'none') + lc(128, 64, 4, I) + `<g transform="translate(160 34)"><circle r="19" fill="${K}"/><circle r="17" fill="none" stroke="${G}" stroke-width="2.400"/><g fill="${B}">${heart(.85)}</g></g>`,
    champion: () => { let l = ''; for (let i = 0; i < 6; i++) { const a = (-50 + i * 22) * Math.PI / 180, x = 58 * Math.cos(a), y = -58 * Math.sin(a), t = Math.atan2(-Math.cos(a), -Math.sin(a)) * 180 / Math.PI - 30; l += `<path transform="translate(${x} ${y}) rotate(${t})" d="M0 0 C5 -5 13 -5 17 0 C13 5 5 5 0 0Z"/>`; }
      return `<g fill="none" stroke="${G}" stroke-width="2"><g transform="translate(120 76)">${l}</g><g transform="translate(120 76) scale(-1 1)">${l}</g></g>` + lc(120, 72, 0, 'none') + `<g transform="translate(120 20)" fill="${G}">${star(11)}</g>`; },
  };

  // ---- B. Marquee: bold flat shapes, art-deco sunbursts, strong color blocks. No texture.
  const rays = (n, R, col, op) => { let o = ''; for (let i = 0; i < n; i++) { const a0 = Math.PI + (i / n) * Math.PI, a1 = Math.PI + ((i + .5) / n) * Math.PI; o += `<path d="M0 0 L${(Math.cos(a0) * R).toFixed(1)} ${(Math.sin(a0) * R).toFixed(1)} L${(Math.cos(a1) * R).toFixed(1)} ${(Math.sin(a1) * R).toFixed(1)}Z"/>`; } return `<g fill="${col}" opacity="${op}">${o}</g>`; };
  const dc = (x, y, r, bg, id) => at(x, y, r, `<clipPath id="${id}"><rect x="-30" y="-42" width="60" height="84" rx="6"/></clipPath><rect x="-30" y="-42" width="60" height="84" rx="6" fill="${bg}"/>
    <g clip-path="url(#${id})"><g transform="translate(0 44)">${rays(7, 110, '#fff', .16)}</g><circle cx="0" cy="44" r="26" fill="${I}"/><circle cx="0" cy="44" r="16" fill="${bg}"/></g>
    <rect x="-30" y="-42" width="60" height="84" rx="6" fill="none" stroke="${I}" stroke-width="3"/>`);
  const deco = {
    trade: () => dc(64, 66, -10, B, 'd1') + dc(176, 66, 10, S, 'd2') + `<g fill="${G}"><path d="M100 46 h26 v-9 l18 15 l-18 15 v-9 h-26z"/><path d="M140 74 h-26 v-9 l-18 15 l18 15 v-9 h26z"/></g>`,
    wishlist: () => dc(92, 68, -14, S, 'd3') + dc(148, 68, 14, B, 'd4') + dc(120, 62, 0, G, 'd5') + `<g transform="translate(120 56)"><circle r="20" fill="${K}"/><g fill="${I}">${heart(1)}</g></g>`,
    champion: () => `<g transform="translate(120 132)">${rays(11, 140, G, .5)}</g>` + dc(120, 74, 0, G, 'd6') + `<g transform="translate(120 62)"><circle r="19" fill="${K}"/><g fill="${GL}">${star(12)}</g></g><g fill="${I}"><g transform="translate(40 34)">${star(6)}</g><g transform="translate(202 48)">${star(5)}</g></g>`,
  };

  // ---- C. Glass: frosted translucent cards with soft colored light behind. Echoes iOS 26's Liquid Glass.
  const gc = (x, y, r, tint) => `<circle cx="${x}" cy="${y + 6}" r="34" fill="${tint}" opacity=".75" filter="url(#gb)"/>` + at(x, y, r, `<rect x="-29" y="-41" width="58" height="82" rx="12" fill="${tint}" opacity=".22"/><rect x="-29" y="-41" width="58" height="82" rx="12" fill="url(#gl)" stroke="url(#gst)" stroke-width="1.400"/>
    <circle cx="8" cy="-16" r="9" fill="#fff" opacity=".85"/><path d="M-29 18 C-10 2 6 10 29 24 V29 a12 12 0 0 1 -12 12 H-17 a12 12 0 0 1 -12 -12Z" fill="#fff" opacity=".16"/>`);
  const glass = {
    trade: () => gc(64, 66, -10, S) + gc(176, 66, 10, B) + `<g fill="none" stroke="${GL}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><g filter="url(#gs)" opacity=".8"><path d="M100 54 C112 44 128 44 140 54"/><path d="M140 80 C128 90 112 90 100 80"/></g><path d="M100 54 C112 44 128 44 140 54"/><path d="M133 45 l8 9 l-12 2"/><path d="M140 80 C128 90 112 90 100 80"/><path d="M107 89 l-8 -9 l12 -2"/></g>`,
    wishlist: () => gc(96, 70, -13, S) + gc(140, 66, 8, G) + `<g transform="translate(166 36)"><circle r="20" fill="${B}" filter="url(#gb)"/><circle r="18" fill="url(#gl)" stroke="url(#gst)" stroke-width="1.400"/><g fill="#fff" opacity=".95">${heart(.8)}</g></g>`,
    champion: () => `<circle cx="120" cy="74" r="56" fill="${G}" opacity=".55" filter="url(#gb)"/>` + gc(120, 74, 0, G) + `<g transform="translate(120 24)"><g fill="${GL}" filter="url(#gs)" opacity=".9">${star(13)}</g><g fill="#fff3c4">${star(11)}</g></g>`,
  };
  const ALL = { line, deco, glass };
  for (const el of document.querySelectorAll('[data-style]')) {
    const [s, a] = el.dataset.style.split(':'); el.style.display = 'block';
    el.innerHTML = `<svg viewBox="0 0 240 132" width="100%" style="display:block;overflow:visible">${ALL[s][a]().replace(/(\d)\.(\d)00\b/g, '$1.$2')}</svg>`;
  }
})();
