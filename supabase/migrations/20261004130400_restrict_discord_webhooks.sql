-- ============================================================================
-- Restrict discord_channels writes to the Discord bot
--
-- 1. Owners could point a channel's webhook anywhere. The INSERT and UPDATE
--    policies let a league owner write every column straight through the Data
--    API, including webhook_url, and _shared/discord.ts POSTs to whatever is
--    stored there. That is a blind SSRF from our Edge Functions
--    (http://169.254.169.254/... inserted fine).
--
-- 2. The same INSERT path let anyone who owns a league write any channel_id.
--    channel_id is UNIQUE, so claiming another server's channel first blocked
--    that server from running /set-league in it.
--
-- Only the Discord bot creates links, with the service role, from inside the
-- channel being linked (/set-league takes interaction.channelId and the URL
-- discord.js returns for the webhook it just made). The web app has no Discord
-- screen and never writes this table. So:
--
--   * authenticated loses INSERT. channel_id can now only be claimed from the
--     channel itself, by someone the bot lets administer it there, and a
--     Manage Server admin can /remove-league a bad link. The UNIQUE stays:
--     the bot resolves a channel's league by channel_id (.maybeSingle()), and
--     start_next_season moves the one row on rollover.
--   * authenticated keeps UPDATE only on the notification toggles. Routing
--     (league_id, guild_id, channel_id, thread_id), the credential (webhook_id,
--     webhook_url), mention roles and health counters are service-role only.
--     DELETE (unlinking) is unchanged.
--   * a CHECK limits webhook_url to Discord's webhook endpoint, mirrored by
--     isAllowedWebhookUrl in _shared/discord.ts. The http://127.0.0.1,
--     localhost and host.docker.internal branch exists for the integration
--     tests' mock webhook server; the sender honours it only when SUPABASE_URL
--     is a local stack, so in production such a row is refused, not fetched.
--
-- The constraint is added NOT VALID so an unexpected existing row cannot fail
-- the deploy, then validated in the same migration when every row passes.
-- Rows that fail are left for a human (the sender already refuses them):
--   SELECT id, league_id FROM discord_channels
--   WHERE NOT (webhook_url ~ <pattern below>);
-- ============================================================================

-- Writes: the bot (service role) only, apart from the owner toggles.
REVOKE INSERT, UPDATE ON public.discord_channels FROM PUBLIC, anon, authenticated;

GRANT UPDATE (
  notify_drafts, notify_bids, notify_trades, notify_scores,
  notify_weekly_digest, notify_movie_news, enabled
) ON public.discord_channels TO authenticated;

DROP POLICY IF EXISTS "League owners can insert discord channels" ON public.discord_channels;

-- Webhook host allowlist.
ALTER TABLE public.discord_channels
  ADD CONSTRAINT discord_channels_webhook_url_host CHECK (
    webhook_url ~ '^(https://((canary|ptb)\.)?discord(app)?\.com/api(/v[0-9]+)?/webhooks/|http://(127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]+/)'
  ) NOT VALID;

DO $$
DECLARE
  v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.discord_channels
  WHERE NOT (webhook_url ~ '^(https://((canary|ptb)\.)?discord(app)?\.com/api(/v[0-9]+)?/webhooks/|http://(127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]+/)');

  IF v_bad = 0 THEN
    ALTER TABLE public.discord_channels VALIDATE CONSTRAINT discord_channels_webhook_url_host;
  ELSE
    RAISE WARNING 'discord_channels_webhook_url_host left NOT VALID: % row(s) have a non-Discord webhook_url', v_bad;
  END IF;
END;
$$;

COMMENT ON CONSTRAINT discord_channels_webhook_url_host ON public.discord_channels IS
'webhook_url must be a Discord webhook endpoint (or a local test mock server). Mirrors isAllowedWebhookUrl in supabase/functions/_shared/discord.ts; change both together.';
