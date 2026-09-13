# Fantasy Reel — agent guide

Next.js 15 + React 19 + TypeScript + Tailwind CSS 4, Supabase, and a Discord bot.
The Vercel frontend project is `fantasy-reel-frontend`.

## Working agreement

- Carry action requests through implementation, simplification, verification, and
  commit. Make routine, reversible decisions from user intent and existing code.
  Ask only when missing information materially changes the result or an action
  exceeds authorized scope; continue independent work meanwhile.
- Existing authorization persists. Prepare a concrete result before requesting
  necessary approval. A timeout is not consent.
- Follow system/developer instructions, then the user's current request. These
  repo rules govern Codex workflows; skills provide task-specific guidance. Before
  a skill causes a pause, check applicability and existing authorization. If still
  blocked, identify the exact file and instruction and explain the decision needed.
- Load relevant skills and reference sections on demand. Do not read every skill
  or all of `CLAUDE.md` at startup. It retains detailed domain reference material
  and Claude workflows; use this file for Codex workflow decisions.
- Use the installed Vercel plugin's React guidance and the connected Supabase
  plugin's Supabase/Postgres guidance; read relevant rules rather than complete
  compiled manuals. When overlapping skills cover the same task, choose one
  suitable entry point. Keep recommendations compatible with installed versions
  and the repo's migration workflow; a review is not authorization to migrate
  frameworks or change the design system. UI accessibility audits use the local
  `web-design-guidelines` skill. Ordinary work needs no separate Superpowers or
  Superdesign workflow.
- Use tools available in the session. If a named plugin, agent type, or browser
  tool is unavailable, use an equivalent capability and report any verification
  gap. Do not invent tool calls or require installation when a fallback suffices.
- Report outcomes in concise, plain prose: changes, verification, and material
  limitations. Avoid repeated plans and claiming success for checks not run.

## Workflow and delegation

1. Inspect `git status`, relevant instructions, and existing patterns. Preserve
   unrelated work. Use `rg` and batch independent reads; load only useful context.
2. For bugs, form 2–3 plausible hypotheses and validate them before fixing. If a
   fix fails, revisit assumptions. For E2E failures, inspect auth, database setup,
   fixture isolation, and parallelization before changing assertions.
3. Use a short plan for multi-step changes. Delegate when two independent work
   streams improve time or quality, especially across frontend/backend/DB. Stay
   local for small changes, exploration-only work, or sequential work. Define
   bounded file ownership and shared types, columns, and API contracts before
   parallel edits. Continue useful local work while agents run.
4. After implementation, run the code-simplifier agent on modified files. If that
   agent type is unavailable, assign a general agent a bounded simplification
   review, or review locally if delegation is unavailable. Preserve behavior and
   scope. Finish simplification before verification. The lead owns integration
   and commits.
5. Verify the final change using the rules below. Broaden or repeat checks only
   for new edits, failures, or unresolved risks. Complete required checks, then
   finish; do not add tests that merely restate a trivial edit.
6. Before committing, inspect `git status`, `git diff --stat`, and the staged diff.
   Stage all task-related files by explicit path; leave unrelated changes alone.
   Push, merge, and deployment require authorization for those actions.

## Verification

Check script definitions in the current root `package.json` and the relevant
local testing guide before assuming command scope or prerequisites.

| Change | Verification |
| --- | --- |
| Documentation/instructions | Diff/whitespace checks, referenced paths, conflicting rules; no app build or browser run. |
| Shared logic/backend | Relevant Deno/bot tests; integration checks for auth, RLS, persistence, or Edge contracts. |
| Frontend/UI behavior | Relevant static checks and browser interaction after simplification, including affected mobile states and errors. |
| Test files/infrastructure | Full affected suite; complete browser suite for E2E changes, accounting for shared state and parallel workers. |
| Build/dependencies | Relevant build and affected suites. |

For manual UI verification, restart the task's dev server with `npm run dev`.
Do not kill unrelated servers. If Playwright owns the server, use its fresh-server
lifecycle. Use available browser automation or Playwright. Prefer `data-testid`
selectors; desktop navigation may be hidden on mobile. Auth uses SSR cookies,
not localStorage. Seeded local login: `alice@fantasyreel.test` / `testpass123!`
(also bob, carol, dave). If missing, use test fixture setup or create local test
users; never reset a database just to obtain accounts. Copy `.env.local` when
creating a test worktree; never print or commit secrets.

