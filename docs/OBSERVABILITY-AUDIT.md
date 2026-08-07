# Observability & Metrics Audit

Audit of Fantasy Reel's observability posture across the Next.js frontend (Vercel), Supabase Edge Functions, database, and Discord bot. Covers what exists today (including what the platforms provide out of the box), the gaps, and a prioritized set of recommendations.

**Date:** 2026-08-07

---

## 1. What exists today

### 1.1 Platform-provided (no code required)

| Platform | What you get | Caveats |
|---|---|---|
| **Vercel Analytics** (`@vercel/analytics`, installed and wired in `app/layout.tsx`) | Page views, visitors, referrers, Web Vitals in the Vercel dashboard | No custom events — zero `track()` calls exist in the codebase, so no feature-level usage data (drafts made, bids placed, trades proposed) |
| **Vercel runtime logs** | stdout/stderr from API routes and middleware | Short retention on lower tiers; unstructured; nobody is alerted |
| **Vercel cron dashboard** | Per-invocation status code + duration for the 7 cron entries in `apps/frontend/vercel.json` | Only sees the HTTP status of the proxy route — and partial failures return 200 (see §2.2), so the dashboard shows green even for degraded runs |
| **Supabase Edge Function logs & metrics** | Per-function invocation logs, error counts, and execution-time charts in the dashboard Logs Explorer | Retention is limited by plan (roughly 1 day free / 7 days Pro); logs are unstructured prose; no alerting; log drains require the Team plan |
| **Supabase database observability** | Query performance dashboard, index/security advisors, API request logs | Reactive — you have to go look; `pg_stat_statements` insights only via dashboard |
| **Supabase Auth logs** | Sign-in/sign-up event logs | Same retention/alerting caveats |

### 1.2 In-repo observability (what the code does)

**Frontend (`apps/frontend`):**
- 45 `console.error` + 3 `console.warn` call sites (and, positively, zero stray `console.log`). All terminal — nothing is forwarded to any sink.
- User-facing errors surface via `sonner` toasts (~69 call sites) — users see errors, but you never do.
- `utils/supabase/functions.ts` → `callEdgeFunction()` is a well-designed choke point used by ~28 call sites in 21 files. It is currently uninstrumented, and its `FunctionsHttpError` branch returns the error **without even a console log**.
- `hooks/useAsyncAction.ts` wraps most mutating actions in try/catch — another ready-made instrumentation seam, currently unused for telemetry.
- Realtime connection health is tracked in `DraftClient.tsx` and shown via `ConnectionStatusIndicator.tsx` (connected / reconnecting / error, with polling fallback) — but degradation is never recorded, so realtime reliability is unmeasurable.

**Edge Functions (`supabase/functions`, 41 functions):**
- ~250 ad-hoc `console.*` call sites. No shared logger, no log levels, no structured JSON, no request/correlation IDs. Concurrent invocations are indistinguishable in the log stream.
- `_shared/utils.ts` has disciplined, consistently-used `errorResponse` / `jsonResponse` helpers. 500 bodies are deliberately opaque (good for security) but carry no error ID, so a user-reported "Internal server error" can't be tied to a log line.
- **Two genuinely good pieces of persisted telemetry**, both narrow and unconsumed:
  - `notification_log` table + `failed_notifications` view (migration `20260201_add_notification_log.sql`) — records sent/failed/skipped email delivery with error messages. **Wired up only for trade emails**; bid, counterpick, invitation, and announcement emails log failures to console only. The schema explicitly anticipated generalization (`metadata JSONB`, nullable `trade_offer_id`) but it never happened.
  - `discord_channels.consecutive_failures` / `last_error_at` — per-webhook health tracking in `_shared/discord.ts`. Nothing reads or acts on the counter (no auto-disable, no alert), and the increment is a non-atomic read-then-write.

**Discord bot (`apps/discord-bot`):**
- The best-instrumented service, relatively: an HTTP health endpoint on port 3001 tied to `client.isReady()`, a Docker `HEALTHCHECK`, top-level interaction error handling, graceful shutdown. Logging is console-only (36 call sites).

---

## 2. Gaps

### 2.1 No error tracking anywhere (highest-impact gap)

- No Sentry / PostHog / LogRocket / Datadog / OpenTelemetry — nothing, in any workspace.
- **No React error boundaries at all.** No `error.tsx`, no `global-error.tsx`, no `not-found.tsx` anywhere in the app tree. An uncaught render error white-screens the user with Next's default fallback and leaves no trace. (Note: `app/error/page.tsx` looks like a boundary but is just a static OAuth-failure redirect target.)
- No `instrumentation.ts` / `instrumentation-client.ts`, no `onRequestError` hook, no `window.onerror` / `unhandledrejection` listener, no `reportWebVitals`.
- Net effect: **the only way you learn about a production error today is a user telling you.**

### 2.2 Cron jobs — the app's core logic — fail invisibly

The crons run bid processing, scoring, trade processing, and announcements. Their failure modes:

