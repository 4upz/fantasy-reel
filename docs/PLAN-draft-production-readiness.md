# Draft production readiness: implementation plan

Status: implementation in progress on `codex/draft-production-readiness`, based
on main `2ca91c4`. DRAFT-01/02 are implemented; DRAFT-03 through DRAFT-08 are in progress.
No deployment has been performed.

The goal is a dependable first production draft: participants can find eligible
movies, make picks confidently, see each other's turns without refreshing, and
finish with consistent league data. Preserve the existing design system and
Next.js/Supabase architecture.

## Accepted product decisions and evidence

- **Remove TMDb ratings throughout the app.** Remove TMDb star scores, numeric
  vote averages, vote counts, and minimum-rating controls/filters. Do not merely
  relabel them. Rotten Tomatoes remains the source of fantasy scoring. TMDb
  remains useful for movie identity, discovery, artwork, and release metadata;
  popularity/trending is distinct from user ratings.
- Retain snake drafting and the existing upcoming-date eligibility policy for
  this first release. Make discovery scope explicit. Do not silently introduce
  timers, auto-picks, linear drafts, or different film-eligibility rules.
- If no eligible counterpick remains, provide a confirmed owner action to end
  the remaining counterpicks and activate the league while preserving picks
  already made. This is the stated implementation assumption after the optional
  product clarification; it never runs automatically.
- The initial audit reviewed `93a4f54523bf47b5e85d343f712ddddd8882cae5`.
  Production subsequently inspected was `2ca91c4767db7b739243e7943629a54f9dfbbf06`.
  **Revalidate every finding against the implementation branch before editing.**
- The historical reconnect bug was removed by `06c3e1d` on February 17, 2026;
  that fix was present in the inspected production deployment. Controlled
  callbacks reproduced the old code tearing down a recovered channel. Current
  spontaneous disconnects remain undiagnosed. Forced-disconnect tests proved
  recovery defects, not the cause of the original transport failure.
- Existing start-draft/draft-pick integration tests passed 25 checks. Several
  multiplayer browser tests were disabled. Passing those existing checks alone
  is not a release criterion.

## Work packages

Implementation evidence (in progress):

- DRAFT-01 now also guards direct participant membership/order writes after
  review found that self-enrollment/deletion could change the active turn count.
  Join/kick/start share the league lock; verification uses an isolated local DB.
  Direct PostgreSQL role checks passed for anonymous/member/outsider denials,
  owner setup/start, direct-table bypasses, active membership/order protections,
  and four independent-connection start/reorder races. Exact unchanged HTTP
  handlers against real Auth/Postgres passed 163 integration steps; seven failed
  in fixture/Auth setup under resource pressure. Full start/create/join suites
  passed in that run. Actual Edge retry also hit Auth 504; the complete HTTP
  suite remains a DRAFT-09 gate, not a claimed pass.
- DRAFT-02 rendering/filter changes passed simplification review, affected-file
  ESLint, the 95-test bot suite/build, and 21 existing mocked cache tests.
  Browser checks passed at 1280px and 390px across movie cards/shared details,
  draft cards/previews/filters, and bidding results/selected summaries. Rated
  (8.7 / 87,654 votes) and unrated fixtures showed no ratings/counts, zero-runtime
  artifacts, NaN, horizontal overflow, or page errors. RT/scoring is preserved.
- DRAFT-03 now refreshes all four state collections with coalescing, a 15-second
  request deadline, recovery triggers, and a truthful 10-second polling fallback.
  A deterministic hook probe passed superseded reads, completion-boundary races,
  stalled reads, recovery, and unmount cancellation.
- **New reproduced SDK lifecycle cause:** in installed Realtime 2.95.3,
  `removeChannel(old)` removes a replacement channel with the same topic when
  its asynchronous cleanup completes. A direct installed-SDK probe retained zero
  channels after rapid same-topic replacement and one with distinct mount topics.
  Draft subscriptions now use a stable unique topic per effect lifetime. This
  does not prove that every historical production disconnect had this cause.
