# Discord Bot Parity Plan — FantasyCritic Feature Extraction

Source analysis: [SteveF92/FantasyCritic](https://github.com/SteveF92/FantasyCritic), primarily
`src/FantasyCritic.Lib/Discord/` (24 slash commands, `DiscordPushService` with ~20 notification
types, per-channel settings models) and `src/FantasyCritic.Lib/Scheduling/` (3 notification cron
tasks). Mapped against Fantasy Reel's existing `apps/discord-bot` (discord.js gateway bot) and
`supabase/functions/_shared/discord.ts` (webhook push pipeline).

**Domain translation used throughout:** Publisher → Team · Master Game → Movie (TMDb) ·
Critic Score → aggregate critic score (IMDb/RT/Metacritic via MDBList) · Game News → Movie News ·
Public Bidding → FAAB pickup bids · Conference → *no equivalent*.

---

## 0. Schema Corrections (verified against migrations, 2026-08-04)

CLAUDE.md §2 and the first draft of this plan describe tables that do not exist. Epic
implementers must build against these **actual** facts:

- **No `league_bidding_config` table.** All league config lives as columns on `leagues`:
  `draft_slots` (rounds), `total_slots`, `drop_limit`, `counterbid_hours`,
  `draft_counterpick_slots`, `bidding_counterpick_slots`, `counterpicks_block_drops`,
  `faab_budget`, `trades_enabled`, `trade_review_enabled`, `trade_veto_hours`, `trade_deadline`.
  There is no bidding window, no `min_bid`/`max_bid` (per-bid cap of 100 is a CHECK constraint on
  `pickup_bids`), and no `draft_type` — drafts are always snake.
- **`bid_status` enum:** `active | outbid | won | lost | cancelled` (no `pending`). "Pending"
  bids = `status IN ('active','outbid')`. There is no `pickup_bids.processed_at`.
- **`pickup_bids` has `tmdb_id` + `movie_data` JSONB, not a `movie_id` FK** (a bid can precede
  the movie existing locally — fall back to `movie_data->>'title'`). Won pickups land in the
  separate `pickups` table, which *does* have `movie_id` and `picked_up_at`.
- **Active roster** = `draft_picks` rows with `dropped_at IS NULL` **plus** `pickups` rows with
  `dropped_at IS NULL`.
- **FAAB balance** lives in `team_budgets.remaining_budget`, not on `teams`.
- **League-scoped `team_scores` queries** must filter server-side:
  `.select('..., teams!inner(..., league_participants!inner(league_id))')` +
  `.eq('teams.league_participants.league_id', leagueId)` — never fetch-all-then-filter.
- `draft_picks` has two FKs to `teams`; joins need `teams!draft_picks_team_id_fkey(...)`.

## 1. Where We Already Have Parity

Do **not** re-implement these. Verified present and wired up:

| FantasyCritic feature | Fantasy Reel equivalent | Location |
|---|---|---|
| `/set-league`, `/remove-league` | Same commands | `apps/discord-bot/src/commands/` |
| League channel config storage | `discord_channels` table (webhook-based, per-channel notify flags, failure tracking, thread support) | migrations `20260216*`, `20260218*` |
| Notification category toggles | `/configure` with button toggles (drafts/bids/trades/scores) | `configure.ts` |
| `/league` (standings portion) | `/standings` | `standings.ts` |
| `/publisher` (roster portion) | `/roster` | `roster.ts` |
| Draft pick announcements | `draft-pick` fn: pick embed, poster thumbnail, progress footer | `supabase/functions/draft-pick` |
| Next-drafter ping w/ Discord @mention | Already in `draft-pick` (mentions `profiles.discord_id`, "you're on the clock") | same |
| Draft start/end messages | `start-draft` + draft-complete embeds in `draft-pick` | same |
| Bid placed / counterpick bid / bid results | `place-bid`, `place-counterpick-bid`, `process-bids` | same |
| Trade lifecycle messages | `propose-trade`, `respond-trade`, `counter-trade`, `cancel-trade`, `veto-trade`, `process-trades` | same |
| Score change + standings movement messages | `update-scores` → `_shared/score-notifications.ts` (movie score embeds, standings diff, rollups) | same |
| Bid alert role storage | `discord_channels.bid_alert_role_id` column exists | migration |

## 2. Deliberately Excluded (with reasons)

| FantasyCritic feature | Why excluded |
|---|---|
| All conference commands (`/conference`, `/set-conference`, `/remove-conference`, `/link-to-conference`, `/set-conference-news`) | Fantasy Reel has no conference (multi-league group) concept. Revisit only if conferences are ever built. |
| `/special-auctions` + special auction notifications | No special-auction mechanic in Fantasy Reel. |
| Super drop messages | No super-drop mechanic. |
| `/trending` (sitewide trending bids/drops) | Needs sitewide scale to be meaningful; Fantasy Reel is small. Skip. |
| Master-game edit batching / `ClearMasterGameEditQueue` | FC hand-curates its game DB, so edits are events. Our movie data comes from TMDb; the useful subset is **release-date changes**, covered in Epic C. |
| Year parameter on nearly every command | FC leagues are year-scoped; Fantasy Reel leagues are not. Omit all `year` options. |
| Publisher name/edit notifications | Low value; team renames are rare and visible in-app. Skip (cheap to add later). |

---

## Epic A — New Read-Only Slash Commands

All commands live in `apps/discord-bot/src/commands/`, follow the existing `Command` interface
(`index.ts`), use `createBaseEmbed`/`DISCORD_COLORS` from `utils/embeds.ts`, read via the bot's
Supabase service client (`supabase.ts`), and resolve the channel's league from `discord_channels`
by `channel_id` (see `standings.ts` for the pattern). Register each in `deploy-commands.ts` if
registration is manual. Every command must handle: channel not linked (friendly error), league
found but empty state, and Supabase errors. Each task = one command = one delegable unit; add a
vitest unit test per command following existing test setup.

### A1. `/league` — league overview
FC: `LeagueCommand`. Show one embed: league name, status badge (setup/drafting/active/completed),
member count, draft config (type, rounds, counterpick slots), bidding window if enabled, top 3
standings, and a link button to the league page (`buildLeagueUrl` pattern — the bot has its own
URL helper in `utils/format.ts`; reuse it). Distinct from `/standings` (full table).

### A2. `/league-options` — full league settings
FC: `LeagueOptionsCommand`. Embed listing: draft type (snake/linear), rounds, pick time limit,
counterpick slots, bidding enabled + window + min/max bid, FAAB budget, trade review/veto settings.
Read from `leagues` + `league_bidding_config`.

### A3. `/movie <name>` — movie lookup
FC: `GameCommand` (their most-used command). Search TMDb by partial name (reuse the
`search-movies` Edge Function via HTTP, or call TMDb directly if the bot has the key — prefer the
Edge Function so caching/normalization stays in one place). Embed: title, release date, poster,
aggregate critic scores (from `reviews`/`movies` if the movie exists in DB), computed fantasy
points, and **league context**: which team rosters it in this channel's league, or "available".
If multiple matches, show top result + up to 4 alternates as a list.
**Improvement over FC:** add Discord autocomplete on the `name` option (debounced TMDb search,
max 10 choices) — FC has no autocomplete; discord.js supports it via the `autocomplete` handler.

### A4. `/upcoming [scope]` — upcoming/recent releases
FC: `GameNewsCommand` (`upcoming_or_recent` option). Option `scope`: `upcoming` (default) |
`recent`. Lists rostered movies in this league releasing in the next 30 days (or released in the
last 14), grouped by team, with dates formatted via `utils/date` conventions. This is a league
snapshot on demand; the scheduled digest is Epic C.

### A5. `/bid-results` — most recent processed bids
FC: `BidResultsCommand`. Query `pickup_bids` where `status IN ('won','lost')`, grouped by the most
recent `processed_at` batch. Embed: winning bids (movie, team, amount) and losing bids. Empty
state: "No bids have been processed yet."

### A6. `/current-bids` — pending bids
FC: `PublicBidsCommand`. Query `pickup_bids` with `status='pending'` for the league: movie, current
high bid **without revealing bidder amounts if the league treats bids as sealed** — check with the
product owner: if bids are sealed-FAAB, show only *which movies have active bids and bidder count*,
not amounts. Default to the sealed presentation; it matches FAAB norms.

### A7. `/top-available` — best unrostered movies
FC: `TopAvailableGamesCommand`. Adaptation: instead of FC's per-publisher personalization, show the
top ~10 upcoming movies by TMDb popularity that are **not** on any roster in this league (exclude
`draft_picks` and won `pickup_bids`, minus drops). Uses `browse-movies` Edge Function + roster
filter.

### A8. `/my-team` — your own roster via account link
FC: gated feature requiring Discord-linked account. Resolve caller via
`get_user_by_discord_id(interaction.user.id)` (function already exists in migrations) → their team
in this channel's league → reply **ephemerally** with their roster, total points, and rank. If no
linked account, ephemeral reply linking to the account-linking settings page.

---

## Epic B — Channel Administration Commands

Same conventions as Epic A. These mutate `discord_channels`, so they must enforce permissions.

### B1. Bot-admin permission model + `/set-bot-admin-role`
FC: `SetBotAdminRoleCommand` + `RoleHandler`. Add `bot_admin_role_id TEXT` to `discord_channels`
(migration, `supabase migration up` — never reset). Shared helper `canAdministerBot(interaction,
channelSettings)`: true if member has Manage Server permission, has the bot-admin role, or is the
league owner (match `interaction.user.id` → `get_user_by_discord_id` → `leagues.owner_id`).
`/set-bot-admin-role [role]` sets it; omitting `role` clears it. Retrofit the check onto
`set-league`, `remove-league`, `configure`, and B2/B3. Follow existing RLS conventions when adding
policies (see `fix_discord_channels_policies` migration).

### B2. `/set-bid-alert-role [role]`
FC: `SetBidAlertRoleCommand`. The `bid_alert_role_id` column already exists but nothing writes it.
Command sets/clears it. Then update `_shared/discord.ts` so `category: 'bids'` notifications
prepend `<@&role_id>` to `content` when set (FC pings the role on public-bid summaries and bid
results — apply to `process-bids` results and new-bid announcements).

### B3. Weekly digest toggle — fold into `/configure`
FC: `SetWeeklyReleasesMessageCommand`. Rather than a separate command, add a fifth toggle button
"Weekly digest" to the existing `/configure` component UI, backed by a new
`notify_weekly_digest BOOLEAN NOT NULL DEFAULT true` column. (Improvement: FC scatters settings
across many commands; our `/configure` panel is the better UX. Also fold a
"Movie news" toggle in here for Epic C, column `notify_movie_news BOOLEAN NOT NULL DEFAULT true`.)

---

## Epic C — Scheduled Notifications (the real gap)

FC runs three scheduled tasks (`GameReleaseNotificationTask`, `ReleasingThisWeekNotificationTask`,
`PublicBiddingNotificationTask`). Fantasy Reel's cron pattern: Vercel Cron → Edge Function (see
`update-scores`, `process-bids`). Each task below = one new Edge Function + `config.toml` entry
(`verify_jwt = false`) + cron schedule + tests in `supabase/functions/tests/`. All of them fan out
through the existing `sendDiscordNotification` with per-league channel lookup and must respect the
existing rate-limit handling in `_shared/discord.ts`.