## Code map and UI

- `apps/frontend/app/`: routes, layouts, global styles, error boundaries.
- `apps/frontend/components/`, `hooks/`, `utils/`, `types/`: shared UI/contracts.
- `supabase/functions/`: Edge Functions; `_shared/`: reusable backend logic.
- `supabase/migrations/`: schema/RLS; `apps/discord-bot/`: Discord integration.
- Use direct Supabase with RLS for simple CRUD, Edge Functions for complex
  validation/external APIs, and Realtime for updates. No separate backend service.

For UI changes use the `frontend-design` skill first and inspect existing
components. Follow Cinematic Dark tokens in `apps/frontend/app/globals.css` and
the canonical [typography guide](docs/brand/typography.md), implemented in
`apps/frontend/app/typography.css`. Use role-based `type-*` classes: Bricolage for
expressive headings and tabular numeric roles; DM Sans for body, controls,
compact movie/team titles, and metadata. Do not assign `font-display` by heading
tag alone. Numeric roles use optical size 12 and width 100; DM Sans does not
provide tabular digits in the bundled file. Use `foreground-secondary` for
meaningful small text on cards/inputs and keep functional metadata at least 12px.
Keep gold interactive accents, existing animations, and `.card`, `.btn-*`,
`.input`, `.badge-*`, `.alert-*` classes. Reuse the approved logo/icon assets in
`apps/frontend/public/brand/v1/`; see [brand guidance](docs/brand/README.md).
For illustration or graphic work, read the canonical
[illustration guide](docs/brand/illustrations.md): one Storybook family with full
and minimal detail levels, sized to the placement. Its concepts are references
for requested work, not instructions to roll illustrations out across screens.
Use `hooks/useAsyncAction.ts` for async submissions to prevent duplicate requests;
wrap actions in `useCallback`. Keep both error boundaries in sync with design
changes. Display “Fantasy Budget” or “Budget”; retain existing `faab` schema/JSON
identifiers. See the relevant design section in `CLAUDE.md` for token details.

## Data and deployment invariants

- Development uses local Supabase (`npx supabase start`, Docker required).
  Apply pending migrations with `npx supabase migration up`. `db reset` destroys
  data and requires explicit authorization to wipe that database; back up first.
  Never use a reset to work around test setup failures.
- New migration timestamps must sort after every migration already on main;
  recheck before integration/deployment. Do not edit applied migrations.
- For Supabase/PostgREST failures check FKs, RLS, `config.toml`, and migration
  status. Disambiguate multiple FKs with constraint names. Policies use
  `(SELECT auth.uid())`, `TO authenticated`, helpers to avoid recursion, and indexes.
- Functions authenticate internally. Existing `verify_jwt = false` config entries
  support the project's JWT compatibility workaround, not unauthenticated access.
  New functions require `[functions.<name>]` entries with `verify_jwt = false`
  and internal authentication. Never add production bypass flags such as
  `--no-verify-jwt` without explicit approval. For authorized deployment, verify
  deployed functions, config entries, and applied migrations together.
- Use `NEXT_PUBLIC_SITE_URL` client-side and `SITE_URL` server-side. Ask before
  introducing an alternative such as `APP_URL`.
- Read active rosters through `team_holdings`, not separate draft/pickup queries.
  Its flat columns include `movie_status`, `source`, and `holding_id`; dropped rows
  are excluded. Use `utils/holdings.ts` / `TeamHolding` or
  `_shared/roster-holdings.ts`. Writes, dropped-row history, and Realtime still
  target base tables.
- Rotten Tomatoes alone drives fantasy points; absent RT is NULL/Pending.
  See `supabase/SCORING.md` for the curve; IMDb/Metacritic are display context.
- Resolve pickup and counterpick contests together in `_shared/bid-resolution.ts`.
  Recheck pooled capacity, budget, and drop allowance between awards. Pending bids
  may exceed capacity; priority orders a team's own wins, not competing bidders.
- Competing trades are allowed at proposal time. Execution locks and revalidates
  ownership. Only `process-trades` and `approve-trade` execute trades; check the
  `execute_trade()` result's `success` and share completion notifications.
