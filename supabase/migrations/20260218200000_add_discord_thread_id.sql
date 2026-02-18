-- ============================================================================
-- Add thread_id to discord_channels
--
-- When a league is linked from a Discord forum post or thread, the webhook
-- must target a specific thread. Without thread_id, Discord API returns
-- error 220001: "Webhooks posted to forum channels must have a thread_name
-- or thread_id."
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discord_channels' AND column_name = 'thread_id'
  ) THEN
    ALTER TABLE discord_channels ADD COLUMN thread_id TEXT;
  END IF;
END $$;

COMMENT ON COLUMN discord_channels.thread_id IS 'Discord thread/forum-post ID. Required when webhook targets a forum channel or thread.';

-- Recreate safe view to include thread_id (non-credential, safe to expose)
-- Must DROP first because CREATE OR REPLACE can't change column order
DROP VIEW IF EXISTS discord_channels_safe;
CREATE VIEW discord_channels_safe AS
  SELECT id, league_id, guild_id, channel_id, thread_id, notify_drafts, notify_bids,
         notify_trades, notify_scores, bid_alert_role_id, enabled, created_by,
         created_at, updated_at, last_error_at, consecutive_failures
  FROM discord_channels;
