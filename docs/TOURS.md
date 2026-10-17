# Guided tours

Short walkthroughs that start the first time someone opens a page, so players learn Fantasy Reel by playing it, and keep How to Play as a reference. This guide covers how the engine works and how to add a tour. `tours/definitions/bidding.ts` is the reference tour.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Tour definitions | `apps/frontend/tours/definitions/<id>.ts` | Plain data: id, version, rules, steps. One file per tour. |
| Registry | `apps/frontend/tours/registry.ts` | Lists every tour (`TOURS`) and the ids retired for good. |
| Pure rules | `apps/frontend/tours/engine.ts` | Outcome semantics, which tour a page starts, card placement. Unit tested. |
| Provider | `apps/frontend/components/tours/TourProvider.tsx` | Mounted once in the authenticated layout. Holds progress, picks and runs tours. |
| Page hooks | `<FeatureTour>`, `<TourButton>` from `@/components/tours` | A page offers a tour, and lets people replay it. |
| Overlay | `components/tours/TourOverlay.tsx` | The highlight and the card. Hand-built for the native `<dialog>` top layer. |
| Storage | `user_ui_state` table, `record_tour_outcome()` RPC | Per-user, own-rows only, read by the server layout. |

## Adding a tour

1. **Write the definition** in `apps/frontend/tours/definitions/<id>.ts`:

   ```ts
   import { defineTour } from '../types'

   export const tradingTour = defineTour({
     id: 'trading',                       // kebab-case, stored per user, never reused
     version: 1,                          // bump to show it again to people who saw it
     title: 'Trading',                    // shown in Settings → Tours
     description: 'Trading tab: proposing, answering, and how trades go through.',
     when: (ctx) => ctx.leagueStatus === 'active',
     steps: [
       { title: 'Deal with other teams', body: 'Centered intro: no anchor.' },
       { anchor: 'propose-trade', title: 'Propose a trade', body: '…' },
       { anchor: 'trade-review', title: 'Commissioner review', body: '…', when: (ctx) => ctx.isOwner === true },
     ],
   })
   ```

2. **Register it** in `tours/registry.ts`: import it and add `trading: tradingTour` to `TOURS`, in the order a new player meets the tours. That order is also the order of the Settings list.

3. **Mark the anchors.** Put `data-tour="propose-trade"` on each element a step points at. Use literal strings so the CI check can find them.

4. **Offer it on the page**, from a client component:

   ```tsx
   import { FeatureTour, TourButton } from '@/components/tours'

   <FeatureTour id="trading" ctx={{ leagueStatus: league.status, isOwner }} />
   <TourButton id="trading" />   {/* "Show me around"; renders nothing when the tour doesn't apply */}
   ```

5. **Run** `npm run test:draft:state` from the repo root. It runs `scripts/tests/tours.test.cjs`, which fails on:
   - a registry key that doesn't match its id;
   - a non-kebab-case id, or a retired one;
   - more than 5 steps;
   - a step title ending in a period;
   - any `anchor` that no `.tsx` file has as `data-tour="…"`.

## Rules for a step

- **No `anchor`:** a centered card. Use it for an introduction or a closing note.
- **`anchor`:** points at the first *visible* `[data-tour="name"]`. Several elements may share a name, such as the desktop tabs and the mobile bottom bar (both are `league-nav`). While a modal is open, only elements inside it count.
- **Anchor not on the page when the tour starts:** the step is dropped. This is how one tour covers controls that only some people see. Set `centerIfMissing: true` to show the step centered instead, when its words still make sense without the highlight.
- **Anchor disappears mid-tour:** the step shows centered, so the step count stays honest.
- **`when(ctx)`:** on the tour, it decides whether the tour applies at all. On a step, it drops that step. Prefer `when` over hoping an anchor is missing: it says why.
- **`autoStart(ctx)`:** on the tour only. It keeps a tour that applies from starting by itself, while "Show me around" and Settings can still play it. Use it for beginner tours, such as `autoStart: (ctx) => ctx.newPlayer === true`.
- **`body` as a function:** `body: (ctx) => …` gets the page's ctx when the tour starts. Use it for wording that depends on the viewer or the league, instead of a pair of steps with opposite `when`s.
- **`placement`:** optional. `auto` picks whichever side has room. Under 640px wide the card always docks to the top or bottom edge, away from the anchor, clear of the mobile header and bottom bar. It also stays clear of fixed chrome marked `data-tour-inset="top"`, `"bottom"` or `"left"` (the desktop side navigation); mark any new fixed bar the same way.

**Writing.** Keep tours to 5 steps or fewer, and each step to one or two short paragraphs. Say what the thing is *for* and when it happens, not where it is. Use the UI's own terms ("Fantasy Budget", never "FAAB").

