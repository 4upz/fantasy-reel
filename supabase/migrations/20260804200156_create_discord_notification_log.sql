-- ============================================================================
-- Discord Notification Log
--
-- Idempotency tracking for scheduled Discord notifications that must not
-- double-send across cron reruns within the same day (e.g. release-day
-- announcements). One row per (league, movie, notification_type) sent.
--
-- Service-role-only: no RLS policies are defined, so only Edge Functions
-- using the service role client can read or write this table.
-- ============================================================================

CREATE TABLE discord_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_discord_notification_log UNIQUE (league_id, movie_id, notification_type)
);

COMMENT ON TABLE discord_notification_log IS 'Idempotency log for scheduled Discord notifications (e.g. release-day announcements) -- prevents double-sending on cron reruns.';
COMMENT ON COLUMN discord_notification_log.notification_type IS 'e.g. release_day -- distinguishes different scheduled notification kinds sharing this log.';

CREATE INDEX idx_discord_notification_log_league_movie ON discord_notification_log(league_id, movie_id);

ALTER TABLE discord_notification_log ENABLE ROW LEVEL SECURITY;
-- No policies defined: only the service role (which bypasses RLS) may access this table.