### C1. `release-day-announcements` (daily, ~9am ET)
FC: `SendGameReleaseUpdates`. For each league, find rostered movies with `release_date = today`.
Send one embed per league: "🎬 Releasing today: **Movie** (Team)". Category: new `movie_news`
(gated by `notify_movie_news`). Idempotency: record last-run date or check
`release_date = current_date` only — a rerun the same day must not double-post (store a
`notified_release_day` flag on `draft_picks`/roster row, or a small `notification_log` table —
implementer's choice, but double-send protection is an acceptance criterion).

### C2. `weekly-releases-digest` (Mondays)
FC: `SendReleasingThisWeekUpdate`. Per league with `notify_weekly_digest`: all rostered movies
releasing this calendar week, grouped by day, with team names. Skip leagues with nothing releasing
(FC sends nothing rather than "no releases").

### C3. Release-date change detection (extends `update-scores` or a new `sync-movie-data` fn)
FC equivalent: master-game edit news — adapted to our TMDb world. Nightly, for all rostered movies
with a future or recent release date, re-fetch TMDb release dates. If a date moved, update
`movies.release_date` and notify: "📅 **Movie** moved from May 15 to Aug 22 (Team)". This matters
more for movies than games (delays are constant) and is currently silent breakage for scoring.
Category `movie_news`. Requires storing nothing new — diff against the current column value.

### C4. Season wrap-up — final standings
FC: `SendFinalYearStandings`. When a league transitions to `completed` (find the transition point —
likely league settings update or a future cron), send a celebratory final-standings embed: 🥇🥈🥉
top three with points, link to standings. Trigger from wherever status flips to `completed`; if
that's only manual today, hook the settings-update path.

### C5. League-manager announcement relay
FC: `SendLeagueManagerAnnouncementMessage`. New Edge Function `send-announcement`
(auth: league owner only) + a small textarea UI on the league settings page that posts an
"📣 Announcement from the commissioner" embed to all league channels. Frontend part must use the
`frontend-design` skill and `useAsyncAction` per project conventions.

### C6. New-member notification
FC: `SendNewPublisherMessage`. In `join-league` (or wherever membership is created), send "**Team
name** has joined the league." No existing notify category fits cleanly; send it ungated (rare and
benign) rather than adding a sixth toggle.

