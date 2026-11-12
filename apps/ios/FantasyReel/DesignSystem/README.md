# DesignSystem

Cinematic Dark for SwiftUI. The source of truth is the **v2** page of the
"Native iOS mockups" canvas; class names below are the mockups' CSS. Prefer
these components over one-offs; a new shared pattern belongs here (with a note
in the PR, since this folder is shared).

## Layout rules (design review)

- 16pt page margin (`FRMetrics.pageMargin`), 12pt between sections.
- Cards and row groups: 22pt continuous radius. **Never a card inside a card**;
  rows go in an `FRRowGroup`.
- Movie rows: 64pt minimum, 36×54 poster, one-line title, a fixed 64pt trailing
  points column. Rows grow with Dynamic Type; nothing clips.
- **One filled primary action per card** (`.frPrimary`); the rest secondary.
- A tab's main action ("Place Bid", "Propose Trade") goes in
  `bottomActionBar`, pinned above the tab bar, never in a floating button or
  the top bar. Keep it to the one or two actions the tab exists for and don't
  repeat it in the page; actions about one row stay on that row.
- Points are whole numbers with a sign: "+28", "−4" (U+2212), "0"; "Pending"
  when unscored; muted with "at release" before release.
- One sheet per multi-step task (pushes inside the sheet, never sheet on sheet).

## Which component for which mockup class

| Mockup | Component |
| --- | --- |
| `.card`, tinted alert card | `FRCard(tone:)`, `.frCardBackground(_:)` |
| `.hr` | `FRHairline` |
| `.grp` | `FRRowGroup(separatorInset:)` (64 default, 108 standings, 16 settings/forms). Bounded lists only (≤ ~30 rows); long or unbounded lists use `List` / `LazyVStack` |
| `.mrow` (movie) | `MovieRow` (points, custom trailing, or none) |
| `.mrow` (team, rank + avatar) | `ListRow(leading:trailing:)` |
| row `Button`/`NavigationLink` highlight | `.buttonStyle(.frRow)` |
| `.poster`, `.p36` | `PosterImage` / `PosterPlaceholder` |
| `.trail` | `PointsTrail` (points) / `TrailingValue` (totals, prices, RT) |
| `.pos` / `.negv` inline | `PointsText` |
| `.badge .b-*` | `StatusBadge(status:)`, `FRBadge(_:tone:)` |
| `.beta` | `BetaBadge` |
| `.cnt` | `CountBadge(count:style:size:)` |
| `.sh` | `SectionHeader` |
| `.hd` + `.lt` | `ScreenHeader`; a pushed screen that draws one sets its title with `.headerScreenTitle("Settings")` (kept for VoiceOver and the back menu, not shown in the bar) |
| `.foot` | `FRFootnote` (16pt inset, under a row group or form) |
| `.av`, `.ac1–4` | `Avatar(name:imageURL:size:corners:fill:)` |
| `.btn-p` / `.btn-s` / `.btn-d` / neutral | `.frPrimary` / `.frSecondary` / `.frDestructive` / `.frNeutral` |
| `.cap44`, `.pill44`, `.btn-sm` | `.fr(kind, size: .large / .medium / .compact, isLoading:)` |
| `.gbtn.glass` | `GlassIconButton` |
| `.gpill.glass` | `GlassPill`; its content alone is `GlassPillLabel` (used by the toolbar pill) |
| `.gbtn .cnt` (bell badge) | `.iconButtonBadge(count)` on the 44pt frame |
| `.gnav` league top bar | `.leagueTopBar()` (Navigation): pill, search when the tab bar is full, bell, `⋯` |
| tab action bar | `.bottomActionBar { … }` |
| adjacent glass controls | `GlassCluster` (`GlassEffectContainer`) |
| `.cols` + `.statv` | `StatColumns([StatItem])` |
| `.alert-i`, `.ai-*` | `InlineBanner(tone:title:message:)` |
| alert card with `.ibadge` + button below (V2LogIn) | `InlineBanner(…, iconStyle: .badge, actionPlacement: .below)` |
| `.pbtn` provider buttons | `ProviderSignInButton(provider:)` |
| `.ordiv` | `FROrDivider()` |
| `.gseg` | `FRSegmentedControl` |
| `.fgrp .field` | `FormFieldRow(label:labelWidth:)` (92pt label default) in `FRRowGroup(separatorInset: 16)` |
| reconnecting pill, offline dot (V2DraftOffline) | `ConnectionStatusBanner`, `ConnectionStatusIndicator` |
| load / empty / error states | `LoadState` + `LoadStateView`, `LoadingView`, `EmptyStateView`, `ErrorStateView` |
| empty state with art (I1–I7) | `EmptyStateView(title:message:illustration:)` (see "Motion and haptics") |
| Marquee illustrations (empty screens, champion) | `MarqueeArt(.trades)`; the seven pieces and where each goes are on `MarqueeIllustration`. Regenerate the art with `docs/marquee/generate.mjs` |

