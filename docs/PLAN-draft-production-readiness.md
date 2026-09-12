# Draft production readiness: implementation plan

Status: DRAFT-01 through DRAFT-09 are implemented and verified on
`codex/draft-production-readiness`, based on main `2ca91c4`. The final matching-source
CI gate passed at `efae412`: 168 browser passes, zero failures, 26 existing skips,
all 15 draft cases, and all required backend/database/build gates. Recommend a
controlled, coordinated release after deployment approval. See
[the release review](DRAFT-RELEASE-REVIEW.md) for exact evidence, measurement
limits, and the deployment/recovery sequence. The existing branch was pushed in
[draft PR #92](https://github.com/4upz/fantasy-reel/pull/92). No merge or
deployment has been performed.

### September 12 verification continuation

Main was re-fetched and remains `2ca91c4`; the implementation was continued from
`aa0f607`, preserving the unrelated original checkout. Commit `0cc3823` adds
verification safeguards and coverage, without changing application behavior:

- CI initializes a fresh runner database using `supabase start` with optional
  development seeds disabled. It performs no database reset. Frontend, Edge
  Functions, and migrations come from the same checkout.
- A loopback-only health probe verifies migrated tables, service credentials,
  real password Auth and refresh, RLS/Edge contracts, and a Realtime subscription.
  It cleans its exact user even after an uncertain create response and stops
  before expensive suites when unhealthy.
- CI pins verified Node 24.21.0, runs a network-disabled browser/trace preflight,
  and retains tracing for the complete browser suite with two workers and no
  retries. The existing failure artifact policy is unchanged; the new summary
  includes only allowed statistics and runtime state/counts.
- Thirteen draft browser cases at `0cc3823` include a two-round `[A,B,C,C,B,A]` journey,
  duplicate/stale HTTP submissions at the consecutive-turn boundary, detailed
  activation scores, missed-pick reconciliation, socket recovery without reload,
  and real refreshed-token propagation to Realtime. Visibility events are
  explicitly synthetic; they do not establish OS background suspension behavior.
- Only the external movie provider is replaced by canonical cache fixtures in
  these draft tests. An inert TMDb key permits cache lookups in CI; real provider
  and notification credentials are absent.
- Vercel Git deployments are disabled specifically for this feature branch.
  Supabase deployment remains restricted to main pushes/manual deployment;
  neither deployment path was invoked.

Preparation checks pass: nine draft state/date/request regressions, affected
ESLint, TypeScript, YAML/shell syntax, and a Node 24 Playwright probe with a valid
trace ZIP. Independent simplification reviews found and resolved health-probe
cleanup gaps and a possible false pass in refreshed-token coverage.
[CI run 34665036072](https://github.com/4upz/fantasy-reel/actions/runs/34665036072)
at `0cc3823` passed health, 117 database assertions, and 240 shared backend tests
with 165 steps. Its HTTP suite completed with 63 passing modules and two failing
modules: 660 passing steps, two failing steps, and four existing provider skips.
The failures were an oversized fixture-cleanup URL and obsolete exact rejection
text. Frontend build and browser gates did not execute after that failure.

Commit `ad4bb83` batches exact cache cleanup keys (two network-disabled SDK
regressions pass), corrects the counterpick rejection text, and verifies rejected
counterpicks leave receipts, turn, and league phase unchanged. Commit `0912d62`
fixes reproduced polling starvation and a renewable reconciliation deadline;
the state/date/request tests, TypeScript, and affected ESLint pass. A new browser
test delays actual REST snapshots to verify the polling fix with a real pick,
bringing the current draft browser count to fourteen.
Independent simplification reviews found no remaining issues in these fixes.
[CI run 34666240923](https://github.com/4upz/fantasy-reel/actions/runs/34666240923)
at `ad4bb83` (merge checkout `65c78a0`) passed health, 117 database assertions,
95 bot tests/build, 242 shared backend tests with 165 steps, all 65 HTTP modules
(662 passing steps, four existing provider skips), production build, and the
browser/trace preflight. The full browser result is **165 passed, two failed,
26 existing skips, zero flaky tests** in 4m18s. All 167 unique traces are valid;
Edge remained running without OOM, CPU hard-limit events, or acquisition timeouts.

Twelve draft cases passed in that second run, including activation/budgets/scores, response-loss
recovery, slow polling, and real Auth refresh/Realtime recovery. First/warm pick
timings in the recovery case were 373/251 ms. Two blockers remained: simultaneous
requests produced a timing-dependent 403 instead of the expected stale-slot 409,
and the two-round journey committed five picks while the owner's Live browser
remained at one pick. The final returning turn was therefore not completed.
Commit `22c7741` fixes stale-slot classification and receipts that commit during
preflight. Twenty-five actual-handler regression steps pass with transport
stubbed and networking disabled. Commit `817e17b` awaits Auth before the first
subscription join and reconciles every five seconds while subscribed. Eleven
state/date/request tests, TypeScript, and affected ESLint pass. Both batches
passed independent simplification review. The browser suite now has fifteen
draft cases, including real change-frame suppression; its snake journey also
asserts the owner's authenticated identity on every captured draft join.

The installed SDK's tokenless buffered-join race is independently reproduced;
the failed CI trace cannot prove that specific cause. Historical production
disconnect causality remains unproven. Sanitized case outcomes and recovery timing fields now persist in CI
logs even for success, without extending the failure-only raw artifact policy.

[Final CI run 34668316537](https://github.com/4upz/fantasy-reel/actions/runs/34668316537)
at `efae412` (merge checkout `8a1c173`, identical Git tree
`6445db8a0d0a45f9f66e8e428f5f97d99153b0e7`) passed both health probes,
117 database assertions, 11 state/date/request tests, 95 bot tests/build,
243 shared backend tests/190 steps, all 65 HTTP modules (662 passing steps,
four existing provider skips), production frontend build, and trace preflight.
The complete browser suite passed **168 tests, zero failures, 26 existing skips,
zero flaky tests** in 4m58s, with tracing enabled and no retries. All fifteen
draft cases and all six historical UI cases passed. This includes the unchanged
simultaneous-response assertions, complete six-pick snake journey, authenticated
joins, lost-response replay, and recovery from suppressed real change frames.
The Edge runtime stayed running without OOM, CPU hard-limit events, or worker
acquisition timeouts throughout the sustained shared/HTTP/browser sequence.

The [sanitized final report](release-evidence/draft-ci-34668316537.json) preserves
all 194 case outcomes and timing/runtime data. Recovery picks returned 201 in
299/327 ms. A fully cold container, natural production outages, actual OS
suspension, live provider success, and external notification delivery were not
tested by this run. The historical 25.64-second pick remains unexplained and
did not recur in the measured clean checks. Production smoke checks and session
observation remain part of the authorized rollout, not missing CI passes.
Subsequent documentation/evidence edits preserve the tested executable source.

Committed batches: `1fca2e7` removes ratings, `8f7e0af` protects draft setup and
start, `7c14975` fixes calendar dates, `06a18a6` adds canonical metadata,
transactional picks, and their notification outbox, and `0e5aa97` fixes discovery
paging. `bbdee1e` integrates synchronization, discovery, accessible selection,
mobile turns, and bounded request recovery. `ea5dca3` refreshes the shared header
and navigation after draft phase changes. `7c0b0c1` preserves retryable Auth
outage errors instead of misreporting them as rejected credentials. `0d89b61`
preserves actual HTTP status codes in the integration test helper.

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

Implementation and verification evidence below preserves the earlier local
diagnostic history. The September 12 final CI results above and the status table
supersede its open-gate statements; historical failures are not relabeled as passes.

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
  in 1.9 seconds while Live. That development-server observation included HMR
  interruptions; the separate stable-build sample below is more useful evidence.
- DRAFT-04 resolves canonical cached/TMDb metadata before persisting a movie;
  malformed identity/date and failed lookups cannot create incomplete records.
  Shared metadata unit checks pass; final HTTP limitations are recorded below.
  A read-only production audit found 65 movies, zero missing release dates,
  zero missing TMDb identities, and zero empty titles. No production backfill
  is indicated by that completeness check; it does not validate each date.
- DRAFT-05's durable notification outbox preserves per-channel event order,
  leases deliveries, and records bounded retries outside pick requests. Delivery
  preference changes and provider failures are exercised with stubs; no external
  Discord message or deployed schedule has been created during implementation.
  Nine delivery tests pass, including delayed turn pings and final-pick cues.
  The worker preserves next-player mentions only when that player is still on
  the clock. Counterpick-start instructions are suppressed once the phase moves.
- DRAFT-05 passes all 81 new pgTAP assertions and all 36 existing season-integrity
  assertions in the isolated database. Independent connections also passed
  same-key replay, competing same-slot requests, final-counterpick replay after
  activation, and notification lease/order races. Activation, configured budgets,
  score rows, receipts, and outbox writes commit together. HTTP verification
  remains separate: final Edge runs encountered Auth 504 and runtime failures.
  A local mixed-CLI service-token mismatch was independently found and corrected in ignored test configuration; no authentication code was bypassed.
- DRAFT-06 backend checks passed four tests with six actual-handler steps for
  raw trending pages, empty eligible pages, filter windows, invalid requests,
  and truthful upstream totals. Browser discovery assertions are included in
  the new DRAFT-09 suite. Eleven draft browser tests are enabled, replacing the
  previously disabled multiplayer coverage.
  The first real browser test has now passed owner start, search, changed query,
  truthful loaded counts, and disabled irrelevant filters. The next browser test
  failed in navigation before its draft assertion. Later full-suite traces
  captured `/auth/v1/user` returning 504, matching that environment failure.
  Trending retains its distinct 1,000-page limit; search/discover use 500, as
  described in [TMDb support's pagination guidance](https://www.themoviedb.org/talk/66901fd440958be954b3a1ad).
- DRAFT-08 calendar helpers pass boundary checks in UTC, New York, Los Angeles,
  and Kiritimati, including January 1, invalid dates, and windows crossing years.
  Shared movie details and trading/bidding date consumers now use the calendar
  formatter/year helper. The mobile draft order and preview footer are part of
  the following UI batch.
- DRAFT-07 preview interaction checks passed at 1280×844, 390×844, and 320×640:
  keyboard opening, native focus containment, metadata retry, pending duplicate
  and dismissal guards, inline rejected-pick errors, stable-key retry, focus and
  scroll restoration, turn loss, and unknown dates. Scrolled mobile previews
  retain the selected title and action. A targeted occupied-slot check proved
  that retrying the same movie on a later turn starts a new key/slot once the old
  slot is authoritatively occupied. These use response stubs for failure cases;
  the real multiplayer mutation gate is still separate.
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
- The final production build passes, as do ESLint on 22 changed frontend files
  and all nine state/date/request regression tests. A 1,802-second production-build
  WebSocket observation finished with both real local sessions Live and all seven
  scenarios passing: initial/later picks, remount, focus/visibility, offline
  recovery, slot-count updates, and a round boundary. Both sessions performed a
  real token refresh. No hot reloads were involved. Its scoped fixtures were
  removed after the REST cleanup timed out; the exact-ID SQL cleanup succeeded.
  The local build also exposed unavailable Vercel telemetry scripts redirecting to login HTML;
  those two hosting-specific errors are recorded separately from draft behavior.
  A fetch of main still resolved to `2ca91c4`; all three new migration timestamps
  sort after its latest migration, `20260911153843`.
- At 22:42:01 UTC in the stable-build observation, both sockets closed with code
  1006 without fault injection. The isolated Realtime container restarted at
  that same timestamp (restart count 1); Postgres and the gateway did not.
  Both browsers automatically returned to Live around 22:43:11 and received
  the next real pick in 1.9 seconds. Realtime logs show memory/scheduling warnings
  and missing-slot errors before restart; afterward both replication slots were
  active/reserved. The process exit cause is not proven (no crash dump; no
  retained OOM event). This local server restart explains that observed pair of
  disconnects, not the historical production incident. The clean uptime gate is
  still limited by the unstable local service, while recovery was demonstrated.
- Final review found an unbounded mutation request could lock the pending
  preview indefinitely. Draft mutations now opt into a 30-second deadline that
  covers auth and response parsing, then use the existing snapshot/receipt
  reconciliation. Three additional regression tests pass; nine state/date/request
  tests pass in total. Deadline ESLint and TypeScript checks pass. The completed
  production socket sample was intentionally unchanged; its build predates this
  final request-deadline refinement. A separate final-source production build
  passes and its application files match the branch byte-for-byte. After earlier
  login failures, the final 320px browser probe passed the real 30-second request
  deadline plus bounded reconciliation (45 seconds total), single pending
  submission, same-key retry, restored dismissal/scroll, and zero page errors.
  The global footer clears the fixed turn bar by 29px at the bottom of the page.
  The real waiting-player test passed in the full
  suite (preview available, submission disabled, zero persisted picks).

- A real owner-start screenshot exposed a stale shared league header still
  showing Setup while the draft was running. Confirmed phase changes now refresh
  the server-rendered header/navigation once, without reloading on ordinary picks.
  Simplification review and the final build pass. A real Realtime phase-change
  browser probe verified Setup becomes Drafting without manual refresh.

- Edge runtime logs confirm seven CPU-limit terminations and two worker acquisition
  timeouts during the browser run. Some line up with `start-draft` and
  `get-movie-details` 546 responses; isolate IDs are not linked to request IDs,
  so individual attribution is temporal. Modified handlers have no apparent new
  unbounded CPU work, and the cache implementation is unchanged, but local VM
  pressure does not establish healthy-runtime CPU compliance. These failures
  remain a release gate until a healthy-runtime HTTP/browser run succeeds or
  profiling identifies and resolves the cause.

- The full-suite traces exposed a separate confirmed error-classification bug:
  the shared authentication helper converted Auth 504/network failures to 401
  Unauthorized. The shared helper now returns a safe retryable
  503 for upstream 5xx/retryable-fetch failures while preserving denied access
  and all missing/invalid-token 401 behavior. The frontend already displays the
  response text; no sign-out or token handling change is required. Simplification
  review, Deno typecheck, and the shared utility suite pass: 11 tests/42 steps.
  Auth transport was stubbed through the real SDK without network permission;
  valid/missing/rejected credentials, 500/502/503/504, and network failures were
  covered. The full browser run retained its original backend snapshot.

- Final HTTP preparation found that the existing test invocation helper dropped
  successful response status codes, which would make the new transaction tests
  fail despite a correct 200/201 response. It now preserves the real SDK response
  status, including non-JSON HTTP errors, and leaves transport failures without
  a fabricated status. Two network-disabled tests through the actual locked SDK
  cover 200/201/204, JSON 401/409/503, text 546, and transport failure. Both tests,
  the affected Deno typecheck, and simplification review pass. No application
  behavior or existing assertions changed.

- The complete configured browser run finished on September 12 at 00:11 UTC:
  **101 passed, 63 failed, 26 existing skips, zero flaky, 190 total** in 97.16
  minutes. No retries or new skips were used. Of the eleven draft cases, the
  waiting-player case passed and ten failed. Several stopped before their target
  scenario on Auth/fixture failures, runtime 546, navigation failures, or delayed
  canonical details. The desktop rejection case reached the real validation
  request, whose error arrived just after the assertion deadline. These results
  do not verify complete multiplayer mutation, replay, or activation. The full
  report and exact error stacks are preserved before any follow-up run.
  The app build/backend snapshot stayed fixed, but a rating/NaN regex correction
  at 22:39 UTC (before the draft group), cache TTL/manifest edits at 22:52 UTC,
  and cleanup aggregation at 22:55 UTC occurred after the run began at 22:33:58
  UTC. Race/replay/activation assertions were unchanged; fixture line shifts
  explain some mismatched code frames. This is not a full final-source pass.
  A league-switcher ARIA case failed waiting for its first async option, before
  the two-option assertion. A later snapshot showed one option; neither that
  snapshot nor the incomplete trace establishes a missing-league defect. Its
  cause remains unclassified.

- A final isolated-runtime follow-up used the reviewed backend snapshot with
  `per_worker`, retaining image 1.68.4, normal Auth, and the same CPU/memory limits.
  Cold/warm checks passed start (200), repeated-start rejection (documented 400),
  canonical details (200), a real pick (201), and receipt replay (201), with
  exactly one persisted pick and exact fixture cleanup. Cold start took 1.30s,
  cold details 2.18s, cold pick 25.64s, and replay 221ms. No 546 occurred in this
  small sample; the cold-pick latency remains unexplained and is not acceptable
  evidence of normal production performance. An initial probe stopped because
  it incorrectly expected 409 for repeat start; the probe was corrected to the
  existing 400 contract and the isolated runtime restarted before the complete
  cold run. No application code, runtime limits, or checked-in test assertions
  changed for that correction. The complete affected HTTP result follows below.
  Auth log correlation showed sub-second server processing for the slow probe
  pick; it does not explain the delay before the Auth request appeared. Sustained
  testing then reproduced seven distinct CPU hard-limit terminations and Auth
  504s.
  Per-worker logs use a different hard-limit message than the earlier oneshot
  logs; an initial narrow log counter missed them. Worker reuse does not resolve
  the observed failure, and the small passing probe does not clear the gate.

- The final eleven-module HTTP run finished in 15m56s: 38 steps passed and 190
  failed; all eleven modules failed, and 19 make-counterpick steps never started
  after an Auth sign-in 504. Of the failed steps, 145 stopped in fixture helpers;
  the remaining 45 assertions captured unknown errors, gateway 502/503, three
  service-token 401s, or the safe Auth-unavailable response. Docker inspection
  confirmed the isolated Edge container was OOM-killed at 00:29:58.450 UTC,
  exit 137. Later Kong 503s followed the dead backend. Deduplicated runtime logs
  recorded seven distinct CPU hard-limit isolates before exit; repeated log
  history must not be counted as additional failures. This is not evidence of a
  healthy production runtime or a cause for historical production socket loss.
  Hash-only comparison confirmed the local test service token differed from the
  effective Edge token. Only ignored `.env.test` was corrected; those three
  service checks remain pending a healthy runtime. Exact scoped DB checks found
  no remaining integration leagues, synthetic movies, or cache rows. No further
  sustained run or redundant request to the dead Edge runtime was attempted.

- Full-run Auth triage found that the legacy email helper hardcoded verification
  links to local port 54321 while this task's accounts used 55421. Both recovery
  requests reached the wrong local Auth instance and returned `otp_expired`;
  these were fixture-origin failures, not demonstrated reset-page defects. The
  helper now uses the configured Supabase origin and decodes HTML ampersands
  while preserving the verification query. A network-disabled probe passed
  recovery/signup URL preservation. Signup verification now checks the exact
  account changes from unconfirmed to confirmed, preventing an invalid-link
  redirect to login from falsely passing; account lookup/cleanup paginate.
  Simplification review, scoped ESLint, frontend TypeScript, and whitespace
  checks passed. The unchanged final-source recovery/signup suite passed under
  Node 24.21.0: 13 passed, two existing skips, zero failures in 10.38 seconds,
  with all 13 trace ZIPs readable. Both recovery links and signup used the
  isolated Auth origin and reached the matching final frontend. Signup's exact
  account transitioned from unconfirmed to confirmed. Exact account enumeration
  found no residual fixtures after either run.

- A separate no-network Playwright Test probe reproduced trace-finalization
  failure under Node 26.7.0 with installed Playwright 1.58.1: assertions finished
  in 349ms, but the test timed out and its ZIP was truncated. The identical probe
  under Node 24.21.0 passed in 2.1 seconds with a valid ZIP. The initial email
  suite under Node 26 had the same pattern: all 13 executable test bodies
  completed, then all 13 timed out during finalization (two existing skips).
  Only the runner PATH changed for the passing email repeat; tests, app build,
  Auth configuration, tracing, and assertions stayed fixed. CI used Node 20
  then; the September 12 continuation now pins Node 24.21.0. This isolates a
  test-runtime problem, but does not erase the earlier full-suite Auth/API/UI
  failures or clear the complete multiplayer release gate.

| ID | Status | Deliverable | Dependencies |
| --- | --- | --- | --- |
| DRAFT-01 | Verified in final database/HTTP CI | Protect draft-order mutations | None |
| DRAFT-02 | Verified | Remove TMDb ratings app-wide | None |
| DRAFT-03 | Recovery verified in final CI; historical production cause unproven | Diagnose socket failures and make state recovery reliable | Can begin immediately; integrate with DRAFT-05 |
| DRAFT-04 | Verified in final HTTP/browser CI with canonical cache fixtures | Validate canonical movie metadata and repair wishlist picks | None; coordinate contracts with DRAFT-05/06/07 |
| DRAFT-05 | Verified in final SQL/race/HTTP/browser CI; delivery providers stubbed | Make picks and completion consistent and recoverable | DRAFT-01, DRAFT-04 |
| DRAFT-06 | Verified in final browser CI | Fix discovery pagination and filter state | DRAFT-02; align eligibility with DRAFT-04 |
| DRAFT-07 | Verified in controlled UI checks and final browser CI | Make selection, submission, and keyboard interaction reliable | DRAFT-03/04/05/06 contracts settled |
| DRAFT-08 | Verified in date/mobile checks and final browser CI | Correct dates and improve mobile turn/action visibility | Dates independent; mobile after DRAFT-07 |
| DRAFT-09 | Final CI passed; controlled release recommended after approval | Verify a complete multiplayer draft and deployment readiness | All required fixes |

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