---

## Epic D — Notification Polish (small, independent tasks)

- **D1. Trade @mentions** — FC mentions both trade parties' Discord users in trade embeds. Add
  `<@discord_id>` for proposer + recipient (via `profiles.discord_id`) to `propose-trade` /
  `respond-trade` notification content.
- **D2. Notable miss (adapted)** — FC flags "games you passed on that scored ≥ 83." Adaptation: in
  `update-scores`, when an **unrostered or dropped** movie in a league's draft-pool history crosses
  a fantasy-points threshold (suggest ≥ +15 pts), send "👀 The one that got away: **Movie** hit
  X pts — dropped by Team / never drafted." Gate behind `notify_movie_news`. This is the fun
  trash-talk feature; recommended despite being optional.
- **D3. Batched score updates** — FC batches critic-score changes into one message
  (`SendBatchedMasterGameUpdates`) to avoid spam. Verify `score-notifications.ts` rollup behavior
  matches (it appears to via `buildMovieRollupEmbed`); if per-movie embeds still fire individually
  for large syncs, cap at N embeds + a rollup summary.

---

## Suggested delegation order

| Phase | Tasks | Rationale |
|---|---|---|
| 1 | A1, A2, A5, A8 (pure DB reads) | Zero schema changes, lowest risk, immediate user value |
| 2 | B1 → B2, B3 (one migration covering all 3 columns) | Unblocks admin gating for everything else |
| 3 | A3, A4, A6, A7 (TMDb-touching commands) | Need TMDb/Edge Function access decisions |
| 4 | C1, C2, C3 (cron functions) | The genuinely new infrastructure |
| 5 | C4, C5, C6, D1–D3 | Polish |

