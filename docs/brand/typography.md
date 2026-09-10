# Fantasy Reel typography

Design proposal · September 2026 · application rollout pending

The identity should feel like a lively independent cinema: strong opinions, warm company, and a game worth paying attention to. Bricolage Grotesque gives the name and headlines that personality, with a separate setting for aligned numbers. DM Sans keeps reading and controls comfortable.

This guide extends the approved film-strip speech-bubble direction across the product. It specifies a system and migration targets; it does not claim that these styles are installed or that the live app has passed visual checks.

## Two families, clear jobs

**Bricolage Grotesque:** the wordmark, marketing headlines, page titles, section headings, and spacious league-card titles. Use upright 700 as the default display weight. Large headlines can feel close-set and confident; smaller headings need more air. Its numeric roles use weight 700, width 100, and fixed optical size 12 with tabular figures. Keep the letterforms intact: no CSS horizontal scaling. The finished wordmark can have its own optical spacing and drawn details; ordinary headings should use the unmodified font.

The inspected [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque) supports weight 200–800, width 75–100, and optical size 12–96. The proposed primary wordmark uses weight 700 / width 96 / optical size 48; the compact variation uses 750 / 88 / 48. For live typography, start the hero at width 96 and smaller headings at width 100. These are distinct settings for distinct uses, not competing font families.

**DM Sans:** body copy, navigation, buttons, text inputs, explanatory headings inside forms, movie and team names in comparison rows, dates, badges, and metadata. Use 400 for reading, 500 for labels, and 600 for controls and row titles. Avoid negative tracking in operational text.

The inspected [DM Sans file](source/dm-sans.ttf) has proportional digit advances and no `tnum` substitution; applying `tabular-nums` alone does not make its digits equal-width. The supplied [Bricolage file](source/bricolage.ttf) supports tabular and lining figures, so scores, budgets, ranks, and changing clocks use its numeric setting. Dates and numbers inside ordinary prose can remain DM Sans.

Keep a system monospace fallback for actual codes or diagnostic content. Existing join codes may retain Geist Mono if a font-usage audit justifies the extra family. The main identity remains two families; aligned gameplay figures do not require a third.

The working atmosphere comes from a few expressive headings above calm, aligned information. A draft board should still feel fast to scan when it contains dozens of titles.

## Proposed role scale

Sizes and line heights below are CSS pixels at a 16px root size; implement them in `rem`. Mobile values are the base. Desktop values apply when the content area has room, starting around the existing `lg` breakpoint. Keep intermediate widths fluid or use a middle step where a specimen demonstrates the need.

| Proposed role | Family / weight | Mobile size / line | Desktop size / line | Tracking | Main use |
| --- | --- | --- | --- | --- | --- |
| `type-hero` | Bricolage / 700 | 40 / 42 | 72 / 74 | −0.035em | Landing headline; one per marketing page |
| `type-page` | Bricolage / 700 | 28 / 32 | 36 / 40 | −0.025em | Your leagues, league title, settings |
| `type-section` | Bricolage / 700 | 22 / 28 | 26 / 32 | −0.02em | Draft board, trading block, standings section |
| `type-panel` | Bricolage / 700 | 20 / 26 | 22 / 28 | −0.015em | Dialog title, empty state, major card title |
| `type-card` | Bricolage / 700 | 18 / 24 | 20 / 26 | −0.01em | League card with room for its name |
| `type-lead` | DM Sans / 400 | 18 / 28 | 20 / 30 | 0 | Short page introduction or marketing support |
| `type-body` | DM Sans / 400 | 16 / 24 | 16 / 24 | 0 | Rules, forms, descriptions, recovery instructions |
| `type-body-sm` | DM Sans / 400 | 14 / 20 | 14 / 20 | 0 | Dense supporting copy, alerts, histories |
| `type-row-title` | DM Sans / 600 | 14 / 20 | 14 / 20 | 0 | Movie/team title in a dense row or poster grid |
| `type-control` | DM Sans / 600 | 14 / 20 | 14 / 20 | 0 | Buttons, tabs, navigation; use 16 / 24 for large CTAs |
| `type-input` | DM Sans / 400 | 16 / 24 | 16 / 24 | 0 | Text fields, search, selects |
| `type-label` | DM Sans / 500 | 14 / 20 | 14 / 20 | 0 | Form labels, group labels, table headers |
| `type-meta` | DM Sans / 500 | 12 / 16 | 12 / 16 | 0 | Dates, compact status text, bottom navigation |
| `type-number` | Bricolage / 700 | 16 / 22 | 16 / 22 | 0 | Budget, rank, score in comparison rows |
| `type-number-lg` | Bricolage / 700 | 28 / 32 | 32 / 36 | 0 | Team total, available budget, major statistic |

