-- ============================================================================
-- Hide discord_channels.webhook_url from clients
--
-- The SELECT policy lets every league member read their league's channel rows,
-- and 20260805190000_restore_data_api_default_grants gave authenticated
-- table-wide SELECT, so any member could read webhook_url and post anything
-- (including @everyone) into the guild as "Fantasy Reel".
--
-- Nothing on the client reads this table. Every reader of webhook_url uses the
-- service role: the Edge Functions that post to Discord (_shared/discord.ts,
-- _shared/draft-notifications.ts, process-bids, send-announcement) and the
-- Discord bot. So clients keep the same non-credential columns that
-- discord_channels_safe exposes, and lose webhook_url and webhook_id.
--
-- A column-level REVOKE cannot carve a column out of a table-level grant, so
-- the table grant is revoked and the safe columns are granted back. The RLS
-- policies are unchanged: the owner INSERT/UPDATE/DELETE policies only need
-- SELECT on league_id and id, which stay granted.
-- ============================================================================

REVOKE SELECT ON public.discord_channels FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, league_id, guild_id, channel_id, thread_id, notify_drafts, notify_bids,
  notify_trades, notify_scores, notify_weekly_digest, notify_movie_news,
  bid_alert_role_id, bot_admin_role_id, enabled, created_by,
  created_at, updated_at, last_error_at, consecutive_failures
) ON public.discord_channels TO authenticated;

COMMENT ON COLUMN public.discord_channels.webhook_url IS 'Discord webhook URL -- treat as credential. Readable only by the service role; authenticated has column-level SELECT on the other columns.';
