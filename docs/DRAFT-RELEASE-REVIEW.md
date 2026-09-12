# Draft release review

Implementation branch: `codex/draft-production-readiness`, based on `2ca91c4`.
The branch is pushed in [draft PR #92](https://github.com/4upz/fantasy-reel/pull/92).
No merge, production migration, deployment, or external notification has been
performed. Verification status is tracked in
[the implementation plan](PLAN-draft-production-readiness.md).

## Changes to review

- Draft setup/order authorization and membership protection, including direct
  database calls and start/reorder races.
- App-wide removal of TMDb ratings, vote counts, and rating filters.
- Canonical movie lookup, repair of incomplete records, transactional picks,
  stable submission receipts, and atomic activation with configured budgets.
- Durable draft notifications with channel ordering, leases, and bounded retries.
- Full-state synchronization, unique subscription topics, bounded read deadlines,
  truthful fallback status, and transport/auth diagnostics without credentials.
- Complete discovery pagination, controlled filters, wishlist lookup/retry,
  accessible previews, submission feedback, calendar dates, and mobile turns.
- A 30-second deadline for draft mutations, followed by state reconciliation.
  A stalled auth lookup or response body cannot keep the preview locked forever;
  uncertain retries retain the submission receipt key.
- Shared league header/navigation refresh when the confirmed draft phase changes.
- A bounded follow-up corrects Auth outage messages: transient service failures
  return retryable 503, while missing/invalid credentials retain 401. The real
  SDK with stubbed Auth responses passed the utility suite: 11 tests/42 steps;
  simplification review and typecheck also pass.

## Verification and open gates

The September 12 continuation starts from implementation/test commit `aa0f607`.
Main is still `2ca91c4`. Verification commit `0cc3823` qualifies a fresh CI stack,
pins Node 24.21.0, and adds real browser coverage for snake/consecutive turns,
HTTP duplicate/stale submissions, exact activation scores, and recovery with
assertions for Auth-token propagation to Realtime. The recovery test uses synthetic
visibility events and a forced socket close; it does not claim a natural
disconnect or OS suspension. Its timing attachment measures first/warm picks in
that journey, not an independently restarted cold worker.

The isolated CI workflow uses one checkout for frontend, functions, and migrations. The runner initializes
an empty database without resets, checks health before the expensive suites, and
uses only local credentials plus an inert TMDb cache-test key. No production
provider or notification credentials enter CI. The full browser run retains
tracing, uses two workers, and has no retries.

| Attempt | Source | Result |
| --- | --- | --- |
| [34665036072](https://github.com/4upz/fantasy-reel/actions/runs/34665036072) | `0cc3823` | Health and 117 database assertions passed; 240 shared backend tests/165 steps passed. HTTP: 63 of 65 modules passed; 660 passing steps, two failing steps, four existing external-provider skips. Build/browser steps did not execute after the HTTP gate failed. |
| [34666240923](https://github.com/4upz/fantasy-reel/actions/runs/34666240923) | `ad4bb83` (CI merge checkout `65c78a0`) | Health, 117 database assertions, 95 bot tests/build, 242 shared backend tests/165 steps, all 65 HTTP modules, production frontend build, and trace preflight passed. Browser: 165 passed, two failed, 26 existing skips, zero flaky tests (4m18s). Runtime remained running with zero CPU hard-limit events, zero acquisition timeouts, and no OOM. |

The first failure was a fixture cleanup URL exceeding the gateway limit after
the `drop-movie` business assertions passed. Commit `ad4bb83` deletes exact cache
keys in batches and retains every cleanup error. Two network-disabled tests
against the installed Supabase client pass, including encoded URL limits and
partial failures. The other failure was the previous-season counterpick test's
obsolete exact error text. Its 400 rejection was correct; the corrected test
also checks no receipt or counterpick persists and the turn/phase remain intact.
These changes received independent simplification review. The full API step is
bounded at 20 minutes after the first shared/HTTP run took 14m50s; Edge CPU and
memory limits are unchanged.

Commit `0912d62` fixes a separately reproduced polling starvation bug: a
10-second poll could invalidate every successful 11-second snapshot, and repeated
invalidation could renew the read deadline indefinitely. Routine polling now
joins an in-flight read, and reconciliation shares one 15-second deadline.
Nine state/date/request regressions, TypeScript, and affected ESLint pass. The
new real-stack browser case passed: it delays the four actual REST snapshot
responses while WebSocket delivery is unavailable.

The two browser failures remain under investigation. The simultaneous selection
case received one 201 and one 403 (`It is not your turn to pick`) where the test
expected 409. The two-round journey successfully committed five picks, including
duplicate replay and a rejected stale slot, but the owner's browser remained at
one pick and did not show its returning turn. This is a real synchronization
blocker in a healthy runtime; the complete multiplayer gate remains open.

Twelve draft cases passed, including lost-response recovery, the complete
counterpick/activation/budget/initial-score journey, slow fallback polling, and
missed-pick recovery with actual refreshed Auth propagated to Realtime. The
recovery timing attachment records first/warm pick responses at 373/251 ms, both
201. All 167 unique traces have valid ZIP CRCs and parseable trace JSON (the two
artifact bundles contain identical paired copies). Five historical UI cases
passed; the simultaneous case cleared its previous search/card prerequisite and
reached the new response-status failure. No old UI assertion was relaxed.
The CI merge checkout and feature branch have the same Git tree. Sanitized
[first-run counts](release-evidence/draft-ci-34665036072.json) and
[second-run test outcomes/timings](release-evidence/draft-ci-34666240923.json)
are preserved in the repository; raw traces remain in the existing short-lived
failure artifacts and the task's local diagnostic directory.

Corrections after the second CI run:

- `22c7741` makes explicit stale-slot denials agree with SQL's 409 contract and
  rechecks receipts after a turn/phase change before rejecting. A duplicate that
  initially missed its receipt can now replay the concurrently committed result.
  Authentication and current-slot out-of-turn 403 remain intact; denied/replayed
  requests avoid metadata work. Actual-handler tests with stubbed transport
  reproduced the race first and now pass 25 steps with network disabled.
- `817e17b` resolves Auth before constructing the first
  subscription join and reconciles authoritative state every five seconds while
  subscribed. An installed-SDK test reproduced a tokenless buffered join before
  the Auth fix. That reproduction does not establish the cause of the original
  CI socket failure. Periodic reads prevent indefinite stale state independently
  of delivery, add four REST reads per open draft page every five seconds, and
  join any in-flight read rather than invalidating it.
- Eleven state/date/request regressions, TypeScript, and affected ESLint pass.
  Independent simplification reviews found no required changes. The browser
  suite adds a real socket test that suppresses only pick-change delivery; the
  existing concurrency/turn assertions are unchanged. The complete matching-source
  CI repeat is still required before release.
- CI now records allowlisted per-test outcomes/durations and the two recovery
  pick timings in its retained log, including successful runs. It excludes
  request IDs, attachment payloads, errors, headers, credentials, and raw runtime
  logs; failure-only raw artifact uploads remain unchanged. The report parser
  passed schema, extraction, and independent privacy/scope review.

The first clean HTTP run did not reproduce the 25.64-second pick. Sequential TAP
completion timestamps enclose a successful pick plus setup in 1.192 seconds, two
picks plus setup in 1.402 seconds, and a complete flow with six draft picks and
two counterpicks in 3.400 seconds. The final-pick/replay/mismatch-rejection case
fits within 1.357 seconds. These are conservative enclosing test windows, not
per-request latency measurements. CI retains the configured `oneshot` policy;
fresh request isolates still share runtime/module, Auth, and database resources.
This evidence does not measure a fully cold container or explain the old delay.

Vercel auto-deployment is disabled specifically for this feature branch using
[`git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled).
The Supabase workflow deploys on main pushes or manual dispatch only. This
continuation invoked neither deployment path. The connected Vercel CLI lacked
credentials, so project settings were not changed; repository Git configuration
and GitHub deployment records are the verification boundary.

### Critical journey evidence map

The HTTP/database checks below passed in the second clean CI run. Twelve of the
fourteen browser cases passed; the two concurrency failures above remain open.

| Requirement | Real-stack checks | Scope boundary |
| --- | --- | --- |
| Authorization and canonical metadata | `draft-authorization`, `movie-endpoints-auth`, `draft-pick`; database guard assertions | Actual Auth, RLS, Edge validation, and persisted-row checks; provider data is cached fixture data. |
| Discovery and selection | `draft-flow.spec.ts` owner search and changed query; `draft-readiness.spec.ts` empty eligible pages and retries | Browser/Edge/cache/database; no live provider success contract claimed. |
| Snake, consecutive turns, simultaneous picks, duplicates | `draft-transactions` service-role PostgREST RPC races; `draft-flow.spec.ts` two-round three-player journey and simultaneous selections | RPC races pass. Browser requests cross actual Edge/user Auth: duplicate replay and stale-slot rejection pass, but response classification and returning-owner synchronization remain open. |
| Lost response and recovery | `draft-transactions` final replay after activation; browser commit followed by response abort | Actual committed mutation and replay; the network fault is injected. |
| Disconnect, resume, refreshed Auth | `draft-recovery.spec.ts` missed picks, reconnect, refreshed JWT on the draft socket, later live pick | Real Auth/Realtime; forced disconnect and synthetic visibility events, not OS suspension or natural production outage. |
| Slow polling fallback | `draft-readiness.spec.ts` eleven-second actual REST responses with WebSocket unavailable | Actual persisted pick and mobile progress/turn assertions; transport delays are injected. |
| Counterpicks, activation, budgets, scores | `counterpick-flow` HTTP suite; browser three-player completion with budgets of 137 and exact initial score rows | Browser verifies pending/zero initial scores; HTTP scoring tests seed nonzero scores and verify inversion. |
| Failed activation and delivery recovery | `draft_transactions.sql` rollback/retry assertions; concurrent delivery claims through PostgREST RPC; shared notification tests | Database fault injection and actual lease RPCs; external delivery responses are stubbed. No messages sent. |

### Earlier verification evidence

The production build, affected frontend static checks, nine state/date/request
regressions, 117 database assertions, independent-connection race checks, and
nine notification tests pass. Earlier affected bot tests passed all 95 checks.
Controlled desktop/mobile preview tests cover keyboard interaction, slow and
failed submissions, duplicate clicks, turn loss, retry identity, and focus/scroll
restoration. The final 320px probe also passed the real request deadline plus
bounded reconciliation, same-key retry, footer clearance, and a live shared
header phase change, with no page errors. See the plan for each check's scope.

At the end of the September 11 local verification, the complete HTTP and
multiplayer browser gates were still open. The local Docker
VM is under measured memory pressure, and actual browser traces captured Auth
504 responses. The first targeted draft browser test passed owner start and
search. The complete configured browser run finished in 97.16 minutes with
**101 passed, 63 failed, 26 existing skips, and zero flaky tests** (190 total).
There were no retries or added skips. The eleven draft cases finished with one
waiting-player pass and ten failures; complete multiplayer mutation, replay,
and activation remain unverified through the real browser/API flow.
That run retained its original frontend build and 22:15 UTC backend snapshot
throughout the suite. They predate
the final mutation deadline, shared-header refresh, Auth error classification,
and notification refinements. The separate final-source build and 320px probe
cover the frontend refinements; final backend HTTP and affected browser checks
must use the matching final snapshot. The long run alone is not verification of
every final-source change.
Test edits also occurred during the run: a rating/NaN regex correction at 22:39
UTC (before the draft group ran), cache TTL/manifest handling at 22:52 UTC, and
cleanup error aggregation at 22:55 UTC, after the 22:33:58 UTC start. Race,
replay, and activation assertions were unchanged. The final test files did not
receive a complete run from setup through teardown; this remains part of the
open regression gate.
Runtime logs confirm seven CPU-limit terminations and two worker acquisition
timeouts; HTTP 546 failures remain unresolved until verified in a healthy runtime.
The modified handlers have no apparent new unbounded CPU work, but resource
pressure does not prove these failures harmless. Do not interpret passing
unit/database checks as a passing release gate.

The stable production-build WebSocket observation completed 1,802 seconds with
all seven scenarios passing and both real sessions Live, including real token
refresh and recovery after missed picks. Both sockets also disconnected together
when the isolated Realtime service restarted; the browsers recovered without a
manual refresh and received later picks. This demonstrates recovery, not clean
service uptime. The service process exit cause remains unproven, and the sample
does not identify every historical production disconnect. The installed-SDK
same-topic cleanup race is independently reproduced and fixed.

Local production builds also lack Vercel's two telemetry script endpoints. Those
scripts redirected to login HTML and raised syntax errors before login. The
browser test fixture substitutes empty scripts only for those exact localhost
hosting paths; application scripts, Auth, Realtime, and draft handlers remain real.

## Remaining release checks

| Gate | Current evidence | Required before deployment |
| --- | --- | --- |
| Auth and canonical pick HTTP contracts | `ad4bb83`: all 65 modules pass, 662 passing steps and four existing provider skips, real Auth/Edge/database | Reverify after the bounded handler fixes for stale response classification and preflight replay races. |
| Complete multiplayer draft | `ad4bb83`: browser activation/budgets/scores, lost-response recovery, and duplicate/stale-slot checks pass; two-round journey stops at the returning owner | Fix and verify the stale owner view and simultaneous-response classification, then finish the unchanged six-pick journey. |
| Socket reliability | `ad4bb83`: forced reconnect and real refreshed-token propagation pass; owner can remain stale while Live in the snake journey | Verify recovery from missing events without waiting indefinitely for an explicit channel error. Historical production disconnect cause remains unproven. |
| Full regression suite | `ad4bb83`: 165 passed, two failed, 26 existing skips; all 167 unique traces valid | Run the complete suite against the final matching application, handler, and test source after the remaining fixes. |

### Earlier diagnostic details (September 11)

The following preserves failed-run evidence. Current clean-CI outcomes and
remaining blockers are listed above; historical failures are not current passes.

One league-switcher accessibility case failed waiting for its first asynchronously
loaded option, before reaching the expected two-option count. A later snapshot
showed one option, but does not prove a missing-league defect. Read-only review
and the incomplete trace have not established a cause. Keep this failure
unresolved until a targeted rerun can inspect the returned league IDs.

Two legacy password-reset tests sent verification GETs to hardcoded local port
54321 even though their accounts and tokens came from 55421. The fast
`otp_expired` responses therefore establish a fixture-origin error, not a
reset-page defect. The email helper now uses the configured Supabase origin;
a network-disabled probe verifies recovery/signup query preservation. Signup
verification also checks that the exact account becomes confirmed instead of
accepting a login redirect alone. The final-source email suite now passes:
**13 passed, two existing skips, zero failures** in 10.38 seconds under Node
24.21.0, with all 13 traces valid and no residual test accounts. Both recovery
links and signup reached Auth on 55421 and the matching frontend on 3116. The
full run's isolation claim excludes its two misdirected legacy requests.

The first email follow-up under Node 26.7.0 completed its test bodies but all 13
executable cases timed out during trace finalization, leaving truncated ZIPs.
A separate no-network Playwright Test probe reproduced that failure with
installed Playwright 1.58.1; the identical probe passed under Node 24.21.0.
Changing only the email runner PATH to Node 24 produced the passing result above,
with tracing still enabled. CI used Node 20 then; no dependency or repository runtime
configuration changed during that earlier diagnosis. The continuation now pins
CI to Node 24.21.0. Use a verified runner for remaining browser checks.
This diagnosis does not reclassify earlier Auth/API failures or unresolved UI
assertions, and a full final-source regression run is still required.

The 26 UI/click failures were triaged individually: 14 have captured failed HTTP,
Auth, or login-redirect evidence; two are the proven recovery-origin fixture bug;
three had requests pending at failure; one received its expected rejection after
the assertion deadline; six remain unresolved. Those six require focused checks
for desktop bid submission after delayed data, the two draft search prerequisites,
metadata completion before full activation, switcher option loading, and the
season-completion pending dialog. These are follow-up checks, not six established
application defects. The other 37 failed tests stopped in Auth/fixture creation
or navigation. Truncated traces and later cleanup timeouts cannot establish the
cause of an earlier assertion.

Use the checked-in test guide and task-local environment files. Run database
checks before HTTP/browser suites because the SQL tests take table locks. The
browser configuration starts a fresh server by default; use `E2E_REUSE_SERVER=1`
only for an explicitly started server from the exact build under test. The new draft tests
replace external movie responses with scoped canonical cache fixtures; actual
Auth, RLS, draft handlers, and Realtime remain enabled. The broader legacy suite
also contains provider-failure/fallback tests using other synthetic movie IDs;
do not infer that the entire full-suite run was isolated from external providers.

The full browser run used local `oneshot`, which exits each worker after one
request. A final follow-up switched only the isolated verification stack to
`per_worker`, retaining image 1.68.4, normal Auth, and CPU/memory limits. Its cold
and warm start/details/pick/replay checks passed, with exactly one persisted pick
and cleaned fixtures. Cold start took 1.30s, details 2.18s, and pick 25.64s; replay
took 221ms. No 546 occurred in this small sample, but the first-pick latency
remains unexplained. This does not clear the broader HTTP/browser or performance
gate. The repository runtime policy was not changed.
Auth server processing was under a second for the slow probe pick, leaving the
delay before the observed Auth request unexplained. The subsequent sustained
HTTP run reproduced seven distinct CPU hard-limit terminations and Auth 504s. Worker
reuse therefore does not resolve the observed failure; the runtime gate remains
open.
The complete follow-up finished with 38 passing and 190 failing steps across
eleven failing modules; another 19 counterpick steps never started after Auth
sign-in failed. Of the 190 failures, 145 stopped in fixture helpers. Docker
confirmed the isolated Edge container was OOM-killed at 00:29:58.450 UTC, exit137;
later Kong 503s followed the dead backend. Deduplicated logs contain seven CPU
hard-limit isolates before exit. This explains many local cascades, not the
historical production socket incident. Exact integration fixture cleanup was
verified.
No Docker container memory cap was configured (`HostConfig.Memory=0`); the
worker limits were unchanged. That is consistent with the measured shared-VM
memory pressure, but does not establish acceptable memory use in a healthy
deployment.

The September 12 read-only follow-up narrows the slow request further. Preserved
runtime logs show dispatch at `00:18:57.190122470Z`, a fresh canonical cache hit
at `00:19:23.231346885Z`, and the next replay dispatch at
`00:19:23.322078385Z`, correlated to request
`9c2eeb46-9fc5-41a7-afcb-acbb312de354`. The serial probe begins replay only after
reading the original response, so the post-cache movie upsert, commit, and
response fit within approximately 91 ms. Provider fallback does not explain
this fresh cache hit. No CPU-limit event appears during this request. Worker
startup/imports, Auth, and pre-cache database requests remain indistinguishable
because those stages were not logged. Exact historical Auth timestamps are no
longer available in the preserved artifacts; the earlier subsecond Auth finding
is a recorded summary, not newly reproduced evidence. If a healthy run repeats
the delay, add request-correlated stage timings before changing runtime limits
or mutation behavior.

Three service-role checks also used a local token that differed from the active
Edge token. A hash-only comparison confirmed the mismatch; only ignored test
configuration was corrected. Those three checks remain pending a healthy
runtime. No production credential or authentication behavior was changed for
this fixture correction.
See [Supabase's worker policy documentation](https://supabase.com/docs/reference/cli/supabase-functions-serve)
and [hosted runtime limits](https://supabase.com/docs/guides/functions/limits).

### Reproducing the focused checks

From the repository root, `npm run test:draft:state` runs the state, date, and
request-deadline regressions, and `npm run build` builds the frontend. From
`supabase/functions`, load the local test environment explicitly when running
the network-disabled Auth/helper checks:

```sh
deno test --cached-only --allow-env --allow-read --env-file=.env.test \
  _shared/utils.test.ts _shared/test-invocation.test.ts
```

The affected HTTP modules are `movie-endpoints-auth`, `draft-authorization`,
`start-draft`, `draft-pick`, `draft-transactions`, `start-counterpick-round`,
`make-counterpick`, `counterpick-flow`, `create-league`, `join-league`, and
`update-league` under `supabase/functions/tests`. Run every module serially
against the migrated local stack, with external API tests disabled.

From `apps/frontend`, the affected browser gate is:

```sh
npx playwright test e2e/tests/draft --project=chromium --workers=1
```

Use the full configured browser suite for shared fixture changes. Preserve the
previous run's report before another run replaces the output directory. Tests
that fail during Auth/fixture setup remain unverified; tests that reach a failed
UI assertion require separate diagnosis.

## Deployment sequence after approval

There was one drafting league in the read-only production check on September 11,
2026, plus one setup and two active leagues. Arrange a release window with no
draft mutations from before migrations until matching backend versions are
verified. The new database guards and updated mutation handlers must be rolled
out together; the app has no automatic draft-pause control. The existing
Supabase workflow runs on pushes to main and applies migrations before deploying
functions in the same run. Coordinate any automatic frontend production promotion
before merging so it cannot race that backend rollout.

1. Recheck main, migration ordering, CI results, and all unresolved release gates.
   Preserve the existing production database; do not reset it.
2. The existing workflow must apply these new migrations in order:
   `20260911210659_protect_draft_order_and_start.sql`,
   `20260911212219_draft_notification_outbox.sql`, and
   `20260911215230_atomic_draft_picks_and_phases.sql`.
3. In that same run, deploy all Edge Functions through the existing
   [Supabase workflow](../.github/workflows/deploy-supabase.yml): changes to shared
   modules/config trigger its all-functions path. In particular, verify
   `start-draft`, `update-league`, `draft-pick`, `get-movie-details`, `browse-movies`,
   `search-movies`, `start-counterpick-round`, `make-counterpick`,
   `skip-counterpick-round`, and the new `process-draft-notifications`. Deploy the
   matching shared modules/config together. Authentication remains inside
   handlers; no production authentication-bypass flag is required.
4. Deploy the frontend, including its authenticated cron proxy and the
   once-per-minute notification schedule. Confirm existing cron/service
   credentials and the existing configured Discord destinations/preferences.
5. Verify the deployed migration/function/config versions together, then run a
   controlled complete draft with multiple accounts, interrupted connectivity,
   and counterpick completion. Confirm configured Fantasy Budgets, pending
   scores, and successful delivery job records before normal use resumes.
   Reopen or reload existing draft tabs so all participants use the new client
   submission keys and slot checks before allowing draft mutations again.

## Recovery and observability

- An uncertain pick response should be retried with its original JSON body
  `request_id` and `expected_pick`. This submission receipt key is distinct from
  the diagnostic `X-Request-Id` header/5xx error request ID. The UI also reconciles the confirmed pick from fresh state.
  Once another pick occupies that slot, a new attempt uses a new key.
- Failed finalization rolls back the final selection, phase, budget, score, and
  notification writes; retry the same selection after resolving the cause.
- A counterpick round with no available targets can be ended explicitly by its
  owner. Existing counterpicks remain; this does not run automatically.
- Inspect `job_runs` for the `process-draft-notifications` worker and aggregate
  `draft_notification_outbox` statuses. Pending entries retry with backoff;
  expired two-minute leases are reclaimable. Failed entries require inspection
  before any intentional requeue. Disabled channels/preferences are skipped.
- Delivery is at least once, not exactly once: a successful webhook followed by
  a lost acknowledgement can produce a duplicate on retry. Never include
  webhook URLs, tokens, or raw private payloads in review artifacts or logs.
- Keep schema additions if a frontend rollback is needed. Restoring old mutation
  handlers alone would conflict with the new guards; use a reviewed forward fix
  or a coordinated rollback plan instead of deleting migrations or resetting data.
  Preserve or restore the new notification cron proxy and schedule during a
  frontend rollback: the new backend enqueues deliveries, while the old frontend
  has no worker trigger. Otherwise pending notifications stop draining.

## Data completeness preflight

A read-only production check found 65 movies with no missing title, TMDb ID, or
release date. That check does not verify the correctness of every date, but it
does not indicate a completeness backfill. No production data repair is included
in this release. All four draft state tables were present in the production
Realtime publication.