- The initial local two-browser observation delivered a real pick to both UIs
  in 1.9 seconds while Live. The ongoing development-server observation includes
  HMR interruptions; it is not a clean production-build uptime measurement.
- DRAFT-04 resolves canonical cached/TMDb metadata before persisting a movie;
  malformed identity/date and failed lookups cannot create incomplete records.
  Shared metadata unit checks pass; real Auth/Postgres integration is underway.
  A read-only production audit found 65 movies, zero missing release dates,
  zero missing TMDb identities, and zero empty titles. No production backfill
  is indicated by that completeness check; it does not validate each date.
- DRAFT-05's durable notification outbox preserves per-channel event order,
  leases deliveries, and records bounded retries outside pick requests. Delivery
  preference changes and provider failures are exercised with stubs; no external
  Discord message or deployed schedule has been created during implementation.
- DRAFT-08 calendar helpers pass boundary checks in UTC, New York, Los Angeles,
  and Kiritimati, including January 1, invalid dates, and windows crossing years.
- Verification limitation: the isolated local stack shares an exhausted Docker
  VM (7.65 GiB RAM, almost all 1 GiB swap used; sampled full memory stalls 72%).
  Actual Auth requests returned 504 and a direct draft-pick fixture insert hit a
  PostgreSQL statement timeout. No database lock blockers were found. Browser
  runs under this pressure are diagnostic, not a passing release gate. The
  second 241-second run had no page errors and real Auth refresh, but failed
  four scenarios including an initial fixture timeout and online recovery.
- Read-only production publication inspection confirms all four draft state
  tables are included in `supabase_realtime`; missing publication is excluded
  as the cause in the inspected production project.

| ID | Priority | Deliverable | Dependencies |
| --- | --- | --- | --- |
| DRAFT-01 | Implemented; final HTTP gate pending | Protect draft-order mutations | None |
| DRAFT-02 | Verified | Remove TMDb ratings app-wide | None |
| DRAFT-03 | Release blocker | Diagnose socket failures and make state recovery reliable | Can begin immediately; integrate with DRAFT-05 |
| DRAFT-04 | Release blocker | Validate canonical movie metadata and repair wishlist picks | None; coordinate contracts with DRAFT-05/06/07 |
| DRAFT-05 | Release blocker | Make picks and completion consistent and recoverable | DRAFT-01, DRAFT-04 |
| DRAFT-06 | Release blocker | Fix discovery pagination and filter state | DRAFT-02; align eligibility with DRAFT-04 |
| DRAFT-07 | Release blocker | Make selection, submission, and keyboard interaction reliable | DRAFT-03/04/05/06 contracts settled |
| DRAFT-08 | Required correctness, then polish | Correct dates and improve mobile turn/action visibility | Dates independent; mobile after DRAFT-07 |
| DRAFT-09 | Release gate | Verify a complete multiplayer draft and deployment readiness | All required fixes |

### DRAFT-01 — Protect draft-order mutations

Problem: anonymous or unauthorized callers can execute privileged reorder and
randomize RPCs directly, including during an active draft. The Edge Function's
owner check does not protect those calls.

- Restrict execution of `randomize_draft_order`, `reorder_draft_order`, and
  `randomize_draft_order_if_needed`; enforce owner authorization and setup phase
  in the database or use service-only RPCs behind authenticated owner endpoints.
- Lock the league while validating and changing its order. Coordinate start and
  reorder so a request cannot pass setup checks then change an active draft.
- Review `get_next_draft_pick` access so private league/participant details are
  not available to unrelated callers.
- Use a new migration; do not edit applied migrations.

Primary ownership: new migration and affected calls in
`supabase/functions/start-draft/index.ts` and
`supabase/functions/update-league/index.ts`.

Done when anonymous and authenticated nonowners cannot change order, the owner
can configure a setup league, and concurrent start/reorder cannot change order
after drafting starts. Test direct RPC access as well as the Edge endpoints.

### DRAFT-02 — Remove TMDb ratings throughout the app

