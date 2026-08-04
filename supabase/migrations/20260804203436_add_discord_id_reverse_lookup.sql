-- ============================================================================
-- Reverse Discord ID Lookup
--
-- get_user_by_discord_id() (see 20260216221400_create_discord_channels.sql)
-- resolves a Discord snowflake to a Supabase user_id. Trade @mentions need
-- the opposite direction: given the user_ids of the two trade parties, find
-- whichever of them have a linked Discord account, batched in one call to
-- avoid an admin-API round trip per party.
--
-- NOTE: profiles has no discord_id column -- the link lives only in
-- auth.identities (populated by Discord OAuth), which PostgREST does not
-- expose. A SECURITY DEFINER function is the only way to read it from an
-- Edge Function's service-role client, mirroring get_user_by_discord_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_discord_ids_by_user_ids(p_user_ids UUID[])
RETURNS TABLE(user_id UUID, discord_id TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT user_id, provider_id AS discord_id
  FROM auth.identities
  WHERE provider = 'discord' AND user_id = ANY(p_user_ids);
$$;

COMMENT ON FUNCTION get_discord_ids_by_user_ids IS 'Resolve Supabase user_ids to linked Discord IDs via auth.identities. Reverse of get_user_by_discord_id.';

-- Restrict to service_role only, matching get_user_by_discord_id.
REVOKE EXECUTE ON FUNCTION get_discord_ids_by_user_ids(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_discord_ids_by_user_ids(UUID[]) TO service_role;
