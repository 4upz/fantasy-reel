# League Seasons & Completion — Design + Team Plan

Branch: `claude/league-seasons`. Goal: parity with Fantasy Critic's league-year
lifecycle (see research summary at bottom) — a league can be ended, a winner is
recorded, everything freezes, everyone is told, and the league rolls into the
next season while history stays browsable.

## Decisions (agreed with the user, 2026-08-28)

| # | Decision |
|---|---|
| A | **Hybrid model.** New `league_series` table is the unified league identity (name, owner). Each existing `leagues` row is one **season** of a series (`leagues.series_id`). Season-scoped settings stay on `leagues` and are copied on rollover. No FK moves; `team_holdings`, RLS helpers, all write paths untouched. Query cost for season N: `WHERE series_id = ? ORDER BY season_year` — one indexed lookup, no chain walking. |
| B | **Manual + automatic completion.** Owner "End Season" button (wires existing `complete_league`) **and** a daily `complete-seasons` cron that ends any active league whose `season_end` has passed. Both call one shared `completeLeague()`. |
| C | **Co-champions.** `winner_team_ids uuid[]` = every team at rank 1 (ties share the title). One SQL ranking function feeds every consumer. |
| D | Central writable guard for all write Edge Functions; scores freeze for completed leagues; `isUpcomingMovie` keys off `season_year` not wall-clock year. (Reopen-for-corrections window deferred — flagged in the PR.) |
| E | Season-end notifications: Discord (existing embed + 👑 reigning champ + 7-day reminder), in-app (`season_completed`), email (`season-final-standings`). |
| F | Rollover ("Start next season") + season switcher + champion banner + series history + profile trophies. UX brainstormed by a dedicated design agent (devil's-advocate pass included). |

Terminology in UI copy: **League** = the series; **Season** = one `leagues` row. "Year" appears only as the season label (e.g. "2026 Season").

## Handoff contracts

### Schema — `supabase/migrations/20260828120000_league_seasons.sql` (fn-dev-a)

```sql
CREATE TABLE league_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- leagues additions
ALTER TABLE leagues
  ADD COLUMN series_id uuid REFERENCES league_series(id) ON DELETE CASCADE,  -- backfilled, then SET NOT NULL
  ADD COLUMN season_year integer,          -- backfill EXTRACT(YEAR FROM COALESCE(draft_start_date, created_at)); SET NOT NULL
  ADD COLUMN season_end date,              -- backfill make_date(season_year,12,31); SET NOT NULL
  ADD COLUMN completed_at timestamptz,     -- NULL until completed; write-once
  ADD COLUMN winner_team_ids uuid[];       -- NULL until completed; every rank-1 team
CREATE UNIQUE INDEX leagues_series_season_uidx ON leagues(series_id, season_year);
```
- Backfill: one `league_series` per existing league (`name`, `owner_id` copied).
- Trigger: on `leagues` insert with NULL `series_id`, create a series automatically (keeps `create-league` working unchanged); on `league_series` name update, no sync needed — `leagues.name` remains the season's display name and is copied on rollover.
- RLS: `league_series` SELECT for members of any of its seasons (`is_series_member(series_id)` security-definer helper following the `is_league_member` pattern), UPDATE for `owner_id`. Wrap `auth.uid()` in subselects, `TO authenticated`.
- `league_standings(p_league_id uuid)` — `security invoker`, granted to `authenticated`. Returns
  `(team_id uuid, team_name text, participant_id uuid, user_id uuid, total_points numeric, rank integer, is_tied boolean)`
  using competition ranking (1,2,2,4) over `team_scores.total_points DESC` for `league_participants.status='active'`. Teams with no `team_scores` row count as 0.
- `series_seasons(p_series_id uuid)` — convenience view or function returning `(league_id, season_year, status, completed_at, winner_team_ids, name)` ordered by `season_year DESC`. (A plain query on `leagues` is acceptable if RLS already covers it — document which.)
- `discord_notification_log.movie_id` → nullable; add partial unique index `(league_id, notification_type) WHERE movie_id IS NULL` so movie-independent events (season reminder) are idempotent.
- Season-end resolution: `season_end` is NOT NULL, so no resolver needed. `trade_deadline` stays independent; UI defaults it to `season_end` when the user hasn't set one.

### Migration — `supabase/migrations/20260828120001_season_notification_types.sql` (fn-dev-a)
`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'season_completed'; ... 'season_started';` (own file — ADD VALUE cannot share a transaction with first use).

### Migration — `supabase/migrations/20260828120002_start_next_season.sql` (fn-dev-b)
`start_next_season(p_league_id uuid, p_season_year integer) RETURNS uuid` — security definer, REVOKE FROM PUBLIC, grant service_role only. In one transaction: insert a new `leagues` row copying every season-scoped setting column from the source (all bidding/trade/counterpick/draft config, `name`, `owner_id`, `invite_only`, `max_participants`), same `series_id`, `season_year = p_season_year`, `season_end = make_date(p_season_year,12,31)`, `trade_deadline = NULL`, `status='setup'`, fresh `join_code`/`join_token` (NULL — regenerated by `generate-join-link`), `custom_draft_order=false`, `draft_*_date=NULL`; copy `league_participants` with `status='active'` (owner + members, `draft_order=NULL`, `role` preserved) and create a `teams` row per participant carrying over the team `name`/`avatar_url` (mirror whatever `join-league` does to create a team — check it); copy `discord_channels` rows (same webhook, all toggles) pointing at the new league. Returns the new league id. Refuses (RAISE) if source `status <> 'completed'` or a season with that year already exists in the series.

### Edge Functions

| Function | Owner | Contract |
|---|---|---|
| `_shared/league-completion.ts` | fn-dev-a | `completeLeague(serviceClient, leagueId, { trigger: 'owner' \| 'cron' }) → { ok: true, standings: StandingRow[], winnerTeamIds: string[] } \| { ok: false, reason: 'not_active' \| 'not_found' }`. Steps: rescore every active team (`recalculate_team_score_with_counterpicks`), `league_standings`, check-and-set `status='completed', completed_at=now(), winner_team_ids` (`.eq('status','active')` — a second caller gets `not_active`), then notify: Discord final-standings embed (move the existing one from `update-league` here; add 👑 next to the previous season's champion(s) if the series has a prior completed season), in-app `season_completed` row for every active participant (`title`, `body`, `data: { league_id, series_id, season_year, winner_team_ids }`), email `season-final-standings` to every participant via the existing Resend path with `logNotificationDelivery(..., 'season_completed')`. Notification failures never roll back the state change. |
| `update-league` `complete_league` action | fn-dev-a | Now delegates to `completeLeague(..., { trigger:'owner' })`; response shape stays `{ league, message, top_teams }` (keep existing tests green) plus `winner_team_ids`. `update_settings` accepts `season_year` (only while `status='setup'`), `season_end`, `trade_deadline` with validation (`season_end >= today` unless unchanged; `trade_deadline <= season_end`). |
| `complete-seasons` (cron) | fn-dev-a | Body ignored. Finds `leagues` with `status='active' AND season_end < current_date`, completes each; also posts a Discord `general` embed "Season ends in 7 days" for leagues with `season_end = current_date + 7` (idempotent via `discord_notification_log` type `season_end_reminder`). Uses `startJobRun('complete-seasons')`, `job_status` in response, `internalErrorResponse`. Route `apps/frontend/app/api/cron/complete-seasons/route.ts` + `vercel.json` entry `0 9 * * *`. `config.toml` entry. |
| `_shared/league-status.ts` | fn-dev-b | `assertLeagueWritable(league: { status: string }) → { ok: true } \| { ok: false, response: Response }` — 400 "This season is finished." for `completed`. Applied in: place-bid, cancel-bid, set-bid-priorities, place-counterpick-bid, cancel-counterpick-bid, set-counterpick-bid-priorities, drop-movie, propose-trade, respond-trade, counter-trade, cancel-trade, extend-trade-offer, approve-trade, veto-trade, join-league (no joining a finished season). Draft functions already require `drafting`. |
| `_shared/utils.ts` `isUpcomingMovie` | fn-dev-b | New signature `isUpcomingMovie(releaseDate, seasonYear: number)` — "released in a previous season" if `releaseYear < seasonYear`; keep the already-released check. Update draft-pick, place-bid, and their tests to pass `league.season_year`. |
| `update-scores` | fn-dev-b | Only score movies currently held by a team in a league with `status <> 'completed'`. Final standings must never change after `completed_at`. |
| `start-next-season` | fn-dev-b | `POST { league_id }` (owner only, source must be `completed`, computes `season_year = source.season_year + 1`, refuses if that season exists). Calls `start_next_season` RPC with the service client, then inserts in-app `season_started` notifications for every copied participant and posts a Discord `general` embed "🎬 The {year} season is open". Returns `{ league_id, season_year }`. `config.toml` entry. Tests. |
| `get-leagues` | fn-dev-b | Each league now includes `series_id`, `season_year`, `season_end`, `completed_at`, `winner_team_ids`, and a `series: { id, name, seasons: [{ id, season_year, status }] }` summary so the dashboard can group. Keep response backward compatible otherwise. |

### Frontend types (`apps/frontend/types/index.ts`)
Add to `League`: `series_id: string`, `season_year: number`, `season_end: string`, `completed_at: string | null`, `winner_team_ids: string[] | null`. Export `LeagueStatus`. Add `LeagueSeries { id; name; owner_id; seasons: SeasonSummary[] }` and `SeasonSummary { id; season_year; status; completed_at; winner_team_ids }`. Add `StandingRow` matching `league_standings`.

### Frontend surfaces (frontend-dev, after design brief)
- Settings: new `SeasonSection` (season year — editable in setup only; season end date; trade deadline defaulting to season end) and **End Season** in a "Season" area (not Danger Zone) with a confirm modal that previews the current standings from `league_standings` and names the would-be champion(s). Uses `useAsyncAction`, `callEdgeFunction`.
- League header/dashboard: season pill ("2026 Season"), champion banner on completed leagues, reigning-champion crown on the previous season's winner(s) during the next season.
- Season switcher inside `LeagueSwitcher` (or a sibling) listing `series.seasons`.
- "Start next season" CTA for the owner on completed leagues → `start-next-season` → redirect to the new league.
- Series history: list of seasons with winner + final top 3 (route `league/[id]/history` or a panel on the dashboard — design agent decides).
- Profile: championships count + list (derive from `leagues.winner_team_ids` ∩ my teams — an RPC `my_championships()` may be added by frontend-dev in migration `20260828120003_profile_championships.sql` if a client query is awkward; document it).
- Dashboard grouping: one card per series showing the current season, with completed seasons collapsed underneath.
- Standings page + `StandingsClient` consume `league_standings` (remove `calculateRankings`), show "Co-champions" when `winner_team_ids.length > 1`.
- Discord bot `/standings` reads `winner_team_ids`/`league_standings` for the completed case; `/league` shows season year.

## Agent Team Strategy
**Topography:** Full-Stack Feature (lead + fn-dev-a + fn-dev-b + design + frontend-dev + reviewer). All agents on Opus.

### Phases
1. **Parallel build** — fn-dev-a (schema, completion, cron, notifications), fn-dev-b (guards, eligibility, freeze, rollover, get-leagues), design agent (UX brief) run together.
2. **Frontend build** — frontend-dev implements the design brief against the contracts.
3. **Integration** — lead merges, runs migrations locally, Deno tests.
4. **Simplify** — code-simplifier across modified files.
5. **Verify** — Deno + Playwright + browser walkthrough; reviewer pass.
6. **PR** with screenshots.

## Research summary (Fantasy Critic)
- Years are a global calendar (`tbl_meta_supportedyear.Finished`), leagues have per-year rows with all settings, publishers are per-year. Completion is automatic on Jan 1 ET via an hourly job: final score refresh → `Finished=1` → recompute points + write `WinningUserID` (write-once) → Discord "Final Standings" embed (🏆 winner, 👑 previous champ). Every write endpoint checks the finished flag centrally; managers get an "under review" override until Feb 1. Scores freeze by skipping external refresh for finished years. Rollover is manager-initiated, copies settings + active players, not rosters. Old years browsable via year dropdown; all-time stats page after 3+ years. No email or in-app notifications.