- **Partial failure returns HTTP 200.** `process-bids`, `process-trades`, and `update-scores` all accumulate per-item `errors[]` arrays and return them in a 200 response. `proxyCronRequest.ts` relays the body to Vercel, which stores only the status code — the error arrays are computed, serialized, and **thrown away**. A run where every movie fails MDBList lookup is a green check.
- **No run persistence.** No `job_runs`-style table exists in any of the 52 migrations. Run outcomes exist only in ephemeral logs and discarded response bodies.
- **`process-trades` is the least observable path in the system.** It runs via pg_cron every 5 minutes (`20260129_trade_processing_cron.sql`) using fire-and-forget `net.http_post`. The response lands in `net._http_response` and `cron.job_run_details` — neither is queried anywhere.
- Fire-and-forget email sends inside `process-bids` (`.catch(err => console.error(...))`) sit outside the `errors[]` accumulator — a user silently not receiving a "you won the bid" email never appears even in the discarded payload.

### 2.3 No timeouts, no retries, no latency data

- **Zero `AbortController` / `AbortSignal.timeout()` in the entire codebase.** Every outbound fetch (TMDb, MDBList, Resend, Discord) can hang until the runtime kills the worker — the most likely cause of a silent cron stall.
- **Zero retries.** One transient MDBList 503 costs a movie its score until the next 12-hourly run.
- **Zero timing measurement.** No `performance.now`, no duration logging anywhere. `update-scores` does up to 30 movies × (MDBList round-trip + 50 ms delay) plus Discord fan-out at 450 ms/message against the proxy's `maxDuration = 60` — and nothing tells you how close to that ceiling it runs.
- Discord 429s ignore `retry_after` (acknowledged in a code comment).

### 2.4 Silent error swallowing

Seven bare `catch` blocks in production Edge Function code. Worst offenders:
- `_shared/scoring.ts:131` — `fetchImdbId` returns `null` on any TMDb failure, fully silently; "no IMDb ID exists" and "TMDb is down" are indistinguishable.
- `_shared/scoring.ts:103` — all MDBList failure modes collapse to one error string, underlying exception discarded.
- `update-scores/index.ts:15` — malformed cron request body silently becomes a full default sweep.

Frontend: `utils/supabase/middleware.ts` runs `auth.getUser()` on every page request and **discards the auth error entirely**; `app/page.tsx` falls back to hardcoded movies on TMDb failure with only a console line — a persistent TMDb outage degrades the landing page invisibly.

### 2.5 Instrumentation choke point is leaky

`callEdgeFunction` covers ~80% of Edge Function traffic, but:
- `useTrading.ts` hand-rolls **6 raw `fetch()` calls** with manual auth headers — the entire trading feature bypasses the shared path, and several of its catch blocks don't even console.error.
- `link-account/actions.ts` invokes `merge-accounts` directly.

### 2.6 No health checks or uptime monitoring (except the bot)

No `/api/health` endpoint, no post-deploy smoke checks in any of the three GitHub workflows, no external uptime probes. The Discord bot is the only service with a health endpoint.

### 2.7 No product usage metrics

Beyond page views, there is no data on what users actually do: drafts completed, bids placed, trades proposed/accepted, league activity, retention. All the natural funnels (signup → create/join league → draft → bid/trade) are unmeasured.

---

## 3. Recommendations

Ordered by leverage-per-effort. Tier 1 items are each roughly a day or less and close the "flying blind" gaps; the app's existing seams (`callEdgeFunction`, `useAsyncAction`, `notification_log`, `errorResponse`) make most of them small diffs.

### Tier 1 — do these first

**1. Add error tracking (Sentry is the natural fit).**
- Frontend: `@sentry/nextjs` gives `instrumentation.ts`/`instrumentation-client.ts`, `onRequestError`, and session replay. Add `error.tsx` + `global-error.tsx` boundaries at the same time (worth doing even without Sentry — the current white-screen behavior is a user-experience bug in its own right).
- Edge Functions: Sentry's Deno SDK works in Supabase Edge Functions; initialize it in a small `_shared/monitoring.ts` and call `captureException` from the outer catch in each function (or wrap the handler once).
- Free tier is generous enough for an app this size. Alternatives: PostHog (if you want error tracking + product analytics in one tool, see Tier 2), or Axiom/Logtail as a log-drain-centric approach.

**2. Persist cron run outcomes and make failures non-green.**
- Add a `job_runs` table: `(id, job_name, started_at, finished_at, duration_ms, status ok|partial|failed, items_processed, items_failed, errors jsonb)`. The payloads already exist — `proxyCronRequest.ts` currently throws them away, and each cron function already builds the `errors[]` array.
- Cheapest write path: have each cron Edge Function insert its own summary row at the end of the run (service-role client is already in hand).
- Change `proxyCronRequest.ts` to return a non-2xx when the Edge Function reports `failed > 0` / non-empty `errors[]`, so the Vercel cron dashboard actually reflects reality.
- For `process-trades` (pg_cron): either migrate it to the same Vercel-cron-proxy pattern as everything else (consistency + visibility), or at minimum add the `job_runs` insert inside the function and periodically inspect `cron.job_run_details`.

