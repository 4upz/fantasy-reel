-- ============================================================================
-- Fix discord_channels RLS policies and add optimizations
-- ============================================================================

-- Fix INSERT policy: should require ownership, not just membership
DROP POLICY "League owners can insert discord channels" ON discord_channels;
CREATE POLICY "League owners can insert discord channels"
  ON discord_channels FOR INSERT TO authenticated
  WITH CHECK (is_league_owner(league_id));

-- Fix UPDATE policy: add WITH CHECK to prevent row reassignment to another league
DROP POLICY "League owners can update discord channels" ON discord_channels;
CREATE POLICY "League owners can update discord channels"
  ON discord_channels FOR UPDATE TO authenticated
  USING (is_league_owner(league_id))
  WITH CHECK (is_league_owner(league_id));

-- Add partial index for the hot path: sendDiscordNotification queries
-- enabled channels by league_id
CREATE INDEX idx_discord_channels_league_enabled
  ON discord_channels(league_id) WHERE enabled = true;

-- Restrict get_user_by_discord_id to service_role only
-- (SECURITY DEFINER function that reads auth.identities)
REVOKE EXECUTE ON FUNCTION get_user_by_discord_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_by_discord_id(TEXT) TO service_role;
