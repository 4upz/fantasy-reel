# Local testing

## Commands

- `npm test` or `npm run test:unit`: infrastructure utility tests, shared Deno unit tests, and Discord bot tests. No Supabase services or third-party API keys required.
- `npm run test:integration`: backend integration tests against local Supabase.
- `npm run test:e2e`: complete desktop Chromium suite plus the mobile smoke project.
- `npm run test:all`: unit, integration, then complete browser suites.
- `npm run test:preflight`: read-only backend readiness check.
- `npm run test:functions:external`: opt-in contract checks that consume live TMDb/MDBList quota. Excluded from all default suites.

Node 20, npm dependencies, Docker, Supabase CLI (installed in the root workspace), Deno 2.6.4, and Playwright Chromium are required for the complete suite. Run `npm ci`, then `npx playwright install chromium` from `apps/frontend` when setting up a machine.

## Start local services

Start Docker and run `npx supabase start`. If Edge Functions are not responding, run `npx supabase functions serve` in another terminal. Local custom function environment variables can be supplied with `--env-file supabase/functions/.env.local` where needed.

The integration and E2E runners derive credentials from the running local stack, using the selected Edge Runtime’s exact service-role JWT because function authentication compares its literal value. They check auth, service-role database access, an actual unauthenticated Edge Function response, and exact migration versions before tests start. A reachable REST endpoint alone does not pass. Credentials are never printed by the runners.

Apply pending migrations with `npx supabase migration up`. Database-only migrations indicate a different checkout's schema: use a matching checkout or a separate local stack. Do not reset a development database to get tests running.

`TEST_SUPABASE_WORKDIR=/absolute/path` selects a separate local Supabase project for the runners. Its migrations must match this checkout, and its `config.toml` must use unique ports and a unique project ID. The runner propagates that stack's API credentials and email capture URL. This is useful when testing a branch while preserving a differently migrated development database.

## Browser ownership and authentication

Playwright starts its own fresh webpack development server on `http://localhost:3100`. It does not reuse an existing server; an occupied port fails before test setup. Select another local origin with `E2E_BASE_URL=http://localhost:3101`. Ensure Supabase Auth allows the chosen redirect origin. Each local test run uses a separate `.next-e2e` output directory, so an open development session cannot overwrite its build output.

CI builds the frontend first and starts a test-owned production server. Both desktop and mobile smoke checks run in CI. Browser fixtures preserve each project's device options, including touch, viewport and user agent.

Tests create their own users and authenticate through the UI to establish SSR cookies. Service-role access is limited to fixture setup, assertions and cleanup. For manual browser checks, use the seeded `alice@fantasyreel.test` / `testpass123!` account when available; automated tests do not depend on it.

## Test data isolation

Playwright generates one `E2E_RUN_ID` and shares it with setup, workers and teardown. Generated users, leagues and movie fixtures carry this run's identity. Each test's movie IDs also include worker, test and retry identity. Inserts fail on accidental ID collisions rather than overwriting an existing movie.

Cleanup paginates all users before deleting only accounts belonging to the current run and their leagues. Movie cleanup uses the run's fixture marker. It does not sweep other test runs or manual test accounts. If a process is forcibly killed, its fixtures may remain; do not reintroduce broad deletion to remove them. After confirming an interrupted run has stopped, clean only that run with `E2E_RUN_ID=<known-run-id> npm run test:e2e -- --project=teardown`.

## Coverage and verification

Shared unit tests cover scoring, bidding resolution, trading validation, notification payloads and HTTP/cache behavior. Integration tests exercise real local auth, RLS, migrations and Edge Functions. Browser discovery mocks intercept the movie discovery Edge Function responses, so discovery backend behavior is covered separately by backend tests; transactions remain real.

Mobile smoke covers bottom navigation and roster expansion, drafting, bidding and trade acceptance. Multi-user desktop tests cover realtime picks and turn/progress changes, outbid notifications, and commissioner veto after acceptance.

After implementation, run code simplification before verification. For changes to E2E infrastructure or tests, run the complete browser suite after simplification. Use traces and screenshots on failure; fix infrastructure and fixture problems before loosening assertions. Unit and bot suites also run in their own CI workflow.
