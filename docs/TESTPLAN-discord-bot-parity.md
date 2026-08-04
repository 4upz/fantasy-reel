# Test & Verification Plan — Discord Bot Parity

Companion to `PLAN-discord-bot-parity.md`. Every implementing agent must read both. This file
defines the definition of done for each epic and the exact commands used to verify work.

## Environment facts (verified 2026-08-04)

- Work happens in the git worktree at `.claude/worktrees/discord-bot-parity-plan`. Do **not**
  create nested worktrees, do **not** commit or push — the orchestrator owns all commits.
- Local Supabase is running at `http://127.0.0.1:54321` and is **shared with the main checkout**.
  Never run `supabase db reset` or `supabase stop`. Apply new migrations with
  `npx supabase migration up` only.
- Migration filenames MUST use the full-timestamp format `YYYYMMDDHHMMSS_description.sql`
  (create via `npx supabase migration new <name>`). Date-only prefixes previously broke
  `supabase db push` and were renamed in commit `1ffe1d4`.
- Edge Function **integration** tests (`supabase/functions/tests/`) invoke functions over HTTP.
  The running edge runtime serves the **main checkout's** code, so integration tests cannot see
  worktree changes. The orchestrator handles integration verification by running
  `npx supabase functions serve` from the worktree. Implementing agents therefore verify via
  **mock-based unit tests** and must not assume integration tests exercise their new code.
- Baselines (all must stay green): `apps/discord-bot` `tsc --noEmit` clean · bot vitest (currently
  0 tests — Epic A establishes the harness) · `deno task test:unit` 74 passed ·
  `deno task test` (integration) 35 files passed.

## Verification commands

```bash
# Bot (from apps/discord-bot/)
npx tsc --noEmit          # must be clean
npx vitest run            # all tests pass

# Edge Functions (from supabase/functions/)
deno task test:unit       # mock-based, safe from worktree
deno task test            # integration — orchestrator-run, needs worktree `functions serve`
```

## Global definition of done (every task, every epic)

1. Typecheck clean; **all pre-existing tests still pass**.
2. New unit tests written and passing for every new command/function/helper.
3. The three universal states are handled and tested: channel not linked, empty data, and
   Supabase/fetch error (reply with a friendly error embed, never an unhandled rejection).
4. Embed quality rubric (below) satisfied.
5. `webhook_url` is never selected client-side, logged, or echoed into replies.
6. Nothing committed; leave the working tree dirty for orchestrator review.

## Embed quality rubric

- Colors follow the documented semantics in `_shared/discord.ts` / `utils/embeds.ts`
  `DISCORD_COLORS`: gold = event/info about league activity, green = resolved positively,
  crimson = negative, blue = FYI/command responses, yellow = user action needed.
- Every league-scoped embed sets the author line (league name linking to the league page,
  Fantasy Reel icon) — use the existing `createBaseEmbed`/`buildEmbedAuthor` helpers.
- Movie posters as thumbnails (`https://image.tmdb.org/t/p/w92<poster_url>`) when available.
- Embeds link to the most relevant app page via `config.appUrl`.
- Personal data (`/my-team`) is sent as **ephemeral** replies.
- Discord hard limits respected: ≤25 fields, description ≤4096 chars, field value ≤1024 — use
  `truncate()` from `utils/format.ts`; autocomplete returns ≤10 choices.
- Long lists (standings, rosters, releases) render as aligned line-per-entry descriptions like
  `standings.ts` does today, not as 20 inline fields.

## Bot unit-test harness (established in Epic A, reused after)

`apps/discord-bot/src/_test/helpers.ts`:
- `makeInteraction(overrides)` — a fake `ChatInputCommandInteraction` exposing `options.get*`,
  `deferReply`, `editReply`, `reply`, `followUp` as vitest spies, plus `channelId`, `guildId`,
  `user.id`, and `memberPermissions`.
- Supabase mocking via `vi.mock('../supabase.js')` returning a chainable query-builder fake
  (pattern: each test provides canned `{ data, error }` per table, mirroring
  `supabase/functions/_test_utils/mocks.ts`).
- External fetch (TMDb/Edge Functions) mocked via `vi.stubGlobal('fetch', ...)`.

Minimum cases per command: happy path (assert embed title/description/color and target user
visibility), unlinked channel, empty state, DB error. For components (buttons/selects): one
interaction-collector test or extracted-handler unit test.

## Per-epic definition of done