- Remove rating badges, averages, vote counts, and associated empty spacing from
  movie cards, draft previews, shared movie details, bidding results, and the
  selected-movie bidding summary.
- Remove the minimum-rating slider, state, request parameters, and TMDb rating
  filter behavior. Update callers, shared types, and test fixtures coherently.
- Audit Discord output as well; the currently identified bot references are
  transport types/options, but no user-facing ratings should remain anywhere.
- Remove unused rating icons/helpers. Do not replace a missing TMDb score with
  zero, a fake RT score, or another substitute score.
- Existing database columns or upstream payload fields may remain temporarily
  for compatibility. Dropping columns/backfilling data is not required to remove
  ratings from the product and must not expand this task unnecessarily.

Known UI surfaces:

- `apps/frontend/app/(authenticated)/movies/components/MovieCard.tsx`
- `apps/frontend/app/components/MovieDetailBody.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/DraftMovieCard.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/MovieQuickPreview.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/PlaceBidModal.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/DraftFilters.tsx`

Related contracts: `useDraftMovies.ts`, its callers, frontend movie types,
`supabase/functions/browse-movies/index.ts`, and the bot functions client.

Done when rated and unrated fixtures show no TMDb rating/vote-count UI or
minimum-rating control on desktop/mobile, discovery is not constrained by TMDb
votes, and RT/fantasy-score displays still behave correctly. Search the final
code for remaining references and classify transport-only uses explicitly.

### DRAFT-03 — Diagnose WebSockets and recover complete draft state

Treat diagnosis and fallback recovery as two distinct acceptance criteria.

- Capture the actual subscription error, socket close code/reason when available,
  heartbeat health, channel lifecycle, and auth-refresh timing. Correlate with
  available server evidence. Never record tokens or raw private payloads.
- Investigate lifecycle/retry conflicts, token or subscription rejection, and
  network/background heartbeat behavior. Test the installed SDK and deployed
  version; do not reintroduce the removed manual reconnect loop.
- Exercise normal connected use, foreground/background transitions, offline/
  online, route navigation/remount, and session refresh. Use a bounded observation
  window, proposed at least 30 minutes across two browser contexts, and report
  its actual length and results. This sample is not proof of indefinite uptime.
- Implement one full-state refresh covering league phase, participants/order,
  draft picks, and counterpicks. Reconcile at initial subscription, recovery,
  focus/online, and successful mutations. Prevent older fetches replacing newer
  state; show explicit errors when initial data cannot be read.
- Retain a reliable bounded polling fallback and show its real state. Repeated
  errors must not hide active polling behind an endless reconnecting label.

Primary ownership: `DraftClient.tsx`, `ConnectionStatusIndicator.tsx`,
`apps/frontend/utils/supabase/client.ts` only if evidence requires it, and related
telemetry/tests. Coordinate refresh and mutation contracts with DRAFT-05/07.

Done when connected clients receive turn updates without polling or refresh,
missed phase/order/pick events are recovered after interruption, and connection
status matches actual behavior. A root-cause claim requires supporting evidence
and a regression scenario. If spontaneous failures cannot be reproduced, report
that limit and the observation results; do not label polling as the socket fix.

### DRAFT-04 — Canonical movie validation and wishlist reliability

- Resolve trustworthy movie identity/release metadata server-side before creating
  a movie or validating a pick. Client-supplied title/date must not establish
  eligibility. Use existing TMDb cache/HTTP conventions.
- Repair incomplete existing records when authoritative metadata is available.
  Reject invalid picks without leaving new incomplete movie rows behind.
- Make wishlist picks use the same canonical metadata and eligibility as search
  and browse picks, including titles absent from the loaded results page.
- Return consistent, actionable eligibility information to the preview. Keep the
  intended release policy aligned with discovery; handle unavailable metadata
  as a retryable lookup problem where appropriate.
- Inspect existing incomplete rows read-only and prepare a bounded repair plan
  if needed; local fixture repairs do not authorize a production data backfill.