Per-task checklist for implementers (from CLAUDE.md): code-simplifier after implementation → Deno
tests (`npm run test:functions`) / bot vitest → browser or Discord verification → commit. New Edge
Functions **must** get a `config.toml` entry with `verify_jwt = false` or they 401 in production.
DB changes via `npx supabase migration new` + `migration up`, never `db reset`.

---

## Epic C implementation notes (appended by the Epic C implementer)

### Cron schedules and invocation paths (proposed, not wired)

Mirrors the existing `apps/frontend/vercel.json` → `apps/frontend/app/api/cron/<name>/route.ts` →
Edge Function pattern (see `process-bids`/`update-scores`): a Vercel Cron GET hits a thin Next.js
route that validates `Authorization: Bearer $CRON_SECRET`, then POSTs to the Edge Function with
`X-Cron-Secret`. None of this was wired in this pass -- no `vercel.json` entries or
`app/api/cron/*` routes were added. To activate:

| Function | Proposed schedule | Vercel Cron path (to create) | Edge Function |
|---|---|---|---|
| `release-day-announcements` | `0 13 * * *` (~9am ET) | `/api/cron/release-day-announcements` | `POST /functions/v1/release-day-announcements` |
| `weekly-releases-digest` | `0 13 * * 1` (Mondays, ~9am ET) | `/api/cron/weekly-releases-digest` | `POST /functions/v1/weekly-releases-digest` |
| `sync-release-dates` | `0 8 * * *` (nightly, ~3-4am ET) | `/api/cron/sync-release-dates` | `POST /functions/v1/sync-release-dates` |

