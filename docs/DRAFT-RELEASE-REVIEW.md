# Draft release review

Implementation branch: `codex/draft-production-readiness`, based on `2ca91c4`.
No push, merge, production migration, deployment, or external notification has
been performed. Verification status is tracked in
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

The production build, affected frontend static checks, nine state/date/request
regressions, 117 database assertions, independent-connection race checks, and
nine notification tests pass. Earlier affected bot tests passed all 95 checks.
Controlled desktop/mobile preview tests cover keyboard interaction, slow and
failed submissions, duplicate clicks, turn loss, retry identity, and focus/scroll
restoration. The final 320px probe also passed the real request deadline plus
bounded reconciliation, same-key retry, footer clearance, and a live shared
header phase change, with no page errors. See the plan for each check's scope.

The complete HTTP and multiplayer browser gates are still open. The local Docker
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
| Auth and canonical pick HTTP contracts | SQL/handler checks pass; actual Edge runs encountered Auth 504 and runtime 546 | Run the affected HTTP suites against a healthy local/staging runtime without bypassing authentication or raising runtime limits. |
| Complete multiplayer draft | Real owner start/search and waiting-player checks passed; integrity/race SQL checks passed | Complete real picks, lost-response replay, counterpicks, and activation through the browser/API. |
| Socket reliability | Installed-SDK cleanup race reproduced/fixed; 30-minute recovery sample passed its seven scenarios despite a service restart | Observe the deployed commit with matched backend versions, including background/resume and refreshed auth; investigate any natural disconnects with the new diagnostics. |
| Full regression suite | Full configured run: 101 passed, 63 failed, 26 existing skips; controlled final-source mobile checks pass | Review every final failure and rerun affected failures after their cause is resolved. |

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
with tracing still enabled. CI uses Node 20; no dependency or repository runtime
configuration changed. Use a verified runner for remaining browser checks.
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

## Data completeness preflight

A read-only production check found 65 movies with no missing title, TMDb ID, or
release date. That check does not verify the correctness of every date, but it
does not indicate a completeness backfill. No production data repair is included
in this release. All four draft state tables were present in the production
Realtime publication.
