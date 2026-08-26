# design-sync notes — Fantasy Reel

Repo-specific gotchas for future syncs. Read this before re-running the sync.

## Shape: this repo is an app, not a component package

There is no `dist/` and no published package, so the converter runs in
`--entry` mode against a **hand-maintained barrel**, `.design-sync/entry.tsx`.
It re-exports the app's real shipped components under stable names. Adding or
removing a design-system component means editing **two** files:

1. `.design-sync/entry.tsx` — the export (most app components are
   `export default`, so they need `export { default as X } from '…'`).
2. `.design-sync/config.json` → `componentSrcMap` — the name → src path pin.

Scope is deliberately presentational. Page-level containers that own data
fetching and routing (DraftBoard, LeagueManager, DashboardClient, SideNav,
ProfileMenu, MoviePicker, the settings form sections) are **excluded** — they
are app wiring, not design-system parts.

## Root `package.json` carries a `types` field for this sync

`"types": ".design-sync/entry.tsx"` was added to the **root** package.json.
The converter's type extractor resolves its entry from that field; without it
it looks for `<root>/index.d.ts`, finds nothing, and every emitted
`<Name>.d.ts` comes out with an empty props body. The root package is
`private: true` and never published, so the field is inert everywhere else.
**Do not delete it.**

## Component grouping comes from doc frontmatter, not directories

`cfg.srcDir` is deliberately **unset**. The converter derives a component's
group from its source directory, and these components live under
`app/(authenticated)/league/[id]/components/` — which derives the group name
`id`. Doc `category:` frontmatter only overrides a group that came out as
`general`, so the only way to get intentional group names is to let directory
derivation find nothing at all.

With `srcDir` unset there is no `src/` root, every component starts as
`general`, and `.design-sync/docs/<Name>.md` frontmatter sets the real group.
**Every component therefore needs a `.design-sync/docs/<Name>.md` with a
`category:` line** — a new component without one lands in `general`.

Groups in use: Foundation, Feedback, Movies, League, Modals, Identity,
Landing, Settings.

Side effect: no `srcPath`, so no JSDoc enrichment and no sibling-doc
discovery. The docs files are the sole source of prose — which is why they
are worth keeping good.

## Framework host shims (`.design-sync/shims/`)

The design renderer has no Next.js router, no image optimizer, and no Supabase
project. `.design-sync/tsconfig.build.json` aliases those hosts to inert
shims so components render statically:

| Aliased | Shim | Why |
|---|---|---|
| `next/link` | `<a>` | real Link needs AppRouterContext |
| `next/image` | `<img>` (honours `fill`) | real Image needs the optimizer endpoint + build config |
| `next/navigation` | no-op router | nothing to navigate to |
| `@/utils/supabase/client` | inert client, chainable, resolves empty | no project, no session |
| `@/utils/supabase/functions` | `callEdgeFunction` → `{data:null,error:null}` | write actions no-op instead of throwing |

These replace the **host**, never a component — every component in the bundle
is the app's real shipped code.

**Ordering matters in that tsconfig**: the resolver takes the first matching
rule, so every exact alias must precede the `@/*` wildcard. `@/types` also
needs an exact entry — it resolves to a *directory*, and the resolver's
extension list tries the bare path first and would return the directory.

## Tailwind: compile before every bundle build

`cssEntry` is a **compiled** artifact (`.design-sync/.cache/styles.css`), not a
source file. `cfg.buildCmd` is the Tailwind CLI invocation. Run it **before**
`package-build.mjs` — `package-build` only copies the CSS, and
`preview-rebuild.mjs` does not touch it at all. Symptom of forgetting: cards
render with correct markup but missing utilities.

### Preview utility classes need pre-warming

Tailwind emits only the utilities it finds by scanning source. A preview that
uses a utility appearing nowhere else in the app compiles to nothing and the
card renders unstyled — and because the CSS compile happens before authoring
(and before parallel waves add more), this bites constantly.

`.design-sync/preview-vocab.html` is a safelist of the layout vocabulary
previews are allowed to use; it is a `@source` in `tailwind-entry.css`.
**Preview authors: stick to that vocabulary plus classes that already appear
in the app's own components.** Extend the vocab file rather than inventing.

### The dark canvas has to be re-asserted unlayered

Cinematic Dark is a dark-canvas system, but `globals.css` sets the body
background inside `@layer base` — and any unlayered `body { background: #fff }`
in a host page beats a layered rule regardless of order. The preview harness
has exactly such a rule, and a design canvas can too.

`tailwind-entry.css` therefore re-asserts the same tokens unlayered at
`html body` specificity. Without it every card renders dark-on-white. Same
values as `globals.css` — no new design decision.

