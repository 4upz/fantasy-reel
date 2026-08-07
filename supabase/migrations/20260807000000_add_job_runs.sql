-- ============================================================================
-- Job Runs
--
-- Persisted outcome of every scheduled-job execution. Cron Edge Functions
-- record one row per run (status, counts, per-item errors, timing) so
-- partial failures are visible and run history survives beyond the HTTP
-- response that Vercel's cron proxy relays and discards.
--
-- Service-role-only: no RLS policies are defined, so only Edge Functions
-- using the service role client can read or write this table.
-- ============================================================================

-- job_runs: persisted outcome of every scheduled-job execution
CREATE TABLE job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer NOT NULL,
  items_processed integer NOT NULL DEFAULT 0,
  items_failed integer NOT NULL DEFAULT 0,
  errors jsonb,
  request_id text,
  metadata jsonb
);

COMMENT ON TABLE job_runs IS 'One row per scheduled-job (cron Edge Function) execution: status, item counts, per-item errors, and timing -- makes partial failures visible and keeps run history.';
COMMENT ON COLUMN job_runs.status IS 'ok = no item failures; partial = some items failed; failed = every attempted item failed or the run aborted.';
COMMENT ON COLUMN job_runs.errors IS 'Per-item error details (truncated to the first 50 entries; truncation is noted in metadata).';
COMMENT ON COLUMN job_runs.request_id IS 'X-Request-Id of the invocation that produced this run, for correlating with structured logs.';

-- Run history per job, newest first.
CREATE INDEX idx_job_runs_job_name_started_at ON job_runs(job_name, started_at DESC);
-- Fast "what went wrong lately" lookups across all jobs.
CREATE INDEX idx_job_runs_not_ok_started_at ON job_runs(started_at DESC) WHERE status <> 'ok';

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
-- No policies defined: only the service role (which bypasses RLS) may access this table.

-- ============================================================================
-- Unschedule the pg_cron process-trades job. process-trades now runs via
-- Vercel Cron (see apps/frontend/vercel.json), the same path as every other
-- scheduled job, so its runs are recorded in job_runs and surfaced in the
-- Vercel cron dashboard. Guarded so this is safe on a fresh local db reset
-- and on databases without the pg_cron extension.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-trades') THEN
    PERFORM cron.unschedule('process-trades');
  END IF;
END $$;