Primary ownership: `supabase/functions/draft-pick/index.ts`, a shared metadata
resolver if appropriate, `MoviePicker.tsx`/`MovieQuickPreview.tsx` integration,
and corresponding local contract tests.

Done when fabricated or ineligible movie submissions fail, a failed lookup does
not poison later attempts, and a wishlisted eligible movie can be drafted even
when absent from all loaded browse/search pages. A corrected retry must succeed.

### DRAFT-05 — Consistent picks, phase transitions, and completion

- Validate current phase, membership, turn, and availability together with pick
  insertion under a database transaction/league lock. Keep existing uniqueness
  protections. Define retry/idempotency behavior for a committed pick whose HTTP
  response is lost, including consecutive turns at a snake-round boundary.
- Distinguish next-turn query failure from no remaining turn. Require all draft
  picks before starting or skipping counterpicks; enforce this server-side.
- Make activation, budgets, and score initialization atomic or durably
  recoverable. A failure must not leave a falsely completed or unrecoverable
  league. Include start-draft concurrency in the phase-transition review.
- Correct `CounterpickRound.tsx`: failed turn reads must show an error/retry,
  never “round complete” or “league active.” Completion text must reflect the
  actual phase and identify when an owner action is required.
- Return an authoritative mutation result suitable for immediate UI updates.
- Remove slow Discord delivery from the critical pick-response path using an
  established durable delivery mechanism or a scoped outbox. Do not substitute
  untracked fire-and-forget calls. Test delivery failures with stubs.

Primary ownership: new migrations; draft/start/counterpick transition functions;
`_shared/activation.ts`; relevant notification integration; completion UI.

Done when simultaneous/duplicate requests cannot corrupt turn state, lost
responses can be reconciled, early phase transitions fail, query errors do not
activate the league, finalization failures recover, and final budgets/scores
match the completed draft. Notification failure must not obscure a saved pick.

### DRAFT-06 — Complete discovery and truthful filter state

- Keep pagination usable when a page contains no eligible or undrafted results.
  Traverse empty upstream pages within a bounded limit and provide load-more/
  retry controls; do not report exhausted results prematurely.
- Fix Trending beyond page one and retain overflow between pages. Choose a
  stable pagination/cursor contract with accurate has-more semantics.
- Give tab, search query, genre, and release window one controlled state model.
  Apply supported filters consistently. Hide/disable unsupported combinations
  clearly. Search within Wishlist must actually filter the wishlist.
- Make counts distinguish total matches from loaded/available results. Make
  loading, stale/partial results, failure, and genuine emptiness distinguishable.
- Label release windows accurately: the existing “This Quarter” is a rolling
  90 days, and “All Upcoming” has a finite horizon. Explain discovery scope.
- Releasing Soon must search the intended window, including across year-end,
  rather than only filtering whichever browse pages were already loaded.

Primary ownership: `MoviePicker.tsx`, `DraftFilters.tsx`, `useDraftMovies.ts`,
shared movie paging utilities, `search-movies` and `browse-movies`.

Done when eligible movies on later pages remain reachable after empty/drafted
pages, Trending paginates, tab transitions preserve truthful controls, Wishlist
search works, and delayed/failed requests have useful retry/reset paths.

### DRAFT-07 — Reliable submission and accessible selection

- Preserve the selected movie independently of the visible result arrays.
- Await and catch draft/counterpick actions. Keep the preview open while saving;
  retain it with an inline actionable error after failure. Close on confirmed
  success and show the movie/team confirmation.
- Revalidate live availability and turn in an open preview. Show “Drafted by…”
  or a clear disabled action when another player takes the movie.
- Use DRAFT-05's authoritative result and DRAFT-03's reconciliation contract so
  a successful save cannot leave the same turn/pick actionable.
- Keep synchronous duplicate-submit protection. Define close/navigation behavior
  during pending actions so a dismissed modal does not imply a canceled pick.
- Use keyboard-operable card actions, accessible dialog focus management,
  labeled controls, genre selection/expanded semantics, and announcements for
  turn changes and errors. Keep wishlist toggles independent of card actions.

