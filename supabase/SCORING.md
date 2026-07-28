# Movie Scoring System

Fantasy Reel uses a three-layer architecture to automatically fetch and calculate movie scores from multiple review sources. Scores are updated daily to reflect the latest ratings.

## Overview

When movies are released, their scores are fetched from:
- **IMDb** (35% weight) - Broad audience ratings
- **Rotten Tomatoes** (40% weight) - Critic consensus (Tomatometer)
- **Metacritic** (25% weight) - Weighted critic average

These are combined into a weighted average (`combined_score`, 0-100 scale) which is then converted to **fantasy points** using a baseline-relative formula.

## Fantasy Points Formula

Unlike a simple average, fantasy points reward excellence and penalize poor performance relative to a 70-point baseline:

### Base Points

| Weighted Average | Calculation | Example |
|------------------|-------------|---------|
| 90+ | +20 base + 2 pts per point above 90 | 95 avg → +20 + (5×2) = **+30** |
| 70-89 | +1 pt per point above 70 | 82 avg → **+12** |
| Below 70 | -0.5 pts per point below 70 (floor: -15) | 55 avg → (55-70)×-0.5 = **-7.5** |

### Bonus Multipliers

| Bonus | Condition | Points |
|-------|-----------|--------|
| **Certified Fresh** | RT ≥ 75% | +3 |
| **Critical Darling** | All 3 sources ≥ 80 | +5 |
| **Critical Disaster** | Any source < 40 | -5 (doesn't stack) |

### Example Calculations

| Movie | Avg | Base | Bonuses | Fantasy Pts |
|-------|-----|------|---------|-------------|
| Excellent (92 avg, all ≥80) | 92 | +24 | +3 CF, +5 Darling | **+32** |
| Good (82 avg, RT=78) | 82 | +12 | +3 CF | **+15** |
| Average (70 avg) | 70 | 0 | - | **0** |
| Poor (55 avg) | 55 | -7.5 | - | **-8** |
| Disaster (32 avg, IMDb=25) | 32 | -15 | -5 Disaster | **-20** |

### Key Design Decisions

1. **70 as baseline**: The average movie scores around 70. Above = positive points, below = negative.
2. **Accelerated rewards**: 90+ movies get disproportionately more points to reward finding gems.
3. **Capped penalties**: The -15 floor prevents one terrible movie from destroying a team.
4. **Bonuses encourage quality**: Certified Fresh and Critical Darling reward consistent excellence.
5. **Counter-pick ready**: `fantasy_points` is stored separately from raw scores for future features.

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
│  │  For each movie (up to 30 per invocation):                            │  │
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
│  │  - Read IMDb, RT, Metacritic from reviews table                       │  │
│  │  - Calculate weighted average (combined_score)                        │  │
│  │  - Apply hybrid formula → fantasy_points                              │  │
│  │  - Check bonuses (CF, Darling, Disaster)                              │  │
│  │  - Update movies.fantasy_points + scoring_bonuses                     │  │
│  │  - Trigger recalculate_teams_for_movie()                               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Why MDBList?

MDBList (`mdblist.com`) aggregates ratings from 9+ sources, returning pre-normalized 0-100 scores. It supports lookup by TMDb ID directly, eliminating the need for IMDb ID resolution. Free tier allows 1,000 requests/day (we use ~60/day).

### Architecture Simplification

The original three-layer architecture (pgmq queue → pg_cron scheduler → Edge Function worker) was replaced with a simpler single Edge Function (`update-scores`) invoked directly by Vercel Cron. This is sufficient for our scale and easier to maintain.

### Why These Weights?

| Source | Weight | Rationale |
|--------|--------|-----------|
| Rotten Tomatoes | 40% | Most recognized critic aggregator, binary "fresh/rotten" is clear |
| IMDb | 35% | Largest audience database, good for mainstream appeal |
| Metacritic | 25% | More selective critic pool, weighted reviews |

Weights can be adjusted in the `calculate_movie_score()` function.

## Database Schema

### Movies Table (scoring columns)

```sql
ALTER TABLE movies ADD COLUMN combined_score DECIMAL(5, 2);   -- Weighted average (0-100)
ALTER TABLE movies ADD COLUMN fantasy_points DECIMAL(6, 2);    -- Hybrid formula result (can be negative)
ALTER TABLE movies ADD COLUMN scoring_bonuses JSONB;           -- { certified_fresh, critical_darling, critical_disaster }
ALTER TABLE movies ADD COLUMN scores_updated_at TIMESTAMPTZ;
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

### Step 1: Weighted Average (combined_score)

```
combined_score = (IMDb * 0.35 + RT * 0.40 + Metacritic * 0.25) / sum_of_available_weights
```

If only some sources are available, the weights are normalized:

| Available Sources | Calculation |
|-------------------|-------------|
| All three | `(imdb*0.35 + rt*0.40 + mc*0.25) / 1.0` |
| IMDb + RT | `(imdb*0.35 + rt*0.40) / 0.75` |
| RT + Metacritic | `(rt*0.40 + mc*0.25) / 0.65` |
| IMDb only | `imdb` (no weighting) |

### Step 2: Fantasy Points (hybrid formula)

```sql
-- Base points from combined_score
IF combined_score >= 90 THEN
    base_pts = 20 + (combined_score - 90) * 2
ELSIF combined_score >= 70 THEN
    base_pts = combined_score - 70
ELSE
    base_pts = GREATEST((70 - combined_score) * -0.5, -15)  -- Floor at -15
END IF

-- Apply bonuses
IF rt >= 75 THEN fantasy_pts += 3                              -- Certified Fresh
IF imdb >= 80 AND rt >= 80 AND mc >= 80 THEN fantasy_pts += 5  -- Critical Darling
IF imdb < 40 OR rt < 40 OR mc < 40 THEN fantasy_pts -= 5       -- Critical Disaster
```

### Example

Movie: "Inception"
- IMDb: 8.8/10 → 88
- RT: 87% → 87
- Metacritic: 74/100 → 74

```
combined_score = (88 * 0.35 + 87 * 0.40 + 74 * 0.25) / 1.0
               = (30.8 + 34.8 + 18.5) / 1.0
               = 84.1

fantasy_points = base_pts + bonuses
               = (84.1 - 70) + 3     -- 14.1 base + Certified Fresh (RT >= 75)
               = +17.1
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

`captureScoreContext` records each movie's `fantasy_points` plus the full
standings of every league holding those movies. Snapshotting *all* active
participants' teams in a league — rather than only the ones whose movies
scored — is what makes rank movement detectable for teams that were passed
without scoring themselves. (The same `status = 'active'` filter the standings
page uses, so Discord ranks agree with the site.)

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

Three events are reported:

| Event | Message |
|-------|---------|
| Movie scores for the first time | `Now has a score of **80.3**` |
| Movie's score moves | `Score has gone **UP** from **81.2** to **82.7**` |
| Team's score and/or rank changes | `Standings Update` embed, one field per team |

Each changed movie gets its own message (titled with the movie, attributing the
owning team and any counterpicker). Each league then gets a single
`Standings Update` roundup listing every team whose score or rank moved.

Notes:

- **Scores** are compared at **display precision** (one decimal), so a change
  too small to render never triggers a notification. **Ranks** are computed
  from exact points, matching the standings page. The asymmetry is
  intentional but visible: if a rival slips 10.01 → 10.00 you can be told you
  "moved from 2nd to 1st" with no score line, because the change that caused
  it rounds away at one decimal. Discord and the site agree; only the
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
SELECT * FROM calculate_team_score('team-uuid-here');
```

### View Queue Status

```sql
-- See pending messages
SELECT * FROM pgmq.q_movie_scores;

-- Count pending
SELECT COUNT(*) FROM pgmq.q_movie_scores;
```

## Monitoring

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

3. Update `calculate_movie_score()` to include the new weight:
   ```sql
   -- Add new weight constant
   W_NEW CONSTANT DECIMAL := 0.10;
   -- Adjust other weights to sum to 1.0
   ```

### Changing Score Weights

Edit the constants in `calculate_movie_score()`:

```sql
CREATE OR REPLACE FUNCTION calculate_movie_score(p_movie_id UUID) ...
    W_IMDB CONSTANT DECIMAL := 0.30;  -- Was 0.35
    W_RT CONSTANT DECIMAL := 0.45;    -- Was 0.40
    W_MC CONSTANT DECIMAL := 0.25;    -- Unchanged
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
