-- Close three unauthenticated read paths that the Data API exposes.
--
-- Context: 20260805190000_restore_data_api_default_grants.sql re-granted the
-- legacy PostgREST privileges wholesale --
--
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, ...
--   ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, ...
--
-- -- and then re-asserted the deliberate restrictions on only the two Discord
-- lookups; 20260805200000 later did the same for transfer_identity and
-- delete_duplicate_user. The two account-linking *readers* below were missed,
-- so both are currently callable by `anon` over PostgREST RPC.
--
-- Note the ALTER DEFAULT PRIVILEGES line: every function a future migration
-- creates is EXECUTE-able by anon unless that migration revokes it. A new
-- SECURITY DEFINER function is public by default in this schema.

-- ============================================================================
-- PART 1: count_users_by_email / get_original_user_id -> service_role only
-- ============================================================================
-- Both are SECURITY DEFINER readers of auth.users that take an arbitrary email
-- and answer questions about it: "does an account exist for this address?" and
-- "what is that account's user id?". Reachable by anon, they are an email
-- enumeration oracle against the whole user base.
--
-- Neither is deleted: both remain available to the service role for the
-- merge-accounts flow and for admin/SQL-editor use. What changes is that a
-- client bearing the public anon key -- or any signed-in user -- can no longer
-- reach them.

REVOKE EXECUTE ON FUNCTION count_users_by_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION count_users_by_email(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION get_original_user_id(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_original_user_id(TEXT, UUID) TO service_role;

-- ============================================================================
-- PART 2: a self-scoped replacement for the one legitimate client call
-- ============================================================================
-- app/auth/callback/route.ts called count_users_by_email with the *caller's
-- own* email, to detect an OAuth signup that duplicates an existing
-- password account. That is the only client use, and it needs no parameter:
-- deriving the email from auth.uid() inside the function makes the answer
-- self-scoped by construction. There is no argument to point at somebody
-- else, so no gate to get wrong -- strictly better than granting a
-- parameterized oracle to `authenticated`.
--
-- For an anonymous caller auth.uid() is NULL, the inner SELECT yields NULL,
-- and `email = NULL` matches no rows, so this returns 0 rather than leaking a
-- count. The REVOKE below is belt-and-braces on top of that.

CREATE OR REPLACE FUNCTION count_duplicate_accounts_for_current_user()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM auth.users
  WHERE email = (
    SELECT email FROM auth.users WHERE id = (SELECT auth.uid())
  );
$$;

COMMENT ON FUNCTION count_duplicate_accounts_for_current_user IS
  'How many auth.users rows share the calling user''s email (1 = just them). '
  'Self-scoped: takes no argument, so it cannot be used to probe other addresses.';

REVOKE EXECUTE ON FUNCTION count_duplicate_accounts_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION count_duplicate_accounts_for_current_user() TO authenticated, service_role;

-- ============================================================================
-- PART 3: profiles SELECT -- authenticated callers only
-- ============================================================================
-- 20260204_fix_rls_authenticated_constraint.sql recreated this policy as
-- `USING (true)` with no role clause. For the other tables in that migration
-- that was safe: their predicates all reduce to an auth.uid() membership check,
-- which fails closed for an anonymous caller. profiles has no such predicate,
-- so `USING (true)` leaves the whole user directory (display_name, avatar_url,
-- user_id, created_at) readable with nothing but the public anon key.
--
-- The fix is a predicate, not `TO authenticated`. That migration dropped the
-- role clause on purpose, over a @supabase/ssr + Next 15 JWT propagation bug,
-- and re-adding it here would relitigate that. Requiring a non-NULL auth.uid()
-- gets the same result through the same mechanism the neighbouring policies
-- already rely on -- if auth.uid() were not reaching Postgres, is_league_member
-- would have been failing all along.
--
-- Deliberately still "any authenticated user may read any profile", not
-- "league co-members only": send-invite's user search matches display_name
-- across leagues by design.

DROP POLICY IF EXISTS "Users can view any profile" ON profiles;

CREATE POLICY "Users can view any profile" ON profiles
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);
