-- ============================================================================
-- Add bot-admin role and digest/news notification toggles to discord_channels
--
-- bot_admin_role_id: a per-channel Discord role that may administer the bot
-- (alongside Manage Server permission holders and the league owner). Written
-- by /set-bot-admin-role, read by canAdministerBot() in the bot.
--
-- notify_weekly_digest / notify_movie_news: new /configure toggle columns
-- for the weekly releases digest and movie-news notifications.
-- ============================================================================

ALTER TABLE discord_channels ADD COLUMN bot_admin_role_id TEXT;
ALTER TABLE discord_channels ADD COLUMN notify_weekly_digest BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE discord_channels ADD COLUMN notify_movie_news BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN discord_channels.bot_admin_role_id IS 'Discord role ID granted bot-admin access in this channel, in addition to Manage Server permission holders and the league owner.';
COMMENT ON COLUMN discord_channels.notify_weekly_digest IS 'Toggle for the weekly upcoming-releases digest notification.';
COMMENT ON COLUMN discord_channels.notify_movie_news IS 'Toggle for movie-news notifications (release-day announcements, release-date changes).';

-- Recreate safe view to include the new columns (non-credential, safe to expose)
-- Must DROP first because CREATE OR REPLACE can't change column order
DROP VIEW IF EXISTS discord_channels_safe;
CREATE VIEW discord_channels_safe AS
  SELECT id, league_id, guild_id, channel_id, thread_id, notify_drafts, notify_bids,
         notify_trades, notify_scores, notify_weekly_digest, notify_movie_news,
         bid_alert_role_id, bot_admin_role_id, enabled, created_by,
         created_at, updated_at, last_error_at, consecutive_failures
  FROM discord_channels;
