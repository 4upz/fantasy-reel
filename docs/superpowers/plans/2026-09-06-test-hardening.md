# Local testing hardening implementation plan

Goal: make local and CI verification comprehensive, deterministic, and isolated across concurrent runs.

Approved scope: repair the shared trade fixture; expose unit, integration, browser and aggregate commands; run fast suites in CI; verify local runtime, credentials, migration state and frontend ownership; scope E2E cleanup to each run; add mobile smoke and multi-user transaction journeys.

## Agent team strategy
Topography: Test Hardening
- lead: local preflight and runners, integration, simplification, verification, commit.
- backend_tests: package scripts, Deno fixture, fast-suite CI, backend docs.
- browser_isolation: run IDs, cleanup, Playwright server ownership and mobile smoke.
- browser_journeys: real draft propagation, outbid and trade review tests.

## Handoff contracts
- `E2E_RUN_ID`: generated once in Playwright config, inherited by all workers and teardown; restricted to a safe identifier alphabet.
- Local `E2E_BASE_URL`: defaults to http://localhost:3100; Playwright owns the server and passes the URL's port to Next. CI uses the same explicit ownership.
- `node scripts/test-preflight.mjs`: read-only backend checks; `--e2e` also ensures intended frontend port is free.
- `node scripts/run-integration-tests.mjs [task]`: derive local credentials after preflight, run Deno task from functions directory.
- `node --test scripts/*.test.mjs`: tests for infrastructure utilities, included in fast suite.

## Work
- [x] Repair backend fixture and commands, add CI.
- [x] Add run-scoped cleanup and mobile browser coverage.
- [x] Complete multi-user journeys.
- [x] Implement preflight with safe local URL, credential, Edge Runtime, migration and port checks.
- [x] Update local testing guide.
- [x] Run simplifier after integration; verify final fast, integration and complete browser suites.
- [x] Inspect status/diff; include task changes only in the commit.

No reset of the user's database; pending migrations require only migration up. Keep live external API tests opt-in.

## Verification notes
- Fast suites: 19 infrastructure script tests, 210 shared Deno tests (129 steps), and 85 Discord bot tests passed.
- Complete backend integration suite: 60 passed (605 steps), zero failures; nine opt-in external steps ignored.
- Complete browser suite: 161 passed, 24 existing skips, no failures or retries.
- Frontend TypeScript check and diff whitespace check passed.
- Verification used separate local Supabase projects because the development database contains five migrations absent from this checkout. No development data was reset.
- The backend suite exposed an existing counterpick defect: a valid outbid candidate could be cancelled because only leading bids' holdings were preloaded. The narrow fix loads holdings for all candidates in each selected contest; the existing integration regression exercises promotion after invalid leaders are removed.
