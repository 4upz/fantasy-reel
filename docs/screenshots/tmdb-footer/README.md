# TMDB attribution footer comparison

Captured on September 11, 2026 with the local development server, seeded Alice
account, and the same data and viewport for each before/after pair.

- Before: main at `d28b1b2`, with the original authenticated layout.
- After: `1d57ba1`, with the authenticated layout using a viewport-height flex
  column and an expanding main content area.

| Page | Viewport | Before | After |
| --- | --- | --- | --- |
| Dashboard | 1440 × 1000 | [Before](dashboard-desktop-before.jpg) | [After](dashboard-desktop-after.jpg) |
| Empty wishlist | 390 × 844 | [Before](wishlist-mobile-before.jpg) | [After](wishlist-mobile-after.jpg) |

The dashboard footer previously ended about 307px above the viewport bottom;
the empty mobile wishlist footer ended about 133px above it. Both after captures
place the footer's bottom edge at the viewport bottom. Longer pages retain normal
document scrolling, with the footer following the content.

The small Next.js development indicator is part of the local development server.