### Epic A (8 read-only commands)
- All 8 commands registered in **both** `src/index.ts` and `src/deploy-commands.ts`.
- `Command` interface extended with optional `autocomplete` handler; `index.ts` interaction
  listener routes `isAutocomplete()` interactions; `/movie` uses it (debounce not required
  server-side; just answer within 3s and cap at 10 choices).
- `/my-team` resolves the caller via `get_user_by_discord_id` RPC and replies ephemerally.
- `/current-bids` uses the sealed presentation (movies + bidder counts, no amounts).
- TMDb-backed commands call the existing Edge Functions (`search-movies`, `browse-movies`) over
  HTTP with the service-role key — no new TMDb client in the bot.
- Vitest suite covers every command per the harness minimums (≥ 32 tests expected).

### Epic B (admin model + role wiring)
- One migration adds `bot_admin_role_id TEXT`, `notify_weekly_digest BOOLEAN NOT NULL DEFAULT
  true`, `notify_movie_news BOOLEAN NOT NULL DEFAULT true` to `discord_channels`, updates the
  `discord_channels_safe` view, and is applied locally via `migration up` (prove with a psql
  `\d discord_channels` capture or select).
- `canAdministerBot()` helper unit-tested for all four grant paths (Manage Server, admin role,
  league owner, deny).
- `set-league`, `remove-league`, `configure`, `/set-bot-admin-role`, `/set-bid-alert-role` all
  enforce it; denial replies are ephemeral.
- `_shared/discord.ts` prepends `<@&bid_alert_role_id>` to `content` for `bids`-category sends
  when set — unit test in `_shared/discord.test.ts` proves role ping present/absent.
- `/configure` panel gains Weekly digest + Movie news toggles; button custom-ids and update
  logic unit-tested.

### Epic C (scheduled notifications)
- Each new Edge Function has: `config.toml` entry with `verify_jwt = false`, cron auth guard
  matching existing cron functions (`process-bids` pattern), mock-based unit tests, and an
  integration test file (orchestrator will run it via worktree `functions serve`).
- C1 double-send protection is proven by a unit test that runs the function twice over the same
  data and asserts one send.
- C3 asserts: date diff detected → `movies.release_date` updated → notification sent; no-diff →
  no write, no send.
- C5's Edge Function rejects non-owners (403 test); frontend piece uses `useAsyncAction` and the
  `frontend-design` skill conventions.
- New notification category `movie_news` added to `NotificationCategory` and `CATEGORY_COLUMN`
  in `_shared/discord.ts`.
- Vercel cron entries documented in the PR body (orchestrator wires actual `vercel.json`/dash
  config — agents just document schedule + path).

### Epic D (polish)
- D1: unit tests assert both parties' `<@id>` mentions in trade notification content when
  `discord_id` linked, and clean fallback when not.
- D2: threshold crossing logic unit-tested (crosses ≥ +15 → send once; already above → no
  resend). Gated by `notify_movie_news`.
- D3: a sync of >5 changed movies produces ≤5 individual embeds + 1 rollup (or documented
  existing behavior if already correct — verify before changing).

## Orchestrator verification per epic (run before commit)

1. `git diff --stat` review against the epic's scope — no out-of-scope files.
2. Full command set: bot tsc + vitest, `deno task test:unit`.
3. For Epics B–D: `npx supabase functions serve --env-file supabase/.env` from the worktree,
   then `deno task test` (integration), then stop serving.
4. Read every new command/function end-to-end; check rubric adherence and RLS/security.
5. Commit with epic-scoped message. After all epics: `code-simplifier` pass over changed files,
   re-run all suites, fixup commit.

## Final manual smoke checklist (user-run, needs dev bot + dev guild)

1. `cd apps/discord-bot && npm run deploy-commands` (guild-scoped dev registration).
2. `npm run dev`, then in the dev guild channel linked via `/set-league`:
   `/league`, `/league-options`, `/standings`, `/roster`, `/movie` (verify autocomplete),
   `/upcoming`, `/bid-results`, `/current-bids`, `/top-available`, `/my-team` (verify ephemeral).
3. `/set-bot-admin-role` from a non-admin account → expect ephemeral denial.
4. `/set-bid-alert-role @role`, place a bid in the app → expect role ping on the notification.
5. Toggle each `/configure` switch and confirm the corresponding notification stops.
6. Invoke each cron function once via `curl` with the cron secret → check channel output.
