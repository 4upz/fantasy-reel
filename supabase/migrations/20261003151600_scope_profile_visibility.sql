-- Profiles were readable by anyone holding the public anon key
-- ("Users can view any profile" was USING (true) for every role), which made
-- the whole user base -- display names that are usually a Google full name,
-- plus photos -- a public directory.
--
-- A signed-in user now sees:
--   * their own profile;
--   * everyone in a league whose participant list they can already read
--     (an active member or the owner -- the same rule as the
--     league_participants SELECT policy, so every league_participants ->
--     profiles embed keeps resolving, including rows for people who left);
--   * whoever invited them to a league they have a pending invitation for.
--
-- Signed-out visitors see nothing. No signed-out page reads profiles, and
-- Edge Functions, the Discord bot and the SECURITY DEFINER functions that
-- join profiles (start_next_season, complete_league_season,
-- get_league_invitations, ...) are unaffected.

-- Returns the set once per query rather than running a membership check per
-- profile row. SECURITY DEFINER so it can read league_participants and
-- invitations without recursing through their own policies.
CREATE OR REPLACE FUNCTION public.visible_profile_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lp.user_id
  FROM league_participants lp
  WHERE lp.league_id IN (
    SELECT me.league_id
    FROM league_participants me
    WHERE me.user_id = (SELECT auth.uid())
      AND me.status = 'active'
    UNION
    SELECT l.id
    FROM leagues l
    WHERE l.owner_id = (SELECT auth.uid())
  )
  UNION
  SELECT i.invited_by
  FROM invitations i
  WHERE i.email = LOWER((SELECT auth.jwt()) ->> 'email')
    AND i.status = 'pending'
$$;

REVOKE EXECUTE ON FUNCTION public.visible_profile_user_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visible_profile_user_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view any profile" ON profiles;

CREATE POLICY "Users can view profiles they share a league with" ON profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR user_id IN (SELECT public.visible_profile_user_ids())
  );

-- anon has no profile policy left; drop its grants too so a signed-out
-- request is refused outright instead of quietly returning nothing.
REVOKE ALL ON TABLE profiles FROM anon;
