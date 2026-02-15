-- Migration: Disable pg_cron scoring jobs
-- Scoring has been migrated to Vercel cron (see plans/scoring-cron-migration.md)
-- The Vercel cron at /api/cron/update-scores now handles daily scoring.

-- Unschedule pg_cron scoring jobs (idempotent)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'queue-movies-for-scoring') THEN
        PERFORM cron.unschedule('queue-movies-for-scoring');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-score-queue') THEN
        PERFORM cron.unschedule('process-score-queue');
    END IF;
END;
$$;

-- Note: We keep the following intact for potential rollback:
--   - pgmq queue (movie_scores)
--   - queue_movies_for_scoring() function
--   - process_score_queue() function
--   - delete_score_queue_message() function
--   - queue_movie_for_scoring() function
--   - calculate_movie_score() function
--   - recalculate_teams_for_movie() function
--
-- To rollback, re-enable with:
--   SELECT cron.schedule('queue-movies-for-scoring', '0 0 * * *', $$SELECT queue_movies_for_scoring()$$);
--   SELECT cron.schedule('process-score-queue', '* * * * *', $$SELECT process_score_queue()$$);
