# Movie Scoring System

Fantasy Reel uses a three-layer architecture to automatically fetch and calculate movie scores from multiple review sources. Scores are updated daily to reflect the latest ratings.

## Overview

When movies are released, their scores are fetched from:
- **IMDb** (35% weight) - Broad audience ratings
- **Rotten Tomatoes** (40% weight) - Critic consensus (Tomatometer)
- **Metacritic** (25% weight) - Weighted critic average

These are combined into a single `combined_score` (0-100 scale) that determines fantasy points.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LAYER 1: QUEUE (pgmq)                                │
│                                                                             │
│  ┌─────────────────┐         ┌──────────────────────────────────────────┐  │
│  │ Daily pg_cron   │────────▶│  queue_movies_for_scoring()              │  │
│  │ (midnight UTC)  │         │  - Find released movies needing updates  │  │
│  └─────────────────┘         │  - pgmq.send() each movie_id to queue    │  │
│                              └──────────────────────────────────────────┘  │
│                                             │                               │
│                                             ▼                               │
│                              ┌──────────────────────────────────────────┐  │
│                              │  pgmq.q_movie_scores                     │  │
│                              │  [movie_id, movie_id, movie_id, ...]     │  │
│                              └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      LAYER 2: SCHEDULER (pg_cron)                           │
│                                                                             │
│  ┌─────────────────┐         ┌──────────────────────────────────────────┐  │
│  │ pg_cron         │────────▶│  process_score_queue()                   │  │
│  │ (every minute)  │         │  - pgmq.read() batch of 5 messages       │  │
│  └─────────────────┘         │  - pg_net.http_post() to Edge Function   │  │
│                              │  - Pass movie_ids as payload             │  │
│                              └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      LAYER 3: WORKER (Edge Function)                        │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  process-movie-scores (lightweight)                                   │  │
│  │                                                                       │  │
│  │  For each movie_id in batch (max 5):                                  │  │
│  │    1. If no imdb_id → fetch from TMDB /external_ids                   │  │
│  │    2. Fetch scores from OMDB API                                      │  │
│  │    3. INSERT/UPDATE reviews table                                     │  │
│  │    4. Call calculate_movie_score(movie_id) ─────┐                     │  │
│  │    5. pgmq.delete() the message                 │                     │  │
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
│  │  - Apply weights: IMDb=0.35, RT=0.40, Metacritic=0.25                 │  │
│  │  - Update movies.combined_score                                       │  │
│  │  - Trigger recalculate_teams_for_movie()                               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Why Three Layers?

1. **Edge Function CPU Limits**: Supabase Edge Functions have a 2-second CPU time limit. Processing many movies in one call would exceed this.

2. **Batch Processing**: By processing 5 movies at a time, we stay well within limits while making steady progress.

3. **Automatic Retry**: pgmq's visibility timeout ensures failed messages are automatically retried after 120 seconds.

4. **Heavy Lifting in PostgreSQL**: All score calculations and team updates happen in the database, not the Edge Function.

### Why These Weights?

| Source | Weight | Rationale |
|--------|--------|-----------|
| Rotten Tomatoes | 40% | Most recognized critic aggregator, binary "fresh/rotten" is clear |
| IMDb | 35% | Largest audience database, good for mainstream appeal |
| Metacritic | 25% | More selective critic pool, weighted reviews |

Weights can be adjusted in the `calculate_movie_score()` function.

## Database Schema

### Movies Table (new columns)

```sql
ALTER TABLE movies ADD COLUMN combined_score DECIMAL(5, 2);
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

### Formula

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

### Example

Movie: "Inception"
- IMDb: 8.8/10 → 88
- RT: 87% → 87
- Metacritic: 74/100 → 74

```
combined_score = (88 * 0.35 + 87 * 0.40 + 74 * 0.25) / 1.0
               = (30.8 + 34.8 + 18.5) / 1.0
               = 84.1
```

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
OMDB_API_KEY=your_omdb_api_key
# TMDB_API_KEY should be the "API Read Access Token" (Bearer token),
# NOT the v3 API Key. Get it from: https://www.themoviedb.org/settings/api
TMDB_API_KEY=your_tmdb_read_access_token
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

Check Supabase Dashboard > Edge Functions > Logs for the `process-movie-scores` function.

Common issues:
- **Missing API keys**: Ensure `OMDB_API_KEY` and `TMDB_API_KEY` are set
- **Rate limiting**: OMDB has daily limits; consider caching or upgrading
- **Network errors**: Transient; messages will retry automatically

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

1. **API Keys** - You need OMDB and TMDB API keys:
   ```bash
   # Get a free OMDB key at: https://www.omdbapi.com/apikey.aspx
   # Get a free TMDB key at: https://www.themoviedb.org/settings/api
   ```

2. **Set environment variables** for Edge Functions:
   ```bash
   # In supabase/functions/.env.local (create if not exists)
   OMDB_API_KEY=your_omdb_key
   TMDB_API_KEY=your_tmdb_bearer_token
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

**Test the Edge Function directly (Layer 3):**
```bash
# Get a released movie ID from seed data
MOVIE_ID="f0000016-0000-0000-0000-000000000016"  # Oppenheimer

# Call the Edge Function directly
curl -X POST http://127.0.0.1:54321/functions/v1/process-movie-scores \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU" \
  -d '{
    "movie_ids": ["'"$MOVIE_ID"'"],
    "msg_ids": [1]
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

These should return real scores from OMDB.

### Troubleshooting Local Testing

**Edge Function not receiving requests:**
```bash
# Check function logs
npx supabase functions logs process-movie-scores
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
| OMDB | 1,000/day (free) | Consider paid tier for production |
| TMDB | 40 req/10 sec | Rarely hit with batch processing |

The 100ms delay between movies in the Edge Function helps respect these limits.