`type-number` and `type-number-lg` use Bricolage at optical size 12 and width 100, with `font-optical-sizing: none` and `font-variant-numeric: lining-nums tabular-nums`. An optional `type-numeric` utility applies that family, optical setting, width, and numeral treatment to clocks or numeric inputs while preserving their existing size and weight. For example, combine it with `type-input` for a 16px amount field; leave the associated label in DM Sans.

Use the same precision and units within a comparison; retain existing domain formatting without adding leading zeros. Render absent Rotten Tomatoes scores as Pending, never a fabricated zero. Align numeric columns to the right and their labels to the same edge; keep prose and titles left-aligned.

These names describe roles, not HTML tags. A movie title can remain an `h3` and use `type-row-title`; a dialog `h2` uses `type-panel`. Typography should not change heading order or accessible names.

## Rhythm, color, and writing

- Keep the wordmark and display headings upright. Use italics only when the content calls for them, such as a short quotation.
- Use sentence case for controls and labels: “Place bid,” “Trading block,” “Available budget.” Preserve movie titles and user-created names as supplied.
- Put the wordmark in soft white and its symbol in matte gold. Most headings stay `foreground`; gold marks a useful action, selection, or occasional featured value. Do not gold-highlight an arbitrary word in every heading.
- Keep paragraphs around 45–70 characters wide, with 8–12px between a heading and its supporting copy. Allow 24–32px between related sections; retain tighter spacing inside gameplay rows.
- Use left alignment throughout play. Centered marketing, authentication, and recovery panels remain deliberate exceptions.
- Use the existing `foreground-secondary` for meaningful small text on cards and inputs. A quieter color should not make a deadline, label, or instruction harder to read.