## Context (`ctx`)

`<FeatureTour ctx>` is how a page tells its tour about the viewer. `TourContext` names the common facts (`isOwner`, `leagueStatus`, `counterpicksEnabled`). A page may pass any other serializable value its tour needs, such as `hasOpenBids: true`, and the tour reads it by key. Nothing has to be added to a shared layout. The ctx is compared by content, so pass a fresh object literal each render.

## When a tour starts by itself

The provider starts a tour on its own only when all of these hold:

- the page has a `<FeatureTour>` mounted;
- its `when` passes and at least one step applies;
- its `autoStart`, if it has one, passes;
- the user hasn't finished or hidden it at this version, and it isn't snoozed;
- automatic tours are on in Settings → Tours;
- no other tour has started by itself on this page visit. A page that starts offering a new tour while it's open (the Draft tab moving from setup to drafting) counts as a new visit.

When several tours qualify, the one with the highest `priority` wins (default 0), then whichever mounted first.

Before starting, it waits for the page to settle:

- **Loading content.** It polls until the set of visible anchors stops changing. When every anchor is on screen, that's about 0.75 seconds of no change. While some are still missing, it waits about 3 seconds of no change, so elements that arrive with a client fetch (bid cards, trade offers) can still make it. It gives up after 8 seconds. A step whose element still isn't there is dropped, so use `centerIfMissing` for steps about content that may be slow or empty.
- **Typing.** It won't start while the user is typing in a field, so it never takes focus mid-keystroke.
- **Open modals.** It won't start while an unrelated modal is open.

A tour whose anchors never show up doesn't start at all, so a lone intro card is never recorded as "seen". The page's next tour, if it has one, gets its turn on the same visit.

Tours always start for a user who asks: the account menu's **Tour this page**, `<TourButton>`, or Settings.

## How a tour ends

| The user… | Stored as | Effect |
|---|---|---|
| presses **Finish** on the last step, or leaves the page while on the last step (often by doing what it asked, such as starting the draft) | `completed` | Never starts by itself again at this version. |
| chooses **Don't show again** | `dismissed` | Same. |
| chooses **Not now** (the footer, or ✕), presses Escape, or leaves the page before the last step | `snoozed` | Starts again after 3 days. A second snooze of the same version counts as `dismissed`. |
| chooses **Turn off all tours** (offered on the first step of a tour that started by itself) | `dismissed`, plus `prefs:tours = {enabled:false}` | Nothing starts by itself. Replay still works. A toast says where to turn them back on. |

`record_tour_outcome()` merges outcomes so that nothing can roll them back:

- a report for an older version is ignored, so a stale tab can't undo a version bump;
- `completed` beats `dismissed`, and `dismissed` beats `snoozed`.

Other open tabs hear about each outcome over a `BroadcastChannel` and close the same tour.

In **Settings → Tours**, people can turn automatic tours off, see each tour's status, and "Show again" one tour or all of them. That deletes the stored rows; the tour shows on the next visit to its page.

## Storage

`user_ui_state(user_id, key, value jsonb)` is shared per-user UI state:

- **Keys** are namespaced: `tour:<id>`, `prefs:tours`, plus `hint:` and `announce:` reserved for later. Reuse the table for those rather than adding one.
- **Limits:** values are capped at 1 KB and each user at 200 keys.
- **Access** is own-rows only, and the rows are deleted with the account.

The authenticated layout reads the rows on the server (`getCachedUiState`), so tours know what was seen without a client round trip. If that read fails, nothing starts by itself until the next load. Asking for a tour still works.

## Accessibility

- The card is a non-modal `role="dialog"` labelled by its title.
- Focus moves to the card at each step and returns afterwards. Escape is "not now".
- The highlight lets clicks through, so the page stays usable.
- In a modal, the card renders inside that `<dialog>`, sharing its top layer and focus containment, and Escape is cancelled there so it can't close the form.
- If an unrelated modal opens mid-tour, the card hides until it closes.
- Motion respects `prefers-reduced-motion`.
- The card reflows and scrolls at 200% zoom.

## Tests and automation

- Playwright drives a browser with `navigator.webdriver` set, and tours don't start by themselves there, so existing specs are unaffected. A spec that wants tours sets `window.__FANTASY_REEL_TOURS__ = true` in `page.addInitScript` before navigating (see `e2e/tests/tours/`).
- Database rules are covered in `supabase/tests/user_ui_state.sql`.
- Pure rules and the registry are covered in `scripts/tests/tours.test.cjs`.

## Retiring or renaming a tour

Delete its definition and move the id into `RETIRED_TOUR_IDS` in the registry. Never give an old id to a new tour: people who saw the old one would be marked as having seen the new one. Renaming an id shows the tour again to everyone, which is usually what a rewrite wants anyway.
