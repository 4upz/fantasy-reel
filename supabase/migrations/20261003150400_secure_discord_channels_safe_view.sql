-- ============================================================================
-- Close anonymous write access through discord_channels_safe
--
-- The view was created without security_invoker, so it ran as its owner
-- (postgres) and skipped the RLS policies on discord_channels. The blanket
-- grant in 20260805190000_restore_data_api_default_grants then gave anon and
-- authenticated SELECT/INSERT/UPDATE/DELETE on it, and because it is a simple
-- auto-updatable view, anyone holding the anon key could read, disable or
-- delete every league's Discord channel rows.
--
-- No client reads or writes this view today: the Discord bot and the Edge
-- Functions use the service role against discord_channels directly, and the
-- web app has no Discord settings screen. So:
--   * security_invoker makes any remaining read go through the
--     discord_channels SELECT policy (league members only);
--   * anon loses all access, and authenticated keeps SELECT only;
--   * service_role keeps full access, so nothing it does changes.
-- ============================================================================

ALTER VIEW discord_channels_safe SET (security_invoker = true);

REVOKE ALL ON discord_channels_safe FROM PUBLIC, anon, authenticated;
GRANT SELECT ON discord_channels_safe TO authenticated;
GRANT ALL ON discord_channels_safe TO service_role;