Computed from the current opaque sRGB tokens in [globals.css](../../apps/frontend/app/globals.css), `foreground-muted` (`#8a8078`) has contrast of approximately **4.97:1 on background, 4.41:1 on surface, and 3.72:1 on elevated**. The latter two fall below the 4.5:1 minimum for normal text. `foreground-secondary` (`#b8b0a4`) reaches 7.94:1 on surface and 6.69:1 on elevated. These token calculations are not a rendered-page audit; opacity, overlays, status backgrounds, and imagery require separate checks. See [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Map the current app to the system

| Surface and source | Current implementation | Proposed treatment |
| --- | --- | --- |
| [Font setup](../../apps/frontend/app/layout.tsx), [global styles](../../apps/frontend/app/globals.css) | Loads Geist Sans, Geist Mono, Montserrat, and DM Sans. `font-display` resolves to Montserrat; sizes live mostly in local utility strings. | Replace the display family through an explicit migration and introduce role classes. Audit Geist uses before removing a font. Preserve the existing Next font-loading approach. |
| [Landing hero](../../apps/frontend/app/components/landing/HeroSection.tsx) | Montserrat 36–72px, mixed white/gold heading; display-family CTA. | `type-hero` + `type-lead`; choose editorial line breaks in the specimen, then validate natural wrapping. CTA uses DM Sans. |
| [Login](../../apps/frontend/app/(public)/login/page.tsx), [dashboard](../../apps/frontend/app/components/DashboardClient.tsx) | Login title 30px; dashboard 30–36px. Both have short secondary introductions. | Shared `type-page`; compact authentication copy stays `type-body`. Keep dashboard headings left-aligned as space allows. |
| [League list](../../apps/frontend/app/components/LeagueListItem.tsx), [team header](../../apps/frontend/app/(authenticated)/league/[id]/components/TeamHeader.tsx) | League name inherits 16px display; team header uses 18px display and 30px display points with a 9px uppercase label. | Spacious league name uses `type-card`; compact team name uses DM Sans 600. Points use `type-number-lg`, with a 12px sentence-case label. |
| [Standings](../../apps/frontend/app/(authenticated)/league/[id]/standings/StandingsClient.tsx), [standing rows](../../apps/frontend/app/(authenticated)/league/[id]/standings/TeamStandingCard.tsx) | Card/row comparisons use display-font team names and scores; labels vary from 9–11px. | Treat these as comparison rows even though they are not HTML tables. DM Sans names and 12px labels; Bricolage numeric roles for aligned scores and ranks. Preserve clear rank/score hierarchy. |
| [Roster](../../apps/frontend/app/(authenticated)/league/[id]/roster/RosterClient.tsx), [draft board](../../apps/frontend/app/(authenticated)/league/[id]/components/DraftBoard.tsx), [draft movies](../../apps/frontend/app/(authenticated)/league/[id]/components/DraftMovieCard.tsx) | Section headings use 18–20px display. Draft and roster movie names already use 14px body-family text. | `type-section` for major sections; preserve compact DM Sans movie names with `type-row-title`. Use 12px metadata with adequate contrast. |
| [Bid shell](../../apps/frontend/app/(authenticated)/league/[id]/bidding/BiddingShell.tsx), [bid card](../../apps/frontend/app/(authenticated)/league/[id]/components/BidCard.tsx), [bid dialog](../../apps/frontend/app/(authenticated)/league/[id]/components/PlaceBidModal.tsx) | Some numbers already have `tabular-nums`; `.bid-amount-display`, amount inputs, and movie row titles use the display family. | Use Bricolage numeric roles for amounts and `type-numeric` for amount inputs and timers. Search text and labels stay DM Sans; use `type-panel` for the dialog and `type-row-title` for search results and bid cards. A spacious selected-movie heading may use `type-card`. |
| [Trade proposal](../../apps/frontend/app/(authenticated)/league/[id]/components/ProposeTradeModal.tsx), [trade confirmation](../../apps/frontend/app/(authenticated)/league/[id]/components/AcceptConfirmModal.tsx) | Dialog titles are 18px display; give/receive labels are 14px body-family headings. | Dialog `type-panel`; retain DM Sans give/receive labels. Full movie names, amounts, and consequences must remain readable before confirmation. |
| [Side navigation](../../apps/frontend/app/components/navigation/SideNav.tsx), [bottom navigation](../../apps/frontend/app/(authenticated)/league/[id]/components/LeagueBottomNav.tsx) | Sidebar section labels are 10.4px uppercase; bottom-nav labels 10px and counts 9px. | DM Sans sentence-case labels; 12px minimum for navigation text. Rebalance spacing or use the existing More menu before shrinking text. Keep the approved logo distinct from ordinary navigation labels. |
| [Route error](../../apps/frontend/app/error.tsx), [global error](../../apps/frontend/app/global-error.tsx) | Route boundary uses display 24px; global boundary deliberately uses inline styles and a system font. | Share panel scale, body rhythm, and colors. Preserve the global boundary's self-contained fallback; do not make recovery depend on the root stylesheet or downloaded font. |

The current [design reference](../../CLAUDE.md#design-system-cinematic-dark) says all `h1`–`h3` elements use `font-display`. Update that rule when implementing this proposal so compact content headings can use DM Sans by role. Also audit `.avatar`, `.cta-button`, `.bid-amount-display`, `.tomatometer-value`, and `.scoring-points`: they currently inherit display typography and should not silently switch with every headline.

## Mobile, long content, and accessibility

Use **12px as this system's floor for functional metadata**, not as a claim that WCAG prescribes a minimum font size. Keep reading text at 16px and dense supplementary copy at 14px. Make space by stacking content and choosing fewer visible secondary fields before reducing type.

Allow movie and league titles to wrap to two lines in cards when practical. A dense row can truncate if its full title is available through a keyboard- and touch-accessible detail view; a hover-only `title` is insufficient as the only way to read it. Never truncate the selected movie's identity, a trade consequence, an error, a bid amount, or a deadline in a confirmation flow. Keep icon/count groups from squeezing the name to nothing.

Use relative sizes, avoid fixed-height text containers, and verify layouts with enlarged text. Test user text-spacing overrides without clipping or loss of controls: line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em. These are resilience tests, not mandatory default typography settings. See [W3C text-spacing guidance](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing).

Set `font-optical-sizing: auto` for Bricolage headings and let it follow the rendered size. Numeric roles keep optical size 12; the exported wordmark keeps optical size 48. Preserve the proposed width settings when loading the variable font. Verify family loading, weight availability, tabular digit widths, punctuation, accented names, and fallback wrapping against the exact files used in the app before rollout. Avoid synthetic bold or italic as an accidental consequence of incomplete font loading.

## Rollout and acceptance

1. **Approve the specimen and assets.** Review a landing headline, authentic league overview, dense standings, bid/trade dialog, and small mobile navigation together. Inspect the logo separately at real browser-icon sizes.
2. **Establish font loading and roles.** Add Bricolage, keep DM Sans, implement role utilities, migrate navigation/brand and both error boundaries, and revise the old blanket heading rule. Avoid a global family swap until the numerical/control exceptions are handled.
3. **Migrate in coherent surfaces.** Landing and authentication first; dashboard and league overview next; draft, roster, standings, bidding, and trading together last. Keep transaction forms and their confirmation/error states within the same migration unit.
4. **Verify the final surfaces.** Follow [AGENTS.md](../../AGENTS.md) and the [E2E guide](../E2E_TESTING_STRATEGY.md): restart the task dev server, run relevant static checks, then interact with desktop and mobile states. Include long titles, negative/large scores, Pending scores, loading, empty/error states, keyboard focus, enlarged text, and fallback-font rendering. Check the complete bid and trade flows for clipping around sticky actions and the on-screen keyboard.

This document is grounded in source inspection, font-file checks, and palette calculations. No live component typography, layout, or font-loading behavior was changed for this proposal; browser validation of the eventual app rollout remains outstanding.
