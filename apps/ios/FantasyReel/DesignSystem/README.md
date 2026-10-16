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
- A glass "+" in the top bar instead of floating create buttons.
- Points are whole numbers with a sign: "+28", "−4" (U+2212), "0"; "Pending"
  when unscored; muted with "at release" before release.
- One sheet per multi-step task (pushes inside the sheet, never sheet on sheet).

## Which component for which mockup class

| Mockup | Component |
| --- | --- |
| `.card`, tinted alert card | `FRCard(tone:)`, `.frCardBackground(_:)` |
| `.hr` | `FRHairline` |
| `.grp` | `FRRowGroup(separatorInset:)` (64 default, 108 standings, 16 settings/forms) |
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
| `.hd` + `.lt` | `ScreenHeader` |
| `.av`, `.ac1–4` | `Avatar(name:imageURL:size:corners:fill:)` |
| `.btn-p` / `.btn-s` / `.btn-d` / neutral | `.frPrimary` / `.frSecondary` / `.frDestructive` / `.frNeutral` |
| `.cap44`, `.pill44`, `.btn-sm` | `.fr(kind, size: .large / .medium / .compact, isLoading:)` |
| `.gbtn.glass` | `GlassIconButton` |
| `.gpill.glass` | `GlassPill` |
| adjacent glass controls | `GlassCluster` (`GlassEffectContainer`) |
| `.cols` + `.statv` | `StatColumns([StatItem])` |
| `.alert-i`, `.ai-*` | `InlineBanner(tone:title:message:)` |
| `.gseg` | `FRSegmentedControl` |
| `.fgrp .field` | `FormFieldRow` in `FRRowGroup(separatorInset: 16)` |
| reconnecting pill, offline dot (V2DraftOffline) | `ConnectionStatusBanner`, `ConnectionStatusIndicator` |
| load / empty / error states | `LoadState` + `LoadStateView`, `LoadingView`, `EmptyStateView`, `ErrorStateView` |

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

## Images (N-09)

`RemoteImage` → `ImagePipeline.shared`: decoded images downsampled to display
size, an NSCache memory cache (48 MB), a 100 MB URLCache on disk, shared
in-flight requests, cancellation via `.task(id:)`. Poster/avatar URLs are public,
so the disk cache is not user-keyed. Never load a backdrop for a thumbnail;
`PosterImage` picks the smallest TMDb rendition for the display.

## Accessibility (N-08)

44pt targets everywhere (compact buttons and links keep a 44pt hit area).
Rows are one VoiceOver element ("The Odyssey, Released Jul 17 · RT 88%, plus
28 points"). Status is always words plus color (Pending, at release, badge
text, "+"/"−"). Animations respect Reduce Motion. Text colors strengthen under
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
