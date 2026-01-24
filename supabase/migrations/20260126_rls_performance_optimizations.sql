-- ============================================================================
-- RLS Performance Optimizations
--
-- 1. Wrap auth.uid() and auth.jwt() in (select ...) subqueries to prevent
--    re-evaluation per row (Postgres treats subqueries as constants)
-- 2. Add TO authenticated role to policies (skips evaluation for anon)
-- 3. Add indexes for common RLS query patterns
--
-- See: https://supabase.com/docs/guides/database/postgres/row-level-security
-- ============================================================================

-- ============================================================================
-- PART 1: Security Definer Functions
-- ============================================================================

CREATE OR REPLACE FUNCTION is_league_member(check_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_participants
    WHERE league_id = check_league_id
      AND user_id = (SELECT auth.uid())
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION is_league_owner(check_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM leagues
    WHERE id = check_league_id
      AND owner_id = (SELECT auth.uid())
  )
$$;

CREATE OR REPLACE FUNCTION has_pending_invitation(check_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM invitations
    WHERE league_id = check_league_id
      AND email = LOWER((SELECT auth.jwt()) ->> 'email')
      AND status = 'pending'
  )
$$;

CREATE OR REPLACE FUNCTION is_team_owner(check_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teams t
    JOIN league_participants lp ON lp.id = t.participant_id
    WHERE t.id = check_team_id
      AND lp.user_id = (SELECT auth.uid())
      AND lp.status = 'active'
  )
$$;

-- ============================================================================
-- PART 2: leagues
-- ============================================================================

DROP POLICY IF EXISTS "Users can view leagues they participate in" ON leagues;
DROP POLICY IF EXISTS "Users can create leagues" ON leagues;
DROP POLICY IF EXISTS "League owners can update their leagues" ON leagues;
DROP POLICY IF EXISTS "League owners can delete their leagues" ON leagues;

CREATE POLICY "Users can view leagues they participate in" ON leagues
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR is_league_member(id)
    OR has_pending_invitation(id)
  );

CREATE POLICY "Users can create leagues" ON leagues
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "League owners can update their leagues" ON leagues
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "League owners can delete their leagues" ON leagues
  FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- ============================================================================
-- PART 3: profiles
-- ============================================================================

DROP POLICY IF EXISTS "Users can view any profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

-- All authenticated users can view profiles (for display names, avatars)
CREATE POLICY "Users can view any profile" ON profiles
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- PART 4: league_participants
-- ============================================================================

DROP POLICY IF EXISTS "Users can view participants in their leagues" ON league_participants;
DROP POLICY IF EXISTS "League owners can insert participants" ON league_participants;
DROP POLICY IF EXISTS "League owners can update participants" ON league_participants;
DROP POLICY IF EXISTS "League owners can remove participants" ON league_participants;

CREATE POLICY "Users can view participants in their leagues" ON league_participants
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR is_league_owner(league_id)
    OR is_league_member(league_id)
  );

CREATE POLICY "League owners can insert participants" ON league_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    is_league_owner(league_id)
    OR user_id = (SELECT auth.uid())
  );

CREATE POLICY "League owners can update participants" ON league_participants
  FOR UPDATE TO authenticated
  USING (is_league_owner(league_id));

CREATE POLICY "League owners can remove participants" ON league_participants
  FOR DELETE TO authenticated
  USING (
    is_league_owner(league_id)
    OR user_id = (SELECT auth.uid())
  );

-- ============================================================================
-- PART 5: teams
-- ============================================================================

DROP POLICY IF EXISTS "Users can view teams in their leagues" ON teams;
DROP POLICY IF EXISTS "Users can create their own team" ON teams;
DROP POLICY IF EXISTS "Users can update their own team" ON teams;

CREATE POLICY "Users can view teams in their leagues" ON teams
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_participants lp
      WHERE lp.id = teams.participant_id
        AND is_league_member(lp.league_id)
    )
  );

CREATE POLICY "Users can create their own team" ON teams
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_participants
      WHERE id = participant_id
        AND user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update their own team" ON teams
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_participants
      WHERE id = participant_id
        AND user_id = (SELECT auth.uid())
    )
  );

-- ============================================================================
-- PART 6: draft_picks
-- ============================================================================

