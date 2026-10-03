# Movie Scoring System

Fantasy Reel uses a three-layer architecture to automatically fetch and calculate movie scores from multiple review sources. Scores are updated daily to reflect the latest ratings.

## Overview

Ratings are fetched from three sources via MDBList, for released movies and
for rostered movies that have not released yet (see
[Pre-release scores](#pre-release-scores) -- a score can arrive before
release, but its points only count from release day):
- **Rotten Tomatoes** (Tomatometer, 0-100 scale) - Critic consensus, and the **only source that drives fantasy points**
- **IMDb** - Broad audience ratings, stored for display only
- **Metacritic** - Weighted critic average, stored for display only

The Rotten Tomatoes score is copied directly into `combined_score` (0-100 scale), which is then converted to **fantasy points** using a baseline-relative curve. If a movie has no Rotten Tomatoes review yet, it is unscored: `combined_score` and `fantasy_points` stay `NULL` until one is fetched.

## Fantasy Points Formula

Fantasy points are not the raw Tomatometer score — they reward excellence and penalize poor performance relative to a 60-point baseline (Rotten Tomatoes' own "Fresh" line):

### Formula

| RT Score | Calculation | Example |
|----------|-------------|---------|
| 90+ | 30 + 2 × (RT − 90) | 96% → 30 + 2×6 = **+42** |
| 50-89 | RT − 60 | 84% → **+24**; 60% → **0** |
| 40-49 | −10 − 0.5 × (50 − RT) | 40% → **-15** |
| 30-39 | −15 − 0.25 × (40 − RT) | 30% → **-17.5** |
| 20-29 | −17.5 − 0.125 × (30 − RT) | 20% → **-18.75** |
| 10-19 | −18.75 − 0.0625 × (20 − RT) | 10% → **-19.375** |
| Below 10 | −19.375 − 0.03125 × (10 − RT) | 0% → **-19.6875** |

Below the 50-point baseline the penalty slope halves every 10 points (0.5 → 0.25 → 0.125 → 0.0625 → 0.03125 …), so the curve approaches an asymptote around -20 but never hits a hard floor — a true bomb costs a little more than a merely bad movie, but the gap keeps shrinking.

### Example Calculations

| Movie | RT | Fantasy Pts |
|-------|-----|-------------|
| The 90% Club (96%) | 96 | **+42** |
| Great (84%) | 84 | **+24** |
| Exactly Fresh (60%) | 60 | **0** |
| Underwater (35%) | 35 | **-16.25** |

### Key Design Decisions

1. **60 as baseline**: Matches Rotten Tomatoes' own "Fresh" cutoff — fresh earns points, rotten costs points.
2. **The 90% Club doubles points**: Movies at 90+ earn 2 points per point above 90, on top of a +30 head start, rewarding teams who find genuine gems.
3. **Diminishing penalties, no hard floor**: The slope below 50 halves every 10 points, so the worst-case penalty approaches roughly -20 but never bottoms out at a fixed floor — one disaster can't destroy a team's season, and it makes counterpicking a richer strategic choice (the worse a movie can plausibly get, the more a counterpick against it is worth).
4. **Single source keeps scores predictable**: Players can reason directly about "what RT score does my movie need to be worth drafting?" without weighing three sources.
5. **Counter-pick ready**: `fantasy_points` is stored separately from `combined_score` so counterpicks can invert it (`-fantasy_points`).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TRIGGER: Vercel Cron / Manual Call                        │
│                                                                             │
│  ┌─────────────────┐         ┌──────────────────────────────────────────┐  │
│  │ Vercel Cron     │────────▶│  POST /functions/v1/update-scores        │  │
│  │ (nightly)       │         │  - Auth via X-Cron-Secret or Bearer key  │  │
│  └─────────────────┘         │  - 3 modes: movie_ids, league_id, auto  │  │
│                              └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      WORKER (update-scores Edge Function)                   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  For each movie (nightly: 30 released + 15 not yet released):         │  │
│  │    1. Fetch ratings from MDBList API (by TMDb ID)                     │  │
│  │    2. Filter to IMDb, RT, Metacritic (pre-normalized 0-100)           │  │
│  │    3. UPSERT into reviews table                                       │  │
│  │    4. Call calculate_movie_score(movie_id) ─────┐                     │  │
│  └─────────────────────────────────────────────────│─────────────────────┘  │
└────────────────────────────────────────────────────│────────────────────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DATABASE FUNCTIONS (Heavy Lifting)                       │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  calculate_movie_score(movie_id)                                      │  │
│  │  - Read RT score from reviews table (IMDb/Metacritic stored, unused)  │  │
│  │  - combined_score = RT Tomatometer score                              │  │
│  │  - Apply baseline-relative curve → fantasy_points                     │  │
│  │  - Update movies.fantasy_points (scoring_bonuses always NULL)         │  │
│  │  - Trigger recalculate_teams_for_movie()                               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Why MDBList?

MDBList (`mdblist.com`) aggregates ratings from 9+ sources, returning pre-normalized 0-100 scores. It supports lookup by TMDb ID directly, eliminating the need for IMDb ID resolution. Free tier allows 1,000 requests/day (we use ~60/day).

### Architecture Simplification

The original three-layer architecture (pgmq queue → pg_cron scheduler → Edge Function worker) was replaced with a simpler single Edge Function (`update-scores`) invoked directly by Vercel Cron. This is sufficient for our scale and easier to maintain.

### Why Rotten Tomatoes only?

- **One predictable number**: Players already know what a Tomatometer score means; scoring off a single source lets them reason directly about "what RT score do I need?" instead of weighing three inputs.
- **Matches the target distribution**: Calibrated against Fantasy Critic's season distribution — a simulated 2024 season using RT-only scoring produced ~66% of draftable movies scoring positive and ~16% reaching the 90+ tier (~1-2 per 10-slot roster). See `docs/scoring-simulation/RESULTS.md` for the full analysis.
- **Stability**: The Tomatometer freezes shortly after a wide release, so scores (and therefore team standings) don't keep drifting weeks later.
- **IMDb was vulnerable to review-bombing and long-term drift**, and the old three-source weighted blend diluted the top end enough that the 90+ tier was effectively unreachable — RT alone lets a genuine critical hit pay off.

The curve's constants (baseline, tier thresholds, slopes) live in the `calculate_movie_score()` function; there are no per-source weights anymore.

## Database Schema

### Movies Table (scoring columns)

```sql
ALTER TABLE movies ADD COLUMN combined_score DECIMAL(5, 2);   -- RT Tomatometer score (0-100)
ALTER TABLE movies ADD COLUMN fantasy_points DECIMAL(6, 2);    -- Baseline-relative curve result (can be negative)
ALTER TABLE movies ADD COLUMN scoring_bonuses JSONB;           -- Unused; always NULL, retained for compatibility
ALTER TABLE movies ADD COLUMN scores_updated_at TIMESTAMPTZ;
ALTER TABLE movies ADD COLUMN announced_fantasy_points DECIMAL(6, 2);  -- fantasy_points as last posted to Discord
ALTER TABLE movies ADD COLUMN announced_rt_score DECIMAL(5, 2);        -- combined_score as last posted to Discord
ALTER TABLE movies ADD COLUMN announced_before_release BOOLEAN NOT NULL DEFAULT false;  -- that post came before release
```

The `announced_*` columns belong to score notifications; see
[Change threshold](#change-threshold) and
[Pre-release scores](#pre-release-scores). `fantasy_points` is what a movie is
worth, whether or not it has released; whether it counts yet is decided by
team scoring, not stored on the movie.

`scores_updated_at` means "last **checked**", not "last scored": `update-scores`
also stamps it when MDBList authoritatively has nothing for a movie (no entry,
or an entry with no ratings), leaving the movie unscored but rotating it to the
back of the queue. The nightly batch selects eligible movies ordered by
`scores_updated_at ASC NULLS FIRST` (never-checked first, then stalest) —
without that ordering plus the stamp, an unordered `LIMIT` let old movies fill
every batch and newly released movies never received their first score.
Transient MDBList failures (network errors, rate limits) deliberately do not
stamp, so those movies retry on the next run.

Pending is not failure: a movie MDBList has no data for yet (no entry, no
ratings, or ratings without a Tomatometer) is reported under `unscored` in the
run's response and `job_runs.metadata` — with a reason of `not_on_mdblist`,
`no_ratings`, or `no_rt_score` — rather than under `errors`. Only genuine
failures (network/auth/rate-limit errors, review upserts, RPC crashes) count
toward `job_status`, which is what the cron proxy turns into an HTTP 500 and
what fires ops alerts. The nightly run's pre-release lookups are the exception:
an unreleased movie without a Tomatometer is the normal case, so those are only
counted (`prerelease_checked`), never listed. A movie stuck pending forever is
still findable:

```sql
SELECT metadata->'unscored' FROM job_runs
WHERE job_name = 'update-scores' AND metadata ? 'unscored'
ORDER BY started_at DESC LIMIT 1;
```

### Reviews Table (existing)

Stores individual scores from each source:

```sql
CREATE TABLE reviews (
    id UUID PRIMARY KEY,
    movie_id UUID REFERENCES movies(id),
    source VARCHAR(50) CHECK (source IN ('imdb', 'rotten_tomatoes', 'metacritic')),
    score DECIMAL(5, 2),      -- Normalized 0-100
    raw_score VARCHAR(20),    -- Original format ("8.5/10", "85%")
    fetched_at TIMESTAMPTZ
);
```

## Score Calculation

### Step 1: combined_score (Rotten Tomatoes only)

```
combined_score = RT Tomatometer score (reviews.source = 'rotten_tomatoes')
```

If no Rotten Tomatoes review exists for the movie yet, it is unscored: `combined_score`, `fantasy_points`, and `scores_updated_at` all stay `NULL` (the UI shows "Pending"). IMDb and Metacritic reviews may exist and are still stored, but they do not affect this step.

### Step 2: Fantasy Points (baseline-relative curve)

```sql
IF combined_score >= 90 THEN
    fantasy_pts = 30 + (combined_score - 90) * 2
ELSIF combined_score >= 50 THEN
    fantasy_pts = combined_score - 60
ELSIF combined_score >= 40 THEN
    fantasy_pts = -10 - (50 - combined_score) * 0.5
ELSIF combined_score >= 30 THEN
    fantasy_pts = -15 - (40 - combined_score) * 0.25
ELSIF combined_score >= 20 THEN
    fantasy_pts = -17.5 - (30 - combined_score) * 0.125
ELSIF combined_score >= 10 THEN
    fantasy_pts = -18.75 - (20 - combined_score) * 0.0625
ELSE
    fantasy_pts = -19.375 - (10 - combined_score) * 0.03125
END IF
```

`scoring_bonuses` is always `NULL` under this system — the column is retained for backward compatibility, but no bonuses (Certified Fresh, Critical Darling, Critical Disaster) exist anymore.

### Example

Movie: "Inception"
- Rotten Tomatoes: 87%

```
combined_score = 87

fantasy_points = combined_score - 60   -- in the 50-89 tier
               = 87 - 60
               = +27
```

## Score Notifications

Every `update-scores` run reports what moved to each league's Discord channels.
Notifications go out under the `scores` category, so they respect the
`notify_scores` toggle on `discord_channels` (set via the bot's `/configure`).

Implemented in `_shared/score-notifications.ts` as a before/after sandwich
around the recalculation:

```ts
const context = await captureScoreContext(client, movieIds)  // snapshot
// ...recalculate movie + team scores...
await sendScoreNotifications(client, context)                 // diff and post
```

`captureScoreContext` records each movie's scores plus the full standings of
every league holding those movies. Snapshotting *all* active participants'
teams in a league — rather than only the ones whose movies scored — is what
makes rank movement detectable for teams that were passed without scoring
themselves. (The same `status = 'active'` filter the standings page uses, so
Discord ranks agree with the site.) Standings are diffed against this
snapshot; a movie's post is not — it measures from the score last posted for
the movie (see [Change threshold](#change-threshold)).

**Both acquisition paths count.** A league "holds" a movie through either
`draft_picks` (drafted) or `pickups` (won at auction). Reading only
`draft_picks` silently suppresses every notification for auction-won movies.
The two can collide: `is_movie_eligible_for_pickup` excludes dropped draft
picks, so a movie dropped from the draft can be re-acquired at auction in the
same league, leaving a stale `draft_picks` row alongside a live `pickups` row.
Holdings are collapsed one-per-league preferring the **active** row — taking
the dropped one would attribute the movie to its former owner and suppress the
embed for the team that actually holds it.

**League discovery is deliberately separate from movie attribution.** A dropped
roster slot produces no movie embed — a movie the team no longer holds isn't
news — but its league is still considered affected, because
`recalculate_team_score_with_counterpicks` applies no `dropped_at` filter and
so a dropped movie's points still move its old owner's total. Keying the early
return on placements rather than leagues would black out an entire run's
notifications whenever the only affected slot was a dropped one.

Four events are reported:

| Event | Message |
|-------|---------|
| Movie scores for the first time | `Now has a score of **84% RT** (24.0 pts)` |
| Movie moves far enough from its last post | `Score has gone **DOWN** from **85% RT** (25.0 pts) to **82% RT** (22.0 pts)` |
| A movie whose score was posted before release has released | `Released: its **84% RT** (24.0 pts) now counts` |
| Team's rank changes, or its total moves far enough in one run | `Standings Update` embed, one field per team |

Before release, the first two add `Its points count once it releases on
**Oct 9**`; see [Pre-release scores](#pre-release-scores).

Each movie due a post gets its own message (titled with the movie, attributing
the owning team and any counterpicker). Each league then gets a single
`Standings Update` roundup listing every team whose rank or total moved enough.

### Change threshold

Posting every visible change was noisy: the Tomatometer ticks a point at a
time as reviews trickle in. "Far enough" is `SCORE_CHANGE_THRESHOLD`, 3 points.

- **Movies are measured from their last post, not from the previous run.**
  `movies.announced_rt_score` / `announced_fantasy_points` hold the score last
  posted. A movie posts again once its Tomatometer *or* its fantasy points
  reaches the threshold away from that, and the message reads from that score.
  Measuring run to run would never post a slow drift: a movie losing a point a
  day stays under the bar every single run. Either number counts because the
  curve bends — above 90% one RT point is two fantasy points, while below 30%
  RT moves barely touch points. A first score always posts.
- **The posted score is recorded before the message goes out**, so a failed
  write holds that movie's post for the next run instead of risking a double
  post.
- **Teams are measured run to run.** A rank change is always reported; a total
  needs to reach the threshold within the run to be reported on its own. Once a
  team is listed, any visible move in its total shows alongside its rank line.
- **Notable misses ignore the threshold.** They read every move since the
  pre-run snapshot, because a dropped movie can cross 15 points on a small step.

Fantasy Critic does the same thing at 1 point
(`DiscordPushService.PostMasterGameUpdates`, `PublisherScoreChange.ScoreChanged`),
having moved its publisher totals from "any change" to "1+" in November 2022.
Its scores are OpenCritic's fractional averages, where a whole point is already
a real move; the Tomatometer only moves in whole points, so 1 would let every
tick through. Fantasy Critic also measures each refresh against the one before,
so a drift made of sub-point steps never posts there.

Notes:

- **Ranks** are computed from exact points, matching the standings page, and
  any rank change is reported. If a rival slips 10.01 → 10.00 you can be told
  you "moved from 2nd to 1st" with no score line, because the change that
  caused it rounds away at one decimal. Discord and the site agree; only the
  explanation is invisible.
- Ranks use competition ordering — ties share a rank (1, 2, 2, 4). Tied teams
  get the same rank regardless of array order, so tie-break ordering can never
  manufacture a phantom rank change.
- Messages within a league are spaced 450ms apart. Discord's per-webhook bucket
  is 5 requests per 2s (400ms) and `discord.ts` treats a 429 as a plain failure
  without honouring `retry_after`, so overrunning drops messages outright.
  Leagues use separate webhooks and are notified concurrently.
- At most 8 individual movie messages per league per run; the remainder folds
  into one "N more movies scored" rollup.
- The `notifications` object in the `update-scores` response counts *changes
  detected*, not messages delivered — a league with no enabled channel still
  counts. Delivery success is logged by `_shared/discord.ts`.

## Pre-release scores

A movie is scored as soon as Rotten Tomatoes has a Tomatometer for it, which
is often days or weeks before it opens -- the way Fantasy Critic scores a game
from OpenCritic before launch. A score is not points earned, though.

- **Points count from release day.** `movie_has_released(release_date)` is
  the one rule: on or before today's UTC date, and an undated movie never has.
  `calculate_team_score()` -- the one definition of a team's score, which
  `recalculate_team_score_with_counterpicks()` stores -- counts a movie's
  points, for its holder and inverted against its counterpicker, only once it
  has released. Until then it is pending, exactly
  like a movie with no score, so `team_scores`, `league_standings()`, rank
  changes and `Standings Update` posts all wait for release. The frontend
  (`hasReleased` in `utils/date.ts`) and the Discord bot (`utils/points.ts`)
  apply the same rule, showing a pre-release score muted, "at release".
- **What is looked up.** On top of its 30 released movies, each nightly run
  looks up `PRERELEASE_BATCH_LIMIT` (15) movies that are held or counterpicked
  in a season still being played (`score_update_candidates.in_live_season`)
  and have not released, soonest release first, each at most once a day. When
  more qualify than fit, distant releases wait their turn: that is not when
  reviews land. Explicit `movie_ids` / `league_id` runs score whatever they
  are given, released or not.
- **What is posted.** A pre-release score posts like any first score or move,
  plus `Its points count once it releases on **Oct 9**`, and the post is
  recorded with `announced_before_release`. No team total moves, so no
  standings post follows.
- **Release day.** Every run looks for movies on a live roster whose last post
  came before release and which have now released. It rescores their teams
  (`recalculate_teams_for_movie`) -- the moment the points count, which needs
  no MDBList call, so it happens even when MDBList is down -- then posts
  `Released: its **84% RT** (24.0 pts) now counts` beside the standings update.
  If the score has moved since its last post, even by less than the
  threshold, a second line says so (`Up from **82% RT** (22.0 pts) before
  release`). A movie whose teams could not be rescored is left out of that
  run's posts and retried by the next, so a release post never claims points
  the standings don't show. The run reports `releases_counted`.
- A movie whose first score arrives after release posts a plain first score,
  as before, and counts immediately.
- If a release date moves later after release day (`sync-release-dates` edits
  dates up to 14 days back), the movie stops counting at its teams' next
  rescore and counts again from its new date.
- **A scored movie is locked against bids and trades**, released or not: its
  outcome is known (`20261002200000_lock_scored_movies.sql`). "Scored" means
  `movies.fantasy_points` is set.
  - No pickup or counterpick bid can be placed on it (`bidLock` in
    `_shared/utils.ts`, used by `place-bid` and `place-counterpick-bid`;
    `is_movie_eligible_for_pickup` backs `place-bid` up).
  - A bid already pending when the score lands is cancelled, uncharged, the
    next time bids are processed: `process-bids` voids it before resolution
    with `resolution_reason = 'movie_scored'`, notifies the bidder, and lists it
    in the results post.
  - Neither the movie nor the counterpick on it can be traded:
    `validate_trade_items` (re-run by `execute_trade` under the trade row lock)
    and `_shared/trade-validation.ts` refuse it with the same sentence, so
    proposing, countering, accepting and approving all fail.
  - `process-trades` ends any open offer that names one
    (`expire_scored_trade_offers`): `veto_reason` names the movie and both
    sides are notified. The run reports `expired_by_score`.
  - Drops, the draft and the draft's counterpick round are unchanged, so a
    movie with a pre-release score can still be dropped before release.

## Cron Jobs

Two pg_cron jobs manage the scoring system:

### 1. Queue Movies (Daily at Midnight UTC)

```sql
SELECT cron.schedule(
    'queue-movies-for-scoring',
    '0 0 * * *',
    $$SELECT queue_movies_for_scoring()$$
);
```

Finds all released, drafted movies that haven't been scored today.

### 2. Process Queue (Every Minute)

```sql
SELECT cron.schedule(
    'process-score-queue',
    '* * * * *',
    $$SELECT process_score_queue()$$
);
```

Processes batches of 5 movies from the queue.

## Configuration

### Required Environment Variables

```bash
# Edge Function environment variables
MDBLIST_API_KEY=your_mdblist_api_key   # Free at mdblist.com (1,000 req/day)
# Note: TMDB_API_KEY is still used by browse-movies and search-movies (not scoring)
TMDB_API_KEY=your_tmdb_api_key
```

### Database Settings

For the queue processor to invoke Edge Functions, configure these in your database:

```sql
-- Set in Supabase Dashboard > Database > Settings > Database Settings
ALTER DATABASE postgres SET app.supabase_url = 'https://your-project.supabase.co';
ALTER DATABASE postgres SET app.service_role_key = 'your-service-role-key';
```

**Security Note**: The service role key is stored in the database for pg_cron to use. This is secure because:
- Only the database can access these settings
- pg_cron runs with database privileges
- The key is not exposed to client applications

## Manual Operations

### Queue a Specific Movie for Scoring

```sql
SELECT queue_movie_for_scoring('movie-uuid-here');
```

### Trigger Immediate Score Update

```sql
-- Process one batch immediately
SELECT process_score_queue();
```

### Recalculate a Team's Score

```sql
-- Read-only preview
SELECT * FROM calculate_team_score('team-uuid-here');

-- Write the result to team_scores
SELECT recalculate_team_score_with_counterpicks('team-uuid-here');
```

## What Counts Toward a Team Score

A team's `total_points` is the sum of three legs:

| Leg | Source | Column | Sign |
|-----|--------|--------|------|
| Draft | `draft_picks` where `dropped_at IS NULL` | `draft_points` | As scored |
| Pickup | `pickups` where `dropped_at IS NULL` | `pickup_points` | As scored |
| Counterpick | `counterpicks` | `counterpick_points` | **Inverted** (`-fantasy_points`) |

Every leg counts a movie only once it has released (`movie_has_released`); a
pre-release score is pending until then. See
[Pre-release scores](#pre-release-scores).

`movies_scored`, `movies_pending`, and `average_score` cover the active roster
(draft picks + pickups) and exclude counterpicks, which are reported separately
via `counterpicks_made` / `counterpicks_scored`.

Dropping a movie stops it scoring immediately — the row is soft-deleted via
`dropped_at` and both legs filter on it. Because a dropped movie becomes
eligible for pickup again, the same movie can appear in both tables for a
league; only the active row counts, and `idx_pickups_league_movie_active`
(UNIQUE on `(league_id, movie_id) WHERE dropped_at IS NULL`) guarantees at most
one active holder.

`recalculate_teams_for_movie(movie_id)` fans out to every team affected by a
movie: its current holder (whether by draft or pickup) and any counterpickers.

### View Queue Status

```sql
-- See pending messages
SELECT * FROM pgmq.q_movie_scores;

-- Count pending
SELECT COUNT(*) FROM pgmq.q_movie_scores;
```

## Monitoring

### Backlog Visibility

Each nightly (no-body) run records `eligible` (movies matching the selection
before the 30-movie limit) and `backlog` (`eligible − selected`) in its
`job_runs.metadata` and response body. A nonzero backlog is normal after a
release-heavy stretch and drains at 30 per run; a backlog that **grows** run
over run is the starvation signature throughput metrics can't show (every run
reports 30 processed, `ok`). When the backlog exceeds a full batch *and* is
worse than the previous instrumented run, an ops alert fires via `alertOps`.

```sql
-- Backlog trend, newest first
SELECT started_at, metadata->>'eligible' AS eligible, metadata->>'backlog' AS backlog
FROM job_runs
WHERE job_name = 'update-scores' AND metadata ? 'backlog'
ORDER BY started_at DESC LIMIT 14;
```

### Check Cron Job Status

```sql
SELECT * FROM cron.job;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### View Recent Score Updates

```sql
SELECT
    m.title,
    m.combined_score,
    m.scores_updated_at,
    r_imdb.score AS imdb,
    r_rt.score AS rotten_tomatoes,
    r_mc.score AS metacritic
FROM movies m
LEFT JOIN reviews r_imdb ON m.id = r_imdb.movie_id AND r_imdb.source = 'imdb'
LEFT JOIN reviews r_rt ON m.id = r_rt.movie_id AND r_rt.source = 'rotten_tomatoes'
LEFT JOIN reviews r_mc ON m.id = r_mc.movie_id AND r_mc.source = 'metacritic'
WHERE m.scores_updated_at IS NOT NULL
ORDER BY m.scores_updated_at DESC
LIMIT 20;
```

### View Team Standings

```sql
SELECT
    t.name AS team_name,
    ts.total_points,
    ts.movies_scored,
    ts.movies_pending,
    ts.average_score
FROM team_scores ts
JOIN teams t ON ts.team_id = t.id
ORDER BY ts.total_points DESC;
```

## Troubleshooting

### Movies Not Getting Scored

1. **Check if movie is drafted**:
   ```sql
   SELECT * FROM draft_picks WHERE movie_id = 'movie-uuid';
   ```

2. **Check if movie is released**:
   ```sql
   SELECT release_date, status FROM movies WHERE id = 'movie-uuid';
   ```

3. **Check queue for pending messages**:
   ```sql
   SELECT * FROM pgmq.q_movie_scores;
   ```

4. **Manually queue the movie**:
   ```sql
   SELECT queue_movie_for_scoring('movie-uuid');
   ```

### Edge Function Errors

Check Supabase Dashboard > Edge Functions > Logs for the `update-scores` function.

Common issues:
- **Missing API key**: Ensure `MDBLIST_API_KEY` is set
- **Rate limiting**: MDBList free tier allows 1,000 req/day
- **Network errors**: Transient; re-invoke the function

### Cron Jobs Not Running

1. **Verify pg_cron extension**:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. **Check job schedule**:
   ```sql
   SELECT * FROM cron.job WHERE jobname LIKE '%score%';
   ```

3. **View recent runs**:
   ```sql
   SELECT * FROM cron.job_run_details
   WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE '%score%')
   ORDER BY start_time DESC;
   ```

## Local Testing

The scoring system can be tested locally with some manual steps since pg_cron's background scheduler has limitations in local development.

### Prerequisites

1. **API Keys** - You need an MDBList API key:
   ```bash
   # Get a free MDBList key at: https://mdblist.com (1,000 req/day)
   ```

2. **Set environment variables** for Edge Functions:
   ```bash
   # In supabase/functions/.env
   MDBLIST_API_KEY=your_mdblist_key
   ```

### Step-by-Step Local Testing

#### 1. Start Supabase and Edge Functions

```bash
# Terminal 1: Start Supabase
npx supabase start

# Terminal 2: Serve Edge Functions
npx supabase functions serve --env-file ./supabase/functions/.env.local
```

#### 2. Reset Database with Seed Data

```bash
npx supabase db reset
```

#### 3. Test Individual Components

**Test the queue function (Layer 1):**
```sql
-- Connect to local DB: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres

-- Queue all eligible movies
SELECT queue_movies_for_scoring();

-- Check queue contents
SELECT * FROM pgmq.q_movie_scores;
```

**Test the Edge Function directly:**
```bash
# Get a released movie ID from seed data
MOVIE_ID="f0000016-0000-0000-0000-000000000016"  # Oppenheimer

# Call the Edge Function directly
curl -X POST http://127.0.0.1:54321/functions/v1/update-scores \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU" \
  -d '{
    "movie_ids": ["'"$MOVIE_ID"'"]
  }'
```

**Test the PostgreSQL calculation function:**
```sql
-- Calculate score for a movie (after reviews exist)
SELECT calculate_movie_score('f0000016-0000-0000-0000-000000000016');

-- View the result
SELECT title, combined_score, scores_updated_at
FROM movies
WHERE id = 'f0000016-0000-0000-0000-000000000016';

-- Check team scores were updated
SELECT t.name, ts.total_points, ts.movies_scored, ts.average_score
FROM team_scores ts
JOIN teams t ON ts.team_id = t.id;
```

#### 4. Full Flow Test (Manual)

Since pg_cron + pg_net may not work reliably locally, simulate the full flow:

```sql
-- Step 1: Queue a movie
SELECT queue_movie_for_scoring('f0000016-0000-0000-0000-000000000016');

-- Step 2: Read from queue (simulating what process_score_queue does)
SELECT * FROM pgmq.read('movie_scores', 120, 5);
```

Then call the Edge Function with the movie IDs from step 2, and finally:

```sql
-- Step 3: Delete the message after processing
SELECT pgmq.delete('movie_scores', 1);  -- Use actual msg_id
```

### Verify Scores

After processing, verify the scores were stored correctly:

```sql
-- View all reviews for a movie
SELECT m.title, r.source, r.score, r.raw_score
FROM movies m
JOIN reviews r ON m.id = r.movie_id
WHERE m.title = 'Oppenheimer';

-- View combined score
SELECT title, combined_score, scores_updated_at
FROM movies
WHERE combined_score IS NOT NULL
ORDER BY scores_updated_at DESC;
```

### Test Data Reference

The seed data includes these released movies with real IMDB IDs:

| Movie | IMDB ID | Status |
|-------|---------|--------|
| Oppenheimer | tt15398776 | released |
| Barbie | tt1517268 | released |
| Killers of the Flower Moon | tt6166392 | released |
| Wonka | tt6443346 | released |

These should return real scores from MDBList.

### Troubleshooting Local Testing

**Edge Function not receiving requests:**
```bash
# Check function logs
npx supabase functions logs update-scores
```

**Queue not working:**
```sql
-- Verify pgmq extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pgmq';

-- Manually create queue if needed
SELECT pgmq.create('movie_scores');
```

**Missing IMDB ID:**
```sql
-- Check which movies have IMDB IDs
SELECT id, title, imdb_id FROM movies WHERE imdb_id IS NOT NULL;
```

## Extending the System

### Adding a New Review Source

1. Add the source to the `reviews` table check constraint:
   ```sql
   ALTER TABLE reviews DROP CONSTRAINT reviews_source_check;
   ALTER TABLE reviews ADD CONSTRAINT reviews_source_check
       CHECK (source IN ('imdb', 'rotten_tomatoes', 'metacritic', 'new_source'));
   ```

2. Update the Edge Function to parse the new source format

3. The new source is **display-only** unless `calculate_movie_score()` is also changed — scoring reads only the `rotten_tomatoes` row. Wiring a new source into the score itself means changing the curve logic, not just adding a weight.

### Changing the Curve Constants

There are no per-source weights anymore. The curve's constants (60-point baseline, the 90+ accelerator, and the halving slopes below 50) live directly in `calculate_movie_score()`. Edit them there, e.g.:

```sql
CREATE OR REPLACE FUNCTION calculate_movie_score(p_movie_id UUID) ...
    BASELINE CONSTANT DECIMAL := 60;   -- Tuned to RT's "Fresh" cutoff
    -- 90+ tier:   30 + (rt - 90) * 2
    -- 50-89 tier: rt - BASELINE
    -- below 50:   halving-slope tiers, see formula above
```

Then recalculate all existing scores:

```sql
-- Queue all scored movies for recalculation
SELECT pgmq.send(
    'movie_scores',
    jsonb_build_object('movie_id', id)
)
FROM movies WHERE combined_score IS NOT NULL;
```

## API Rate Limits

| Service | Limit | Notes |
|---------|-------|-------|
| MDBList | 1,000/day (free) | We use ~60/day; supports TMDb ID lookup |
| TMDb | 40 req/10 sec | Used by browse-movies/search-movies, not scoring |

The 50ms delay between movies in the Edge Function helps respect these limits.