- Counterpicks survive drops and are tradeable. Judge ownership after the trade:
  a team cannot hold a movie and its counterpick. Move holdings first, then settle
  both counterpick team columns together; sync denormalized flags and scores.
  Read `CLAUDE.md`'s bidding/trading/counterpick sections before changing those rules.

## Observability Conventions

Tier 1 of `docs/OBSERVABILITY-AUDIT.md` is implemented. Use these primitives — do not add ad-hoc `console.*` logging or raw `fetch` calls in Edge Functions:

- **Structured logs:** `createLogger('<function-name>')` from `_shared/logger.ts` — one JSON line per event with `level`, `fn`, `request_id`, `msg`, plus fields. Serialize caught errors with `serializeError(err)` (includes Postgrest `code`/`details`/`hint`).
- **Request IDs:** every response carries `X-Request-Id`; 5xx bodies include `request_id`. Set automatically via `handleCorsPreflightRequest` → `setRequestContext`. An inbound `x-request-id` header is honored (for future frontend correlation).
- **Outer catches:** end every function's outer catch with `return internalErrorResponse(error, log)` (logs + Sentry + opaque 500). Sentry in Edge Functions activates only when the `SENTRY_DSN` secret is set.
- **Outbound HTTP:** use `fetchWithTimeout` / `fetchWithRetry` from `_shared/http.ts` — never bare `fetch`. Retries are for idempotent GETs only.
- **Cron functions:** record outcomes with `startJobRun(name)` → `run.finish(client, { processed, failed, errors, metadata })` (or `run.fail` in the catch) into the `job_runs` table, and include `job_status` in the response JSON. `proxyCronRequest` turns non-`ok` job_status into HTTP 500 so Vercel's cron dashboard shows degraded runs. All scheduled jobs (including process-trades) run via Vercel Cron → `/api/cron/*` — do not add pg_cron jobs.
- **Email sends:** log every delivery outcome through `logNotificationDelivery` (`_shared/notification-log.ts`, service-role client required) with a stable snake_case `notification_type`. Query the `failed_notifications` view for failures.
- **Ops alerts:** `alertOps(title, fields)` from `_shared/ops-alerts.ts` posts to the private ops Discord channel (`OPS_DISCORD_WEBHOOK_URL` secret; no-op when unset). Fires automatically on non-ok job runs and webhook health threshold crossings — reserve manual calls for genuinely actionable conditions.
- **Frontend errors:** `@sentry/nextjs` is wired via `instrumentation.ts` / `instrumentation-client.ts`, active only when `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` are set. `app/error.tsx` and `app/global-error.tsx` are the error boundaries — keep them in sync with design-system changes.
- **TMDb cache telemetry:** every cache decision emits a `tmdb_cache.requests` Sentry counter metric (attributes `cache_status`, `cache_namespace` — bounded enums only, never raw keys) via `recordCacheOutcome` (`_shared/monitoring.ts`), and stale-serving threshold crossings raise one grouped Sentry error event for frequency alerting. No-ops without the `SENTRY_DSN` secret. Client-side latency comes free from the existing browser tracing (`http.client` spans on every `callEdgeFunction`).
- **Edge Function calls from the frontend:** always go through `callEdgeFunction` (`utils/supabase/functions.ts`) — never raw `fetch` to `/functions/v1/*`. It sends a client `x-request-id`, records duration/status Sentry breadcrumbs, and captures unexpected failures.
- **Product events:** `trackEvent(name, props)` from `utils/analytics.ts` (wraps Vercel Analytics). Fire only on success paths, ids-only props (no names/emails). Canonical event names are listed in that file's doc comment — reuse them, don't invent variants.
- **Health:** `/api/health` probes Supabase reachability (200/503) for external uptime monitors — keep it dependency-light and unauthenticated.

---

## References (read relevant sections only)

- `CLAUDE.md`: detailed design, draft discovery, bidding, trading, and counterpick
  policy. Current code/migrations establish implementation facts.
- `docs/brand/typography.md`: canonical role scale, font settings, accessibility,
  and component mapping; `docs/brand/README.md`: approved logo/icon use.
- `supabase/functions/TESTING.md`: Deno testing setup and commands.
- `supabase/README.md`: local Supabase setup.
- `supabase/SCORING.md`: scoring architecture.
- `docs/OAUTH.md`: Discord OAuth.
- `docs/ASTRA-REPO-GUIDANCE.md`: rationale and evaluation of this instruction audit.
