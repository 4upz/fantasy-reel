-- Restore Data API privileges for the PostgREST roles.
--
-- Supabase CLI >= 2026-05-30 (supabase/cli#5524) and, per
-- github.com/orgs/supabase/discussions/45329, the cloud platform from
-- 2026-10-30, no longer auto-grant Data API access on public-schema entities:
-- fresh stacks revoke SELECT/INSERT/UPDATE/DELETE on tables, USAGE/SELECT on
-- sequences, and EXECUTE on functions from anon, authenticated, and
-- service_role. This app was built against the legacy defaults (RLS is the
-- access-control layer), so restore them explicitly instead of relying on the
-- deprecated [api].auto_expose_new_tables config flag.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  TO anon, authenticated, service_role;

-- Cover entities created by future migrations (which run as postgres).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- The blanket EXECUTE grant above would undo the deliberate hardening of the
-- Discord lookup functions (SECURITY DEFINER readers of auth.identities that
-- must stay service_role-only). Re-assert their restrictions.
REVOKE EXECUTE ON FUNCTION get_user_by_discord_id(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_user_by_discord_id(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION get_discord_ids_by_user_ids(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_discord_ids_by_user_ids(UUID[]) TO service_role;
