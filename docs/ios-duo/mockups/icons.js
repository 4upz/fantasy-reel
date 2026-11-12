// Tiny stroke icon set for the mockups. Usage: <i data-i="home"></i>
const P = {
  home: '<path d="M3 10.500 12 3l9 7.500V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  roster: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  bids: '<circle cx="12" cy="12" r="9"/><path d="M15 9.300c-.5-.9-1.600-1.400-3-1.400-1.700 0-3 .8-3 2 0 1.300 1.200 1.700 3 2s3 .8 3 2.100c0 1.200-1.300 2-3 2-1.400 0-2.500-.5-3-1.400M12 6v12"/>',
  trades: '<path d="M4 8h15l-3.500-3.500M20 16H5l3.500 3.500"/>',
  standings: '<path d="M8 21h8M12 16.500V21M7 4h10v5.500a5 5 0 0 1-10 0zM7 6H4v1.500A3 3 0 0 0 7 10.500M17 6h3v1.500a3 3 0 0 1-3 3"/>',
  draft: '<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bell: '<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15zM10 20.500a2 2 0 0 0 4 0"/>',
  more: '<circle cx="5.500" cy="12" r="1.600" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.600" fill="currentColor" stroke="none"/><circle cx="18.500" cy="12" r="1.600" fill="currentColor" stroke="none"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
  updown: '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
  pencil: '<path d="m4 20 1-4.500L16 4.500l3.500 3.500L8.500 19z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  filter: '<circle cx="12" cy="12" r="9"/><path d="M7.500 9.500h9M9 12.500h6M10.500 15.500h3"/>',
  heart: '<path d="M12 20s-7.500-4.600-7.500-10.200A4.200 4.200 0 0 1 12 7.500a4.200 4.200 0 0 1 7.500 2.300C19.500 15.400 12 20 12 20z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 20.500c.8-4 3.800-6 8-6s7.200 2 8 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.700 2.200c-.8.500-1.200 1-1.200 1.800M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tag: '<path d="M3.500 12.500V4.500h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.200" fill="currentColor" stroke="none"/>',
  star: '<path d="m12 3.500 2.600 5.400 5.900.8-4.300 4.100 1 5.900L12 16.900 6.800 19.700l1-5.900L3.500 9.700l5.900-.8z"/>',
  sidebar: '<rect x="3" y="4.500" width="18" height="15" rx="3"/><path d="M9 4.500v15"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  calendar: '<rect x="3.500" y="5" width="17" height="15.500" rx="2.500"/><path d="M3.500 10h17M8 3v4M16 3v4"/>',
  book: '<path d="M4 5.500A2.500 2.500 0 0 1 6.500 3H20v15H6.500A2.500 2.500 0 0 0 4 20.500zM4 20.500A2.500 2.500 0 0 0 6.500 21H20"/>',
};
for (const el of document.querySelectorAll('i[data-i]')) {
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.900" stroke-linecap="round" stroke-linejoin="round">${(P[el.dataset.i] || '').replace(/(\d)\.(\d)00\b/g,'$1.$2')}</svg>`;
}
