-- Lock down the account-linking functions to service_role only.
--
-- 20260118_add_account_linking_support.sql said "Only grant to service_role"
-- for transfer_identity and delete_duplicate_user, but only added the GRANT —
-- it never revoked the implicit EXECUTE that Postgres gives PUBLIC on every
-- new function. Both are SECURITY DEFINER primitives whose auth checks live in
-- the merge-accounts Edge Function (their sole caller, via the service-role
-- client), so any authenticated client could invoke them directly through
-- PostgREST RPC. Revoke client access, matching the pattern used for the
-- Discord lookup functions.
REVOKE EXECUTE ON FUNCTION transfer_identity(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION transfer_identity(UUID, UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION delete_duplicate_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_duplicate_user(UUID) TO service_role;