Native iOS 26 glass is used directly: `.glassEffect(.regular.interactive(), in:)`,
`GlassEffectContainer`, and `.buttonStyle(.glass)` / `.glassProminent` for
system-styled glass buttons. Don't imitate glass with materials. Toolbar items
in a `NavigationStack` already get glass from the system.

## Typography

`.frFont(_ role: FRTextRole)` applies the role's font, Dynamic Type scaling
(UIFontMetrics against the role's text style, live), Bold Text, and tracking.
Bricolage Grotesque for titles and numbers (`number*` roles: optical size 12,
width 100, tabular lining figures); DM Sans for body, rows, controls and
metadata. Both are variable fonts registered by `FRFonts.registerIfNeeded()`
(call at launch; lookups also call it lazily). If registration fails, roles fall
back to the system font. See `docs/brand/typography.md`.

`.overline` (DM Sans 600, 13, 0.05em) uppercases its text in the modifier, so
pass sentence case. `.rowLabel` (DM Sans 500, 16) is for plain menu/settings
row labels; `.rowTitle` (600) stays for movie and team titles.

## Images (N-09)

`RemoteImage` → `ImagePipeline.shared`: decoded images downsampled to display
size, an NSCache memory cache (48 MB), a 100 MB URLCache on disk, shared
in-flight requests, cancellation via `.task(id:)`. Poster/avatar URLs are public,
so the disk cache is not user-keyed. Never load a backdrop for a thumbnail;
`PosterImage` picks the smallest TMDb rendition for the display.
`RemoteImage` keeps no `UIImage` in view state: it reads the bitmap from the
memory cache each render and reloads after an eviction, so off-screen rows
don't pin images the cache has dropped.

## Motion and haptics

The plan and its reasons are in `docs/IOS-DELIGHT-PLAN.md` (sections 5.3, 5.4
and 8). Everything here works the same on an ordinary iPhone and on both iPhone
Duo screens; nothing in it depends on the device. Try it all in the Debug-only
`MotionFoundationsGallery` (preview, or the `motionFoundations` screenshot
scene), which also plays every haptic on a phone.

**Timings: `FRMotion` (`Tokens/FRMotion.swift`).** Never write a duration or
spring by hand. Pick a tier by what the animation is for:

| Tier | For | Length |
| --- | --- | --- |
| `.feedback` | Answering a tap: heart fill, amount step | 0.2 s |
| `.change` | A value or list updating: score rolls, rows reorder, a banner appears | 0.35 s |
| `.moment` | A celebration, played once: draft pick lands, champion reveal | 0.8 s |

`FRMotion.press` (a pressed button dimming) and `FRMotion.fade` (images fading
in) are the only other two.

**Reduce Motion is handled for you** if every animation goes through one of
these. Don't read `accessibilityReduceMotion` in a screen (moments aside, below).

| Use | For | With Reduce Motion |
| --- | --- | --- |
| `.frAnimation(.change, value: x)` | animating whatever changes with `x` | instant (moments: a cross-fade) |
| `frWithAnimation(.change) { … }` | state changed from an action | same |
| `.frTransition(.move(edge: .top))` | views that come and go | opacity instead of movement |
| `.frNumericTransition(value:)` | rolling digits (points, budget, rank) | digits swap |
| `FRArrival("id") { settled in … }` | something that animates in once (illustrations, M9) | drawn settled, no animation |

A moment (draft travel, champion sunburst) is the one place that may read
`accessibilityReduceMotion` itself: with it on, the moment drops its own
movement and cross-fades (`FRMotion.fade`) instead. Its PR includes one
screenshot with Reduce Motion on.

**Once per visit (`Components/FRArrival.swift`).** Arrivals and moments play
once, and never again on refresh, on returning to a tab, or on opening or
closing an iPhone Duo. `FRArrival` and `.frOnArrival(id) { }` (for a one-time
action like a haptic) remember what played in an `FRArrivalLog`. Without a
scope that log lasts as long as the app is running. Put `.frVisitScope()` on a
pushed screen or sheet that should replay its arrivals each time it is opened.
Ids name the arrival; add the league or season id when one screen can show
different ones. "First view ever" (the champion reveal) is a stored flag, not
this.

**Haptics: `FRHaptic` (`Tokens/FRHaptics.swift`).** One map, named by what
happened: `.frHaptic(.bidSubmitted, trigger: placedCount)`. Use a trigger
that changes once per action of yours, never one a refresh or another person
can change. `.frHaptic(trigger:) { old, new in … }` picks one per change (a
stepper ticking, then knocking at the limit). Haptics are for your own actions
only (the one exception: it becoming your turn in a live draft), never for
scrolling, opening screens, switching tabs or anything that fires for many
rows, and always paired with something visible. There is no in-app switch;
iOS's System Haptics setting turns them off. The three `.sensoryFeedback` calls
that predate this (draft pick, your turn, wishlist) move to `FRHaptic` when
their screens are next touched.

**Illustrations in empty states.** `EmptyStateView(title:message:illustration:)`
takes an asset image (it rises into place once) or a view built from parts:
`illustration: { settled in … }` draws the settled art when `settled` is true
and its arriving state (parts offset, faded) when false. The art is
`FRMetrics.illustrationWidth` (216 pt) wide on every iPhone, never stretched;
on a wide page it centers in its column, never across the Duo's fold. It is
hidden from VoiceOver. Only the empty screens in the plan's table get art;
errors and dead ends keep an icon. Check every piece in light and dark.

**Rules the reviewers check:**

- Never the only signal: an animated or haptic change is also shown as text or
  a label ("▲ 1", "Bid placed"). Status stays words plus color.
- Never block: no animation disables a control or delays navigation; a tap
  during a moment cuts it short.
- Nothing loops, except a status indicator during real ongoing activity
  (reconnecting), which stops when the activity stops. No flashing, no fast
  full-screen movement.
- VoiceOver: illustrations hidden; changes announced once through `Announcer`;
  an animation never moves focus.
- Performance: no live blur filters (bake glow or texture into the art), no
  per-row timers, no animation while a list scrolls, images sized for display.
  Illustrations stay under 100 KB across their layers.
- Evidence: a PR that adds motion includes a short simulator recording and one
  screenshot with Reduce Motion on.

## Accessibility (N-08)

44pt targets everywhere (compact buttons and links keep a 44pt hit area).
Rows are one VoiceOver element ("The Odyssey, Released Jul 17 · RT 88%, plus
28 points"). Status is always words plus color (Pending, at release, badge
text, "+"/"−"). Animations respect Reduce Motion (through `FRMotion`, above). Text colors strengthen under
Increase Contrast. Components never announce themselves; screens announce
changes once through `Announcer`.

## Adding a token

1. Add a `static let` to `Tokens/FRColor.swift` with **both** palettes from the
   mockups' `.scr` / `.scr.light` (`FRPalette.color(dark:light:)`; alpha and
   high-contrast variants optional). Name it by role (`frWarningTint`), not hue.
2. Spacing/size constants go in `FRMetrics`; text roles in `FRTextRole`.
3. Add it to the table above and to the swatch preview, and check contrast in
   both appearances.

Previews use `Previews/SampleData.swift` (`FRSampleData`, `FRPreviewCanvas`),
DEBUG only.
