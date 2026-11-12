// Fantasy Reel "minimal storybook" illustration sketches for the delight plan mockups.
// These are vector stand-ins that follow docs/brand/illustrations.md (paper shapes, light grain, brand palette).
// They show placement, size and subject. Final art is produced separately (see the plan, section 5).
// Usage: <span data-art="trade" style="width:220px"></span>
(() => {
  const C = { gold: '#c9a227', goldD: '#9c7d1c', burg: '#a8505c', burgD: '#6e333d', ivory: '#ead8b3', ivoryD: '#cdb88f', blue: '#718691', blueD: '#44555e', char: '#2b2a28', charL: '#3a3835', ink: '#161514' };
  const SCHEME = {
    blue: { sky: '#5f747e', hill: '#3b4a52', hill2: '#4a5c65', moon: C.ivory },
    burg: { sky: '#8a4450', hill: '#5a2a33', hill2: '#6f3540', moon: '#e6b98c' },
    gold: { sky: '#b3922a', hill: '#6f5a16', hill2: '#8a701c', moon: '#f3e6c4' },
    dusk: { sky: '#4a4640', hill: '#2c2a27', hill2: '#383531', moon: C.gold },
  };
  // One shared filter: fine paper grain clipped to the artwork, plus a soft drop shadow.
  const defs = `<svg width="0" height="0" style="position:absolute"><defs>
    <filter id="grain" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 0.62" result="g"/>
      <feComposite in="g" in2="SourceAlpha" operator="in" result="gi"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="gi"/></feMerge>
    </filter>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".45"/></filter>
    <radialGradient id="warm" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#f0c865" stop-opacity=".95"/><stop offset="1" stop-color="#c9a227" stop-opacity=".0"/></radialGradient>
  </defs></svg>`;
  document.body.insertAdjacentHTML('afterbegin', defs);

  // A paper movie card: ivory border, simple sky, moon and two hills. Corners are nudged so it reads as cut paper.
  const card = (x, y, rot, scheme, w = 62, h = 88) => {
    const s = SCHEME[scheme], b = 5, iw = w - 2 * b, ih = h - 2 * b;
    return `<g transform="translate(${x} ${y}) rotate(${rot})" filter="url(#lift)"><g filter="url(#grain)">
      <path d="M${-w / 2 + .8} ${-h / 2} L${w / 2} ${-h / 2 + 1.2} L${w / 2 - .6} ${h / 2} L${-w / 2} ${h / 2 - .9}Z" fill="${C.ivory}"/>
      <g transform="translate(${-iw / 2} ${-ih / 2})"><clipPath id="c${x}${y}"><rect width="${iw}" height="${ih}" rx="1.5"/></clipPath><g clip-path="url(#c${x}${y})">
        <rect width="${iw}" height="${ih}" fill="${s.sky}"/>
        <circle cx="${iw * .62}" cy="${ih * .3}" r="${iw * .17}" fill="${s.moon}"/>
        <path d="M0 ${ih * .66} C${iw * .25} ${ih * .5} ${iw * .5} ${ih * .58} ${iw} ${ih * .74} V${ih} H0Z" fill="${s.hill2}"/>
        <path d="M0 ${ih * .86} C${iw * .3} ${ih * .7} ${iw * .65} ${ih * .72} ${iw} ${ih * .62} V${ih} H0Z" fill="${s.hill}"/>
      </g></g></g></g>`;
  };
  // A film ribbon: thick gold stroke with a row of frames punched down the middle.
  const ribbon = (d, w = 20) => `<g filter="url(#grain)"><path d="${d}" fill="none" stroke="${C.goldD}" stroke-width="${w}" stroke-linecap="butt"/>
    <path d="${d}" fill="none" stroke="${C.gold}" stroke-width="${w - 3}" stroke-linecap="butt"/>
    <path d="${d}" fill="none" stroke="${C.ink}" stroke-opacity=".78" stroke-width="${w * .42}" stroke-dasharray="${w * .42} ${w * .34}"/></g>`;
  const leaf = (x, y, r, col) => `<path transform="translate(${x} ${y}) rotate(${r})" d="M0 0 C5 -5 14 -5 19 0 C14 5 5 5 0 0Z" fill="${col}"/>`;
  const laurel = (cx, cy, R, col) => { let o = ''; for (let i = 0; i < 7; i++) { const deg = -55 + i * 19, a = deg * Math.PI / 180;
      const x = R * Math.cos(a), y = -R * Math.sin(a), t = Math.atan2(-Math.cos(a), -Math.sin(a)) * 180 / Math.PI - 28; o += leaf(x, y, t, col); }
    return `<g filter="url(#grain)"><g transform="translate(${cx} ${cy})">${o}</g><g transform="translate(${cx} ${cy}) scale(-1 1)">${o}</g></g>`; };

  const ART = {
    // Two cards with a short film connector: empty trades.
    trade: { vb: '0 0 240 130', svg: () => ribbon('M66 84 C96 40 142 104 176 52', 24) + card(62, 66, -13, 'blue') + card(180, 64, 12, 'burg') },
    // A small stack with a heart bookmark: empty wishlist.
    wishlist: { vb: '0 0 240 130', svg: () => card(92, 66, -14, 'burg') + card(150, 68, 13, 'gold') + card(120, 64, -2, 'blue', 68, 96) +
      `<g filter="url(#lift)"><g filter="url(#grain)"><path d="M141 6 h13 v30 l-6.5 -6 l-6.500 6z" fill="${C.gold}"/><path transform="translate(147.500 44)" d="M0 12 C-16 0 -11 -12 -4 -11 C-1.500 -11 0 -8.500 0 -7 C0 -8.500 1.500 -11 4 -11 C11 -12 16 0 0 12Z" fill="${C.burg}"/></g></g>` },
    // A movie card with a paper bid slip and a coin: empty bids. No gavel: bids resolve on a schedule.
    bids: { vb: '0 0 240 130', svg: () => card(96, 64, -9, 'dusk') +
      `<g transform="translate(160 70) rotate(8)" filter="url(#lift)"><g filter="url(#grain)"><path d="M-30 -36 L30 -35 L29 36 L-29 35Z" fill="${C.ivory}"/>
        <rect x="-21" y="-25" width="26" height="5" rx="2.500" fill="${C.ivoryD}"/><rect x="-21" y="-13" width="42" height="4" rx="2" fill="${C.ivoryD}"/><rect x="-21" y="-4" width="34" height="4" rx="2" fill="${C.ivoryD}"/>
        <rect x="-21" y="12" width="42" height="14" rx="7" fill="${C.burg}"/></g></g>
       <g transform="translate(196 34)" filter="url(#lift)"><g filter="url(#grain)"><circle r="15" fill="${C.goldD}"/><circle r="12" fill="${C.gold}"/><path d="M0 -7 V7 M4 -4 C2 -6.500 -4.500 -6 -4.500 -2.500 C-4.500 1 4.500 -1 4.500 3 C4.500 6 -2 6.500 -4.500 4" fill="none" stroke="${C.goldD}" stroke-width="2.200" stroke-linecap="round"/></g></g>` },
    // A quiet marquee: empty notifications.
    marquee: { vb: '0 0 240 130', svg: () => { let bulbs = ''; for (let i = 0; i < 9; i++) bulbs += `<circle cx="${56 + i * 16}" cy="38" r="3" fill="${i % 3 === 1 ? C.gold : C.ivoryD}" opacity="${i % 3 === 1 ? 1 : .55}"/><circle cx="${56 + i * 16}" cy="100" r="3" fill="${C.ivoryD}" opacity=".55"/>`;
      return `<g filter="url(#lift)"><g filter="url(#grain)"><path d="M40 30 L200 28 L202 110 L38 108Z" fill="${C.burgD}"/><path d="M52 48 L188 47 L189 91 L51 92Z" fill="${C.ivory}"/>
        <rect x="66" y="58" width="74" height="6" rx="3" fill="${C.ivoryD}"/><rect x="66" y="72" width="108" height="5" rx="2.500" fill="${C.ivoryD}"/>${bulbs}
        <path d="M96 28 C96 8 144 8 144 28Z" fill="${C.burg}"/><circle cx="120" cy="19" r="5" fill="${C.gold}"/></g></g>`; } },
    // Seats and a ticket: draft waiting room.
    seats: { vb: '0 0 240 130', svg: () => { let s = ''; for (let i = 0; i < 3; i++) { const x = 52 + i * 46; s += `<path d="M${x} 58 q0 -18 18 -18 q18 0 18 18 v34 h-36z" fill="${C.burg}"/><rect x="${x - 4}" y="88" width="44" height="18" rx="6" fill="${C.burgD}"/><rect x="${x - 7}" y="70" width="8" height="34" rx="4" fill="${C.char}"/>`; }
      return `<g filter="url(#lift)"><g filter="url(#grain)">${s}<rect x="183" y="70" width="8" height="34" rx="4" fill="${C.char}"/></g></g>
        <g transform="translate(176 42) rotate(14)" filter="url(#lift)"><g filter="url(#grain)"><path d="M-30 -15 H30 V-5 a5 5 0 0 0 0 10 V15 H-30 V5 a5 5 0 0 0 0 -10Z" fill="${C.gold}"/><path d="M12 -15 V15" stroke="${C.goldD}" stroke-width="1.500" stroke-dasharray="3 3"/><rect x="-22" y="-6" width="26" height="4" rx="2" fill="${C.goldD}"/><rect x="-22" y="3" width="18" height="4" rx="2" fill="${C.goldD}"/></g></g>`; } },
    // Laurel around a winning card: season champion.
    champion: { vb: '0 0 240 150', svg: () => laurel(120, 82, 64, C.gold) + card(120, 84, -4, 'gold', 60, 84) +
      `<g filter="url(#lift)"><g filter="url(#grain)"><path transform="translate(120 22)" d="M-15 9 L-17 -7 L-8 0 L0 -11 L8 0 L17 -7 L15 9Z" fill="${C.ivory}"/></g></g>` },
    // The cinema entrance: welcome and "no leagues yet". Full storybook, used once.
    cinema: { vb: '0 0 360 300', svg: () => { let bulbs = ''; for (let i = 0; i < 11; i++) bulbs += `<circle cx="${100 + i * 16}" cy="96" r="3" fill="${C.gold}"/>`;
      return `<ellipse cx="180" cy="210" rx="170" ry="120" fill="url(#warm)" opacity=".28"/>
        <g filter="url(#grain)">
          <path d="M40 286 L42 112 L318 110 L320 286Z" fill="${C.charL}"/>
          <path d="M70 112 C70 30 290 30 290 112Z" fill="${C.char}"/>
          <path d="M84 60 L276 58 L278 104 L82 106Z" fill="${C.burgD}"/><path d="M94 68 L266 67 L267 88 L93 89Z" fill="${C.ivory}"/>
          <rect x="112" y="74" width="92" height="8" rx="4" fill="${C.ivoryD}"/><rect x="212" y="74" width="36" height="8" rx="4" fill="${C.ivoryD}"/>${bulbs}
          <path d="M126 286 L128 142 L232 142 L234 286Z" fill="#f0c865"/>
          <path d="M126 286 L128 142 L100 150 L98 286Z" fill="${C.burg}"/><path d="M234 286 L232 142 L260 150 L262 286Z" fill="${C.burg}"/>
          <ellipse cx="113" cy="200" rx="6" ry="16" fill="${C.gold}" opacity=".85"/><ellipse cx="247" cy="200" rx="6" ry="16" fill="${C.gold}" opacity=".85"/>
          <g fill="${C.ink}" opacity=".88"><circle cx="160" cy="212" r="9"/><path d="M147 286 q0 -60 13 -60 q13 0 13 60Z"/><circle cx="184" cy="218" r="8.500"/><path d="M172 286 q0 -54 12 -54 q12 0 12 54Z"/><circle cx="206" cy="210" r="9"/><path d="M193 286 q0 -62 13 -62 q13 0 13 62Z"/></g>
          <path d="M112 300 L126 286 L234 286 L252 300Z" fill="#f0c865" opacity=".5"/>
          <circle cx="76" cy="150" r="9" fill="#f3e6c4"/><rect x="74" y="158" width="4" height="14" fill="${C.ink}"/><circle cx="284" cy="150" r="9" fill="#f3e6c4"/><rect x="282" y="158" width="4" height="14" fill="${C.ink}"/>
        </g>` + card(72, 228, -3, 'blue', 40, 58) + card(290, 228, 3, 'burg', 40, 58) + ribbon('M0 292 C80 262 120 300 180 290 C250 278 300 300 360 276', 16); } },
  };
  for (const el of document.querySelectorAll('[data-art]')) {
    const a = ART[el.dataset.art]; if (!a) continue;
    el.style.display = el.style.display || 'block';
    el.innerHTML = `<svg viewBox="${a.vb}" width="100%" style="display:block;overflow:visible">${a.svg().replace(/(\d)\.(\d)00\b/g, '$1.$2')}</svg>`;
  }
})();