`send-announcement` (C5) is not a cron function -- it's invoked directly from the frontend via
`supabase.functions.invoke`, JWT-authenticated, owner-only. C4 (season wrap-up) and C6 (new-member
notice) are not standalone functions either; see below.

### C3: extend-vs-new decision

Built `sync-release-dates` as a **new** function rather than extending `sync-movies`.
`sync-movies` is a broad TMDb *discovery* pass (paginated `discover/movie` by popularity, filtered
by year/region) that upserts movies nobody may ever roster -- its contract is "sync the catalog."
C3 needs a small nightly *diff* over exactly the movies some league has rostered (draft_picks or
pickups, `dropped_at IS NULL`), re-fetching each by `tmdb_id` from the single-movie TMDb endpoint
and comparing `release_date`. Folding that into `sync-movies` would mean threading
roster-awareness and notification side effects into a function whose existing callers (manual
catalog refresh) don't want either. A new function keeps both contracts single-purpose, matching
how `update-scores` and `process-bids` are already split by concern rather than merged.

### C6: gating approach

`sendDiscordNotification` requires a `NotificationCategory`, and every existing category maps to a
per-channel `notify_*` boolean column via `CATEGORY_COLUMN`. Rather than add a sixth `/configure`
toggle for an event a team sees once per season, `_shared/discord.ts` gained a `'general'`
category with **no** `CATEGORY_COLUMN` entry -- `sendDiscordNotification` treats a category with no
mapped column as ungated (every enabled channel is eligible). This is the least invasive option:
no schema change, no new toggle, and it's reused by C5's commissioner announcement for the same
reason ("the owner posted on purpose, every linked channel should see it").

### C4: trigger point

No code path transitioned `leagues.status` to `'completed'` before this change (verified: no
migration, Edge Function, or trigger sets it). Added a `complete_league` action to `update-league`
(owner-only, requires `status = 'active'`) rather than a polling cron, since the transition is
naturally a settings-page action ("end my season") and an event hook is strictly simpler than
detecting "a league has had no activity in N days." Sends a final-standings embed (🥇🥈🥉, via the
existing `snapshotStandings` from `_shared/score-notifications.ts`) on success, category `'scores'`.

### New table: `discord_notification_log`

Added for C1's idempotency requirement: `(league_id, movie_id, notification_type)` unique rows,
service-role-only (RLS enabled, no policies). Chosen over a flag column on `draft_picks`/`pickups`
because a movie can be rostered via either table (or both, per §0's dropped-row overlap note), and
the log needs to key off the movie+league pair regardless of which table currently holds it.
