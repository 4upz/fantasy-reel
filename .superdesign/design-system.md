# Fantasy Reel design system — Cinematic Dark

A lively independent cinema with a competitive streak: charcoal surfaces,
matte gold branding, expressive headings, and calm, readable gameplay.

## Sources of truth

- [Typography guide](../docs/brand/typography.md): active role scale, family
  settings, number formatting, and accessibility rules.
- [App typography](../apps/frontend/app/typography.css): the shared `type-*`
  implementation. Import this through the app's global stylesheet; do not
  recreate the scale in a preset.
- [Global styles](../apps/frontend/app/globals.css): semantic colors, surfaces,
  component classes, motion, and focus treatment.
- [Brand package](../docs/brand/README.md): approved vector logos and browser/
  mobile assets. [Interactive specimen](../docs/brand/preview.html).

## Typography and identity

- Bricolage Grotesque: `type-hero`, `type-page`, `type-section`, `type-panel`,
  and `type-card`. Choose by content role, not heading tag.
- DM Sans: `type-lead`, `type-body`, `type-body-sm`, `type-row-title`,
  `type-control`, `type-input`, `type-label`, and `type-meta`. Dense movie and
  team names stay DM Sans even when marked up as headings.
- Bricolage numeric roles: `type-number` and `type-number-lg` use weight 700,
  optical size 12, width 100, and tabular lining digits. `type-numeric` adds
  that numeral treatment while preserving an existing size and weight.
  The bundled DM Sans does not support `tnum`.
- Use the local Bricolage/DM Sans WOFF2 files in `apps/frontend/app/fonts/`;
  keep `font-mono` as a system stack for join codes and diagnostics.
- Functional metadata is at least 12px; form inputs are 16px. Use sentence
  case for labels and controls. Let content wrap before reducing type.
- Use the approved gold film-conversation mark with its outlined soft-white
  wordmark. Preserve the lockup; do not reset the letters or draw a new reel.

## Color and surfaces

Use semantic tokens from `globals.css`, never raw colors or Tailwind gray
scales. The palette remains charcoal (`background`, `surface`, `surface-hover`,
`elevated`), gold accents, soft-white foreground, and warm secondary text.
Crimson retains its destructive/negative-score meaning. Status and feedback
colors remain available for their existing semantics.

Meaningful small text on cards or inputs uses `foreground-secondary`:
`foreground-muted` does not meet normal-text contrast on `surface` or
`elevated`. Keep gold for actions, selected states, branding, and meaningful
score emphasis.

## Components and layout

Reuse `.card`, `.btn` with its variants, `.input`, `.badge-*`, `.alert-*`,
`.modal-overlay`, and `.glass`. Controls use DM Sans, including `.cta-button`.
Use left alignment during play; centered marketing/auth/recovery panels are
intentional exceptions. Keep reading measures comfortable and dense rows
aligned; do not add poster-scale headings to draft or standings rows.

Use existing motion for meaningful state changes. Respect reduced motion,
keyboard focus, long movie/team names, and mobile navigation constraints.
Keep the route/global error boundaries aligned in scale and colors while
preserving the global boundary's independent system-font fallback.
