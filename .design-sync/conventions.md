# Fantasy Reel — Cinematic Dark

A fantasy-sports app for movies: you draft upcoming releases and score on their
Rotten Tomatoes Tomatometer. The look is premium streaming service meets awards
show — a near-black canvas, gold as the single accent, muted burgundy for
danger, and a display face for anything that acts as a title.

## The canvas is dark, and it is not optional

Every component is drawn to sit on `background` (`#0f0f0f`). `styles.css` sets
`html body` to that background and `foreground` text, so a page that loads it
starts correct. **Do not put these components on a light surface** — the
borders, the gold, and the muted text are all tuned for dark, and they wash out
on white.

Depth is four flat steps, not shadows: `background` (page) → `surface` (cards)
→ `surface-hover` → `elevated` (inputs, wells). Reach for the next step up
rather than a border when you need separation.

## Styling idiom: Tailwind utilities over semantic tokens

This is a Tailwind v4 design system. There are **no CSS-in-JS props and no
style objects** — you style with utility classes, and the palette is exposed as
named tokens rather than raw scales. Write `bg-surface`, never `bg-[#1c1c1c]`
and never `bg-zinc-900`.

Every token below is real and generates `bg-*`, `text-*`, and `border-*`
utilities:

| Family | Tokens |
|---|---|
| Surfaces | `background`, `surface`, `surface-hover`, `elevated` |
| Accent | `gold`, `gold-hover`, `gold-muted`, `crimson`, `crimson-hover` |
| Text | `foreground`, `foreground-secondary`, `foreground-muted`, `foreground-inverse` |
| Borders | `border`, `border-hover` |
| League status | `status-setup`, `status-drafting`, `status-active`, `status-completed`, each with a `-bg` pair |
| Feedback | `success`, `error`, `warning`, `info`, each with a `-bg` pair |

Typography is three families: `font-display` (Montserrat — every heading and
any title-like label), `font-body` (DM Sans — the default, already on `body`),
`font-mono`. **Headings need `font-display` explicitly**; it is not applied by
element type.

Motion: `animate-fade-in` for content arriving, `animate-slide-up` for panels,
`animate-glow-pulse` for a "your turn" state, `animate-shimmer` for skeletons.

## Compose from the component classes before writing utilities

`styles.css` ships finished component classes. Use them instead of
re-deriving the same look from utilities — they are what keeps screens
consistent:

- **Cards** — `.card`, and `.card-interactive` when the whole card is a link or
  button (adds lift, gold border and glow on hover).
- **Buttons** — `.btn` plus one of `.btn-primary` (gold, the page's single main
  action), `.btn-secondary` (gold outline), `.btn-danger` (crimson),
  `.btn-ghost` (quiet/cancel). **`.btn` sets no gap** — add `gap-2` yourself
  when the button holds an icon and a label.
- **Inputs** — `.input` (elevated fill, gold focus ring).
- **Badges** — `.badge` plus `.badge-setup` / `.badge-drafting` /
  `.badge-active` / `.badge-completed` for league phase.
- **Alerts** — `.alert` plus `.alert-error` / `.alert-success` /
  `.alert-warning` / `.alert-info`.
- **Overlays** — `.modal-overlay` (dark blurred backdrop), `.glass`.
- **Loading** — `.skeleton` for shimmer placeholders.

## Colour carries meaning — don't decorate with it

Gold is the interactive colour and the "earning points" colour. Crimson is
destructive *and* "losing points". That double duty is deliberate: in this
product a bad movie and a dangerous button are both things you don't want.
`TomatometerScore` and `MovieTimelineCard` encode it — 60% is both Rotten
Tomatoes' Fresh line and the scoring baseline, so gold means above it and
crimson means below. Keep that mapping; don't use gold for a neutral chip or
crimson for emphasis.

## Building with the library

Import components from the global namespace; style your own layout glue with
the utilities above.

```jsx
<div className="max-w-2xl p-6 rounded-lg bg-surface border border-border">
  <h2 className="font-display font-semibold text-foreground mb-1">Your team</h2>
  <p className="text-sm text-foreground-muted mb-4">3 movies drafted</p>

  <div className="flex items-center gap-3 mb-4">
    <Avatar name="Carol Coppola" src={null} size="md" />
    <TomatometerScore score={92} />
  </div>

  <button className="btn btn-primary gap-2">Place a bid</button>
</div>
```

Two things worth knowing before you compose:

- **Modals render their own full-screen overlay** (`position: fixed`) — mount
  them at the top of a screen, don't nest them inside a sized container.
- **A few components need real data shapes**, not strings — `TradeOfferCard`,
  `BidCard`, `MovieTimelineCard` and friends take the app's own record types.
  Read the component's `.d.ts` for the exact shape and its `.prompt.md` for a
  worked example before inventing props.

## Where the truth is

Read these rather than guessing: `_ds/<folder>/styles.css` and the files it
imports (all tokens and component classes, with real values), and
`components/<group>/<Name>/<Name>.d.ts` plus `<Name>.prompt.md` per component.
Components are grouped as **foundation, feedback, movies, league, modals,
identity, landing, settings** — that grouping is a good map of the product.