DROP POLICY IF EXISTS "Users can view draft picks in their leagues" ON draft_picks;

CREATE POLICY "Users can view draft picks in their leagues" ON draft_picks
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

-- ============================================================================
-- PART 7: team_scores
-- ============================================================================

DROP POLICY IF EXISTS "Users can view team scores in their leagues" ON team_scores;

CREATE POLICY "Users can view team scores in their leagues" ON team_scores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = team_scores.team_id
        AND is_league_member(lp.league_id)
    )
  );

-- ============================================================================
-- PART 8: invitations
-- ============================================================================

DROP POLICY IF EXISTS "Users can view relevant invitations" ON invitations;
DROP POLICY IF EXISTS "League owners can create invitations" ON invitations;
DROP POLICY IF EXISTS "League owners can update invitations" ON invitations;
DROP POLICY IF EXISTS "Invitees can respond to invitations" ON invitations;

CREATE POLICY "Users can view relevant invitations" ON invitations
  FOR SELECT TO authenticated
  USING (
    is_league_owner(league_id)
    OR email = LOWER((SELECT auth.jwt()) ->> 'email')
  );

CREATE POLICY "League owners can create invitations" ON invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    is_league_owner(league_id)
    AND invited_by = (SELECT auth.uid())
  );

CREATE POLICY "League owners can update invitations" ON invitations
  FOR UPDATE TO authenticated
  USING (is_league_owner(league_id));

CREATE POLICY "Invitees can respond to invitations" ON invitations
  FOR UPDATE TO authenticated
  USING (email = LOWER((SELECT auth.jwt()) ->> 'email'));

-- ============================================================================
-- PART 9: pickup_bids
-- ============================================================================

DROP POLICY IF EXISTS "Users can view bids in their leagues" ON pickup_bids;
DROP POLICY IF EXISTS "Users can insert bids for their team" ON pickup_bids;
DROP POLICY IF EXISTS "Users can update their own bids" ON pickup_bids;

CREATE POLICY "Users can view bids in their leagues" ON pickup_bids
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

CREATE POLICY "Users can insert bids for their team" ON pickup_bids
  FOR INSERT TO authenticated
  WITH CHECK (is_team_owner(team_id));

CREATE POLICY "Users can update their own bids" ON pickup_bids
  FOR UPDATE TO authenticated
  USING (is_team_owner(team_id));

-- ============================================================================
-- PART 10: team_budgets
-- ============================================================================

DROP POLICY IF EXISTS "Users can view budgets in their leagues" ON team_budgets;

CREATE POLICY "Users can view budgets in their leagues" ON team_budgets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = team_budgets.team_id
        AND is_league_member(lp.league_id)
    )
  );

-- ============================================================================
-- PART 11: pickups
-- ============================================================================

DROP POLICY IF EXISTS "Users can view pickups in their leagues" ON pickups;

CREATE POLICY "Users can view pickups in their leagues" ON pickups
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

-- ============================================================================
-- PART 12: team_drops
-- ============================================================================

DROP POLICY IF EXISTS "Users can view drops in their leagues" ON team_drops;

CREATE POLICY "Users can view drops in their leagues" ON team_drops
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = team_drops.team_id
        AND is_league_member(lp.league_id)
    )
  );

-- ============================================================================
-- PART 13: notifications
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;

CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- PART 14: Performance Indexes
-- ============================================================================

-- Case-insensitive email lookups (RLS uses LOWER(email))
CREATE INDEX IF NOT EXISTS idx_invitations_email_lower
  ON invitations (LOWER(email));

-- Pickup bids by league and movie
CREATE INDEX IF NOT EXISTS idx_pickup_bids_league_tmdb_status
  ON pickup_bids (league_id, tmdb_id, status);

-- Reviews by movie (scoring queries)
CREATE INDEX IF NOT EXISTS idx_reviews_movie_source
  ON reviews (movie_id, source);

-- Active participants only (most common RLS check)
CREATE INDEX IF NOT EXISTS idx_league_participants_active
  ON league_participants (league_id, user_id)
  WHERE status = 'active';

-- Active bids only
CREATE INDEX IF NOT EXISTS idx_pickup_bids_active
  ON pickup_bids (league_id, tmdb_id)
  WHERE status = 'active';
