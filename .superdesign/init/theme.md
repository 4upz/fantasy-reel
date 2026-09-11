# Theme - Cinematic Dark Design System

## Typography and brand

Read [the canonical typography guide](../../docs/brand/typography.md) and
[brand package](../../docs/brand/README.md). Role values live in
[app/typography.css](../../apps/frontend/app/typography.css), imported by
[globals.css](../../apps/frontend/app/globals.css).

- `font-display`: local Bricolage Grotesque; use display `type-*` roles for
  expressive headings, not every h1–h3 element.
- `font-body`: local DM Sans for prose, controls, compact movie/team names,
  and metadata.
- `type-number`, `type-number-lg`: Bricolage 700, optical size 12, width 100,
  tabular lining digits. `type-numeric` preserves an existing size/weight.
- `font-mono`: system monospace for join codes and diagnostics.
- Local WOFF2 sources: `apps/frontend/app/fonts/bricolage.woff2` and
  `apps/frontend/app/fonts/dm-sans.woff2`.
- Functional metadata stays at least 12px. Meaningful small text on cards or
  inputs uses `foreground-secondary`; preserve sentence-case labels.
- Reuse the approved film-conversation SVG logo and charcoal browser/mobile
  icons in `apps/frontend/public/brand/v1/`.

## Colors
### Backgrounds
- `background`: #0f0f0f
- `surface`: #1c1c1c
- `surface-hover`: #262626
- `elevated`: #2a2a2a

### Accent
- `gold`: #c9a227
- `gold-hover`: #d4b23a
- `gold-muted`: oklch(0.55 0.12 85 / 0.15)
- `crimson`: #a8505c
- `crimson-hover`: #b85c68

### Text
- `foreground`: #e8e8e8
- `foreground-secondary`: #b8b0a4
- `foreground-muted`: #8a8078
- `foreground-inverse`: #0f0f0f

### Borders
- `border`: #2e2e2e
- `border-hover`: #404040

### Status
- `status-setup` / `status-setup-bg`: Blue
- `status-drafting` / `status-drafting-bg`: Yellow
- `status-active` / `status-active-bg`: Green
- `status-completed` / `status-completed-bg`: Gray

### Feedback
- `success` / `success-bg`: Green
- `error` / `error-bg`: Red
- `warning` / `warning-bg`: Orange
- `info` / `info-bg`: Blue

## Shadows
- `shadow-soft`: 0 2px 8px rgba(0,0,0,0.4)
- `shadow-medium`: 0 4px 12px rgba(0,0,0,0.5)
- `shadow-heavy`: 0 8px 24px rgba(0,0,0,0.6)
- `shadow-glow-gold`: 0 0 20px oklch(0.65 0.15 85 / 0.4)
- `shadow-glow-crimson`: 0 0 20px oklch(0.45 0.15 5 / 0.35)

## Animations
- `animate-fade-in`: fade-in 0.3s ease-out
- `animate-slide-up`: slide-up 0.3s ease-out
- `animate-glow-pulse`: glow-pulse 2s ease-in-out infinite
- `animate-shimmer`: shimmer 1.5s ease-in-out infinite

## Component Classes
- `.card` / `.card-interactive` — Cards
- `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.btn-ghost` — Buttons
- `.input` — Form inputs
- `.badge` / `.badge-setup` / `.badge-drafting` / `.badge-active` / `.badge-completed` — Status badges
- `.alert` / `.alert-error` / `.alert-success` / `.alert-warning` / `.alert-info` — Alerts
- `.glass` / `.modal-overlay` / `.modal-panel` — Overlays
- `.cta-button` / `.cta-panel` — Landing page CTAs
- `.feature-card` / `.value-prop` — Landing page feature sections
- `.hero-gradient` / `.film-grain` / `.spotlight-glow` — Hero effects
- `.ticker-*` — Draft ticker marquee
- `.scoring-*` — Scoring reveal cards
- `.showcase-*` — Movie carousel
- `.ui-preview-*` — UI preview section
