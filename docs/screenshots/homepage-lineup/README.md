# Homepage movie lineup screenshots

Captured September 14, 2026 from the PR branch using a fresh local development
server. These screenshots show the arranged posters with inset critic scores,
combined with the current homepage spotlights and section navigation.

| Screenshot | Viewport | State |
| --- | --- | --- |
| [Desktop, dark](desktop-dark.png) | 1280 × 900 | Default Project Hail Mary selection |
| [Mobile, dark](mobile-dark.png) | 390 × 844 | Default Project Hail Mary selection |
| [Mobile, light](mobile-light.png) | 390 × 844 | Default Project Hail Mary selection |

The posters use real 2026 releases and fixed Rotten Tomatoes score snapshots
verified September 14, 2026. Source links are recorded in
`apps/frontend/app/components/landing/example-movies.ts`.

Manual checks also covered a 1280 × 720 desktop viewport, a 320 × 844 mobile
viewport, poster selection by pointer and keyboard, caption source links,
image loading, horizontal overflow, and the “See how it works” section link.
