-- Migration: Add Movie Scoring System
-- Implements three-layer architecture: pgmq queue + pg_cron scheduler + Edge Function workers
--
-- Layer 1: Queue (pgmq) - Manages movies needing score updates
-- Layer 2: Scheduler (pg_cron) - Triggers batch processing
-- Layer 3: Worker (Edge Function) - Fetches scores from APIs
-- Heavy calculation done in PostgreSQL functions

-- ============================================================================
-- ENABLE REQUIRED EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- SCHEMA CHANGES: Add scoring columns to movies table
-- ============================================================================
ALTER TABLE movies ADD COLUMN IF NOT EXISTS combined_score DECIMAL(5, 2);
ALTER TABLE movies ADD COLUMN IF NOT EXISTS scores_updated_at TIMESTAMPTZ;

-- Create index for efficient score update queries
CREATE INDEX IF NOT EXISTS idx_movies_scores_updated_at ON movies(scores_updated_at);
CREATE INDEX IF NOT EXISTS idx_movies_combined_score ON movies(combined_score);

-- ============================================================================
-- CREATE QUEUE FOR MOVIE SCORE UPDATES
-- ============================================================================
SELECT pgmq.create('movie_scores');

-- ============================================================================
-- WEIGHTED SCORE CALCULATION FUNCTION
-- This is where the heavy lifting happens - all in PostgreSQL
--
-- Weights (configurable):
--   IMDb: 35% - Broad audience scores, large sample size
--   Rotten Tomatoes: 40% - Critic consensus (Tomatometer)
--   Metacritic: 25% - Weighted critic average, more selective
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_movie_score(p_movie_id UUID)
RETURNS DECIMAL AS $$
DECLARE
    v_imdb DECIMAL;
    v_rt DECIMAL;
    v_mc DECIMAL;
    v_weight_sum DECIMAL := 0;
    v_score_sum DECIMAL := 0;
    v_combined DECIMAL;
    -- Configurable weights (must sum to 1.0)
    W_IMDB CONSTANT DECIMAL := 0.35;
    W_RT CONSTANT DECIMAL := 0.40;
    W_MC CONSTANT DECIMAL := 0.25;
BEGIN
    -- Get individual scores from reviews table
    SELECT score INTO v_imdb FROM reviews
        WHERE movie_id = p_movie_id AND source = 'imdb';
    SELECT score INTO v_rt FROM reviews
        WHERE movie_id = p_movie_id AND source = 'rotten_tomatoes';
    SELECT score INTO v_mc FROM reviews
        WHERE movie_id = p_movie_id AND source = 'metacritic';

    -- Calculate weighted average (normalize against available weights)
    IF v_imdb IS NOT NULL THEN
        v_score_sum := v_score_sum + (v_imdb * W_IMDB);
        v_weight_sum := v_weight_sum + W_IMDB;
    END IF;

    IF v_rt IS NOT NULL THEN
        v_score_sum := v_score_sum + (v_rt * W_RT);
        v_weight_sum := v_weight_sum + W_RT;
    END IF;

    IF v_mc IS NOT NULL THEN
        v_score_sum := v_score_sum + (v_mc * W_MC);
        v_weight_sum := v_weight_sum + W_MC;
    END IF;

    -- Return NULL if no scores available
    IF v_weight_sum = 0 THEN
        RETURN NULL;
    END IF;

    v_combined := ROUND(v_score_sum / v_weight_sum, 2);

    -- Update movie record with combined score
    UPDATE movies SET
        combined_score = v_combined,
        scores_updated_at = NOW(),
        status = 'released'
    WHERE id = p_movie_id;

    -- Cascade: Recalculate scores for all teams that drafted this movie
    PERFORM recalculate_teams_for_movie(p_movie_id);

    RETURN v_combined;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RECALCULATE TEAM SCORES FOR A SPECIFIC MOVIE
-- Called after a movie's combined_score is updated
-- ============================================================================
CREATE OR REPLACE FUNCTION recalculate_teams_for_movie(p_movie_id UUID)
RETURNS void AS $$
DECLARE
    v_team RECORD;
BEGIN
    -- Find all teams that drafted this movie and recalculate their scores
    FOR v_team IN
        SELECT DISTINCT dp.team_id
        FROM draft_picks dp
        WHERE dp.movie_id = p_movie_id
    LOOP
        -- Update team_scores using combined_score from movies table
        INSERT INTO team_scores (team_id, total_points, movies_scored, movies_pending, average_score, last_calculated_at)
        SELECT
            v_team.team_id,
            COALESCE(SUM(m.combined_score), 0),
            COUNT(m.combined_score)::INTEGER,
            COUNT(*) FILTER (WHERE m.combined_score IS NULL)::INTEGER,
            COALESCE(AVG(m.combined_score), 0),
            NOW()
        FROM draft_picks dp
        JOIN movies m ON dp.movie_id = m.id
        WHERE dp.team_id = v_team.team_id
        ON CONFLICT (team_id) DO UPDATE SET
            total_points = EXCLUDED.total_points,
            movies_scored = EXCLUDED.movies_scored,
            movies_pending = EXCLUDED.movies_pending,
            average_score = EXCLUDED.average_score,
            last_calculated_at = EXCLUDED.last_calculated_at;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE calculate_team_score TO USE combined_score