Done when slow success, validation failure, network uncertainty, changed turn,
and already-taken movies each have a clear UI state; no unhandled rejections or
silent no-op clicks occur; and keyboard users can complete the full pick flow.

### DRAFT-08 — Calendar correctness and mobile usability

Required correctness:

- Format date-only releases without timezone shifts, including release year.
  Align today/next-30-days comparisons with the authoritative eligibility date.
- Remove stray zero text from optional runtime/metadata rendering. Rating zero
  artifacts disappear through DRAFT-02 rather than a replacement rating label.

Small usability improvements after the functional fixes:

- Keep a compact current-turn indicator visible while browsing and expose how
  many picks remain until the user's next turn, beyond the five-item queue.
- Keep selected title and Draft action easy to reach in long mobile previews.
  Check sticky content against keyboard focus, safe areas, and mobile navigation.
- Reduce unnecessary scrolling around progress/participants/history while
  preserving access to them. Keep existing brand tokens and typography roles.

Done when a calendar release date matches in UTC and US timezones, today and
year-boundary fixtures behave consistently, and desktop/390px mobile layouts
permit browsing and picking with visible state/actions. Broader visual redesign
is outside this release plan.

### DRAFT-09 — End-to-end release gate

- Enable/replace disabled multiplayer tests. Two independently authenticated
  browser contexts must start and finish a draft without manual refresh.
- Cover a normal snake round boundary, consecutive picks by one player, custom
  and randomized order, final activation, and start/skip/finish counterpicks.
- Cover disconnected sockets, reconnect, background/resume, refreshed auth,
  failed snapshot reads, duplicate requests, and a lost successful response.
- Cover empty search pages, trending pagination, Wishlist, filter transitions,
  unavailable movies in open previews, keyboard interaction, and mobile states.
- Verify persistence, authorization, and final budget/score state in local
  Supabase. Run affected Deno/bot suites and static checks. E2E infrastructure or
  test changes require the full browser suite per AGENTS.md.
- Use real local auth/database/Realtime; mock external providers at the narrowest
  useful boundary. Distinguish transport fault injection from natural failures.
- Prepare staging checks against the intended deployed commit, matching Edge
  Functions, auth configuration, and applied migrations. Recheck migration order
  against main. Run a staging draft with scoped test accounts when authorized.
- Document a recovery procedure for interrupted completion or an absent player;
  do not promise timers/auto-picks that the implementation lacks.

Release is ready for approval when required fixes and checks pass, no unresolved
draft-integrity or interaction blocker remains, and the WebSocket observation
results/limitations are explicit. Push/merge/deploy retain their authorization
requirements; a local passing test does not establish deployed readiness.

## Recommended execution model

Use one coordinating Codex task that owns this plan, integration, and commits.
Begin from an up-to-date isolated worktree and preserve unrelated local changes.

1. Revalidate the findings and agree shared mutation/refresh/movie contracts in
   code before overlapping frontend/backend edits.
2. Start DRAFT-01 and DRAFT-02 as independent backend/frontend work streams with
   disjoint file ownership. The lead can investigate DRAFT-03 concurrently using
   read-only evidence and temporary probes. Avoid concurrent edits to shared
   frontend files such as MoviePicker, DraftClient, and shared types.
3. Follow with DRAFT-04/05 backend integrity and DRAFT-03 client recovery; then
   integrate DRAFT-06/07. Fold the independent date correction into the nearest
   relevant UI batch, followed by small mobile improvements.
4. Produce small reviewable commits per work package (split large packages such
   as DRAFT-05 further when needed). Run the repo-required simplification review
   before final verification for each implementation batch.
5. Keep this plan's status current with completed changes, verification evidence,
   discovered scope changes, and remaining blockers. Finish with DRAFT-09 and a
   concrete release recommendation.

Subagents may handle independent bounded work inside the coordinating task.
Separate user-owned tasks are optional when separate branches/PRs are desired;
do not create them automatically. This plan requests no deployment or new task.