## `cfg.provider` is WishlistProvider — and it is load-bearing

`useWishlist` throws `must be used within a WishlistProvider`. Any component
that renders `WishlistToggle` (DraftMovieCard, MovieQuickPreview) therefore
renders **nothing** without it, and the failure is easy to misread: in
DraftMovieCard the toggle is behind `{!isDrafted && …}`, so the *drafted* cell
renders fine and only the available ones go blank.

`WishlistProvider` is exported from `entry.tsx` purely so `cfg.provider` can
reach it, and excluded from the component list with
`componentSrcMap: {"WishlistProvider": null}` — bundle export, not a card. It
is the only React context in the app, so it is the only provider needed.

## Authoring previews: three traps worth knowing

1. **`position: fixed` roots collapse the mount to zero height.** Modals root
   at `fixed inset-0`, which is out of flow, so the preview captures an empty
   box. Wrap the modal in a stage with an explicit size and a `transform`
   (`translateZ(0)`) — a transformed ancestor becomes the containing block for
   fixed descendants. `MovieDetailModal.tsx` has the canonical `Stage` helper;
   copy it for other overlays.
2. **The screenshot harness pins the browser clock to 2024-05-15**
   (`page.clock.setFixedTime` in `package-capture.mjs`), but the live design
   pane runs on the real clock. Anything rendering a countdown or a
   relative date must build its dates from `Date.now()` at render time, or it
   will be right in exactly one of the two places. See the `daysOut()` helper
   in `MovieTimelineCard.tsx`.
3. **A flex-row component in a block parent stretches to full width.** Give
   solo cells a `flex items-start` wrapper so the component hugs its content
   (ConnectionStatusIndicator).

## Card layout overrides, and why they differ

`cfg.config.json` is validated **strictly** — unknown keys, including
`_comment`-style annotations, fail the run outright. Keep notes here instead.

`[GRID_OVERFLOW]` distinguishes two problems and they take different fixes:

- **"positions content outside their cells (fixed/portal)"** → `cardMode:
  "single"` with a `primaryStory`. Every modal hits this: they root at
  `position: fixed`, so no grid layout can contain them.