**3. Add fetch timeouts everywhere.**
- `AbortSignal.timeout(10_000)` (tune per API) on every outbound fetch in `_shared/scoring.ts`, `_shared/email.ts`, `_shared/discord.ts`, the TMDb call sites, and `proxyCronRequest.ts`. This is a mechanical change and eliminates the whole "cron silently hangs" failure class.
- While in there: honor Discord's `retry_after` on 429, and add a single retry with backoff for idempotent GETs (TMDb/MDBList).

**4. Add a tiny shared structured logger for Edge Functions.**
- `_shared/logger.ts`: emits one-line JSON (`{level, fn, requestId, msg, ...fields}`), with a per-invocation `requestId = crypto.randomUUID()`.
- Echo the `requestId` in `errorResponse` 500 bodies (`{ error: 'Internal server error', request_id }`) — keeps details opaque but makes any user report traceable to exact log lines in the Supabase dashboard.
- Migrate incrementally: start with the outer catches and the cron functions; don't boil the ocean on all 250 call sites.

**5. Generalize `notification_log` to all email paths.**
- The schema was explicitly designed for this (`metadata JSONB`). Route bid won/lost, counterpick, invitation, and announcement emails through `logNotificationDelivery` — mostly plumbing, since the trade path already shows the pattern.
- Actually consume the existing `failed_notifications` view: at minimum, a periodic check; ideally an alert (see #6).

**6. Wire alerts to Discord — you already have the infrastructure.**
- `_shared/discord.ts` already sends webhooks. Add an `alertOps(message)` helper pointed at a private "ops" channel webhook, and call it on: cron run with `status != 'ok'`, `consecutive_failures` crossing a threshold on any Discord channel, and repeated email delivery failures. This is nearly free and turns several "unconsumed telemetry" items into actual alerting.

### Tier 2 — meaningful upgrades

**7. Product analytics / custom events.**
- Cheapest path: `track()` from the already-installed `@vercel/analytics` for the key funnel events (league created/joined, draft started/completed, pick made, bid placed, trade proposed/accepted).
- If you want funnels, retention, and user-level analysis, PostHog is the better tool and can also absorb error tracking (alternative to Sentry in #1 — pick one stack, not both).

**8. Instrument the Edge Function call path.**
- Migrate `useTrading.ts`'s six raw fetches to `callEdgeFunction`, making it a true single choke point (also fixes its silent catch blocks).
- Then add timing + failure capture in `callEdgeFunction` (duration, function name, status) and report to whatever you chose in #1/#7. One diff instruments ~all client→backend traffic.
- Add a global `SWRConfig onError` in `app/providers.tsx` to catch polling-path errors.

**9. Health endpoint + uptime monitoring.**
- Add `/api/health` (checks Supabase reachability; optionally TMDb) and point a free external monitor (UptimeRobot, Better Stack, etc.) at it and at the landing page. The Discord bot's port-3001 endpoint can join the same monitor if it's network-reachable.
- Add `@vercel/speed-insights` alongside the existing Analytics for real-user performance data (one-line change).

**10. Measure the things currently invisible.**
- Log realtime channel degradation (`CHANNEL_ERROR` / `TIMED_OUT` / fallback-to-polling) from `DraftClient.tsx` as an event — realtime reliability during drafts is a core UX concern and currently unmeasurable.
- Add duration logging to cron functions (`started_at`/`finished_at` in `job_runs` covers this) so you can see `update-scores` drift toward its 60s ceiling before it starts failing.
- Fix the middleware to at least log discarded `auth.getUser()` errors.

### Tier 3 — when the app grows

- **Supabase log drains** (Team plan) or a lightweight shipper to Axiom/Datadog once dashboard retention becomes a real constraint.
- **OpenTelemetry tracing** across frontend → Edge Function → external APIs — worthwhile only after Tiers 1–2; a `requestId` passed in a header from `callEdgeFunction` to the Edge Function logger gets you 70% of the value for 5% of the cost, and is a sensible precursor.
- **Fix `trackFailure`'s non-atomic increment** in `_shared/discord.ts` with a real RPC (`UPDATE ... SET consecutive_failures = consecutive_failures + 1`).
- **Alert routing/on-call** (PagerDuty-style) — overkill until there are users whose leagues break at 3am.

---

## 4. Suggested sequencing

Roughly, as three small milestones:

1. **"Know when it breaks"** — Sentry (both tiers) + error boundaries + `job_runs` + non-green partial failures + Discord ops alerts. *(items 1, 2, 6)*
2. **"Stop it breaking silently"** — fetch timeouts/retries + shared logger with request IDs + generalized `notification_log`. *(items 3, 4, 5)*
3. **"Know how it's used and how it performs"** — custom events, `callEdgeFunction` instrumentation + `useTrading` migration, health endpoint + uptime, Speed Insights, realtime reliability events. *(items 7–10)*