-- This replaces the original function that averaged all review sources
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE(
    total_points DECIMAL,
    movies_scored INTEGER,
    movies_pending INTEGER,
    average_score DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(m.combined_score), 0::DECIMAL) AS total_points,
        COUNT(m.combined_score)::INTEGER AS movies_scored,
        COUNT(*) FILTER (WHERE m.combined_score IS NULL)::INTEGER AS movies_pending,
        CASE
            WHEN COUNT(m.combined_score) > 0
            THEN ROUND(COALESCE(SUM(m.combined_score), 0) / COUNT(m.combined_score), 2)
            ELSE 0::DECIMAL
        END AS average_score
    FROM draft_picks dp
    JOIN movies m ON dp.movie_id = m.id
    WHERE dp.team_id = p_team_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- LAYER 1: QUEUE MOVIES FOR SCORING
-- Runs daily at midnight - finds released movies that need score updates
-- Only queues movies that have been drafted (we don't score undrafted movies)
-- ============================================================================
CREATE OR REPLACE FUNCTION queue_movies_for_scoring()
RETURNS INTEGER AS $$
DECLARE
    v_movie RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Find released movies that need score updates
    -- Criteria:
    --   1. Movie has been drafted (exists in draft_picks)
    --   2. Release date has passed
    --   3. Either never scored OR not scored today
    FOR v_movie IN
        SELECT DISTINCT m.id
        FROM movies m
        INNER JOIN draft_picks dp ON dp.movie_id = m.id
        WHERE m.release_date <= CURRENT_DATE
        AND (
            m.scores_updated_at IS NULL
            OR m.scores_updated_at::DATE < CURRENT_DATE
        )
    LOOP
        -- Queue each movie for processing
        PERFORM pgmq.send(
            'movie_scores',
            jsonb_build_object('movie_id', v_movie.id)
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- LAYER 2: PROCESS SCORE QUEUE IN BATCHES
-- Reads messages from queue and invokes Edge Function
-- Runs frequently (every minute) to process backlog
-- ============================================================================
CREATE OR REPLACE FUNCTION process_score_queue()
RETURNS void AS $$
DECLARE
    v_message RECORD;
    v_movie_ids jsonb := '[]'::jsonb;
    v_msg_ids jsonb := '[]'::jsonb;
    v_supabase_url text;
    v_service_key text;
BEGIN
    -- Get configuration from app settings
    -- These must be set via: ALTER DATABASE postgres SET app.supabase_url = 'https://...';
    BEGIN
        v_supabase_url := current_setting('app.supabase_url');
        v_service_key := current_setting('app.service_role_key');
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'app.supabase_url or app.service_role_key not configured. Skipping queue processing.';
        RETURN;
    END;

    -- Read batch of 5 messages with 120 second visibility timeout
    -- If processing fails, messages become visible again after timeout
    FOR v_message IN
        SELECT * FROM pgmq.read('movie_scores', 120, 5)
    LOOP
        v_movie_ids := v_movie_ids || jsonb_build_array(v_message.message->'movie_id');
        v_msg_ids := v_msg_ids || jsonb_build_array(v_message.msg_id);
    END LOOP;

    -- If we have messages, invoke the Edge Function
    IF jsonb_array_length(v_movie_ids) > 0 THEN
        PERFORM net.http_post(
            url := v_supabase_url || '/functions/v1/process-movie-scores',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            ),
            body := jsonb_build_object(
                'movie_ids', v_movie_ids,
                'msg_ids', v_msg_ids
            )
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- HELPER: Delete message from queue (called by Edge Function after processing)
-- ============================================================================
CREATE OR REPLACE FUNCTION delete_score_queue_message(p_msg_id BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN pgmq.delete('movie_scores', p_msg_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- HELPER: Manually trigger score update for a specific movie
-- Useful for testing or manual refreshes
-- ============================================================================
CREATE OR REPLACE FUNCTION queue_movie_for_scoring(p_movie_id UUID)
RETURNS BIGINT AS $$
BEGIN
    RETURN pgmq.send(
        'movie_scores',
        jsonb_build_object('movie_id', p_movie_id)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SCHEDULE CRON JOBS
-- Note: pg_cron uses minute-level granularity
-- ============================================================================

-- Daily at midnight UTC: Queue all movies needing score updates
SELECT cron.schedule(
    'queue-movies-for-scoring',
    '0 0 * * *',
    $$SELECT queue_movies_for_scoring()$$
);

-- Every minute: Process batches from the queue
SELECT cron.schedule(
    'process-score-queue',
    '* * * * *',
    $$SELECT process_score_queue()$$
);

-- ============================================================================
-- GRANT PERMISSIONS
-- Allow service role to manage queue messages
-- ============================================================================
GRANT USAGE ON SCHEMA pgmq TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA pgmq TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO service_role;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================
COMMENT ON FUNCTION calculate_movie_score(UUID) IS
'Calculates weighted average score for a movie using IMDb (35%), RT (40%), and Metacritic (25%).
Updates movies.combined_score and triggers team score recalculation.';

COMMENT ON FUNCTION queue_movies_for_scoring() IS
'Queues all released, drafted movies that need daily score updates. Runs via pg_cron at midnight UTC.';

COMMENT ON FUNCTION process_score_queue() IS
'Reads batches of 5 movies from the queue and invokes the Edge Function. Runs every minute via pg_cron.';

COMMENT ON FUNCTION recalculate_teams_for_movie(UUID) IS
'Recalculates team_scores for all teams that drafted a specific movie. Called after score updates.';