- **"render wider than their grid cells"** → `cardMode: "column"`. This is
  merely a too-wide story (NavLogo's nav bar, TeamHeader's full-width card,
  MovieTimelineCard's three-across row).

Applying `column` to a modal does **not** fix it — that was the first attempt
here, and validate re-flagged all six.

## Environment setup on a fresh clone

- `npm ci` at the repo root.
- **Symlink React types into the root `node_modules`**: they only exist at
  `apps/frontend/node_modules/@types/react`, and the type extractor looks
  upward from the repo root. Without them React utility types resolve to
  `any` and inherited props drop out of every emitted `.d.ts`
  (`[DTS_REACT]`).
  ```sh
  ln -sfn ../../apps/frontend/node_modules/@types/react     node_modules/@types/react
  ln -sfn ../../apps/frontend/node_modules/@types/react-dom node_modules/@types/react-dom
  ```
- Install the Tailwind CLI alongside the staged converter:
  `(cd .ds-sync && npm i @tailwindcss/cli)`.
- Chromium for the render check: `node_modules/.bin/playwright install chromium`
  (the repo pins playwright 1.58.1).

## Fonts are vendored, deliberately

The app loads Montserrat and DM Sans through `next/font/google`, which does not
exist outside Next. `.design-sync/fonts/` holds latin + latin-ext woff2 files
and a hand-written `brand-fonts.css`, wired via `cfg.extraFonts`, so rendered
designs get the real brand faces with no network dependency. Regenerate only
if the brand faces change.

## Deliberately excluded: TMDbAttribution

`TMDbAttribution` is a real, shipped component and is legally required wherever
TMDb data is shown — but it is **not** in this sync. Its logo is
`<Image src="/images/tmdb-logo.svg">`, a root-absolute path into the app's
`public/` directory. Nothing in `public/` is part of a component bundle, and
the design project has no `/images/` route, so the mark resolves to a broken
image — in the preview card *and* in every design the agent builds with it.
The disclaimer text renders fine; the logo does not.

**To bring it back**, a future sync needs to serve that path: add `images/**`
to the upload plan's `writes` (and `deletes`), copy
`apps/frontend/public/images/tmdb-logo.svg` to `ds-bundle/images/`, then
re-add the export to `entry.tsx` and the `componentSrcMap` pin. That is a
plan change, so it needs a fresh `finalize_plan` approval — which is why it
was not done mid-run.

## `guidelinesGlob` is intentionally empty

The default glob picked up `docs/*.md` — deployment runbooks, E2E test plans,
and a QA bug report. Those are developer docs, not design guidance, and they
would have shipped into the design agent's context. Design guidance belongs in
`.design-sync/conventions.md` (the `readmeHeader`).

## Known render warns (triaged, expected)

These fire on every run and are **not** regressions:

- `[RENDER_THIN] DiscordIcon`, `GoogleIcon` — brand glyphs are pure SVG with no
  text; "no text and paints nothing" is a false positive on an icon. Verified
  visually in the review sheet.
- `[RENDER_THIN] SectionHeader` — a title-only primitive; with default props
  its entire content legitimately is its own name.
- `[RENDER_BLANK] DraftTicker` — a marquee whose content is animated in; a
  static screenshot catches it mid-transform.

A warn **not** in this list is new — look at it before recording it.

## The drift check (CI)

`.github/workflows/design-sync-drift.yml` runs `.design-sync/check-drift.mjs`
on every PR and push to main. Dependency-free, so it needs no install step.

It **cannot** tell you whether the design project is current — that state is in
the uploaded `_ds_sync.json`, not in git, and a correct re-sync after a markup
change commits nothing. Anything built on "did `.design-sync/` change?" would
be a false signal. What it does catch:

| Check | Severity | Why |
|---|---|---|
| `componentSrcMap` pin points at a missing file | **fails** | the sync build dies on this |
| Component in a synced dir, in neither barrel nor ignore list | **fails** | the *silent* failure — it would just never reach the design system |
| Synced sources touched in this PR | notice only | re-sync reminder |

`.design-sync/drift-ignore.txt` holds the deliberate exclusions (page-level
containers, the `Icons.tsx` set, settings form sections, TMDbAttribution,
SiteFooter). **A new component fails the check until you either sync it or add
it to that file** — which is the whole point. Reseed the list from current
state with `node .design-sync/check-drift.mjs --write-ignore`.

Run it locally the same way CI does:

```sh
node .design-sync/check-drift.mjs --since origin/main
```

## Re-sync runbook

From the repo root, after the fresh-clone setup above:

```sh
# 1. stage the converter (a stale .ds-sync/ runs an old converter)
mkdir -p .ds-sync && cp -r "<skill-dir>"/{package-build.mjs,package-validate.mjs,package-capture.mjs,resync.mjs,lib,storybook} .ds-sync/
echo '{"name":"ds-sync-deps","private":true}' > .ds-sync/package.json
(cd .ds-sync && npm i esbuild ts-morph @types/react @tailwindcss/cli)

# 2. compile the stylesheet FIRST (cfg.buildCmd)
node .ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs \
  -i .design-sync/tailwind-entry.css -o .design-sync/.cache/styles.css

# 3. fetch the anchor, then run the driver
#    (get _ds_sync.json from the project → .design-sync/.cache/remote-sync.json)
node .ds-sync/resync.mjs --config .design-sync/config.json \
  --node-modules ./node_modules --out ./ds-bundle \
  --remote .design-sync/.cache/remote-sync.json
```

Project: `https://claude.ai/design/p/080ba501-b4a4-4a38-8830-c40adcbf5698`
(also pinned as `projectId` in config.json).

**Grades live in the gitignored `.design-sync/.cache/`, not in git.** Durable
carry-forward comes from the uploaded `_ds_sync.json`. On a fresh clone with
no anchor fetched, everything re-verifies — that is correct, not a bug.

Expect grades to clear whenever **preview-affecting config** changes:
adding `cfg.provider` and changing `cfg.overrides` mid-run invalidated 12
already-graded components here and they had to be re-read and re-graded. Make
global config decisions early.

## Re-sync risks

- **The barrel and `componentSrcMap` drift silently.** Neither is generated. A
  component renamed, moved, or deleted in the app breaks the build (loud); a
  component *added* to the app is simply absent from the sync (silent). Diff
  `entry.tsx` against the app's component dirs when picking up this sync.
- **Poster URLs in previews are remote** (`image.tmdb.org`, curated from the
  repo's own `FALLBACK_MOVIES` fixtures). They render today. If TMDb rotates
  those paths the cards degrade to empty poster boxes — recapture would catch
  it, a carried-forward grade would not.
- **The shims freeze an API shape.** If `callEdgeFunction`'s signature or the
  Supabase client surface changes, the shims still compile but no longer
  mirror the real thing. They are small; re-read them against the real modules.
- **Fixture data is inlined into previews**, not imported from `data.ts`.
  Intentional (previews must not depend on app internals), but it means fixture
  drift is invisible.
- **The root `package.json` `types` field** is the kind of thing a future
  cleanup deletes as dead config. It is load-bearing for this sync.
