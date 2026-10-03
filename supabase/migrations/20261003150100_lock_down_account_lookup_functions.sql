-- Close client access to the account-linking lookups on auth.users.
--
-- Both are SECURITY DEFINER reads of auth.users with no caller check, and
-- 20260805190000_restore_data_api_default_grants handed EXECUTE on them to
-- anon as well as authenticated.
--
-- get_original_user_id maps an email to a user id. Nothing calls it: not the
-- frontend, an Edge Function, the Discord bot or another SQL function.
-- Revoke it from every client role; service_role keeps access.
REVOKE EXECUTE ON FUNCTION get_original_user_id(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_original_user_id(TEXT, UUID) TO service_role;

-- count_users_by_email is still called by the OAuth callback route
-- (apps/frontend/app/auth/callback/route.ts) after exchangeCodeForSession, so
-- always as authenticated. Only anon loses it.
REVOKE EXECUTE ON FUNCTION count_users_by_email(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION count_users_by_email(TEXT) TO authenticated, service_role;
