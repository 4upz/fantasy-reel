-- ============================================================================
-- Fix RLS Authenticated Constraint Issue
--
-- Problem: The `TO authenticated` constraint on SELECT policies requires
-- a valid JWT token in the request headers. However, there's a known bug
-- with @supabase/ssr and Next.js 15 where the JWT isn't properly propagated
-- from middleware to server components (see: github.com/supabase/ssr/issues/107)
--
-- Solution: Remove `TO authenticated` from SELECT policies. Security is still
-- enforced via helper functions (is_league_member, etc.) that check auth.uid().
-- When unauthenticated, auth.uid() returns NULL, so membership checks fail.
--
-- Trade-off: Slight performance impact for anonymous requests (policy evaluates
-- instead of being skipped), but the app requires authentication anyway.
--
-- INSERT/UPDATE/DELETE policies retain TO authenticated for security.
-- ============================================================================

-- ============================================================================
-- PART 1: leagues - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view leagues they participate in" ON leagues;

CREATE POLICY "Users can view leagues they participate in" ON leagues
  FOR SELECT
  USING (
    owner_id = (SELECT auth.uid())
    OR is_league_member(id)
    OR has_pending_invitation(id)
  );

-- ============================================================================
-- PART 2: profiles - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view any profile" ON profiles;

CREATE POLICY "Users can view any profile" ON profiles
  FOR SELECT
  USING (true);

-- ============================================================================
-- PART 3: league_participants - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view participants in their leagues" ON league_participants;

CREATE POLICY "Users can view participants in their leagues" ON league_participants
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR is_league_owner(league_id)
    OR is_league_member(league_id)
  );

-- ============================================================================
-- PART 4: teams - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view teams in their leagues" ON teams;

CREATE POLICY "Users can view teams in their leagues" ON teams
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_participants lp
      WHERE lp.id = teams.participant_id
        AND is_league_member(lp.league_id)
    )
  );

-- ============================================================================
-- PART 5: draft_picks - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view draft picks in their leagues" ON draft_picks;

CREATE POLICY "Users can view draft picks in their leagues" ON draft_picks
  FOR SELECT
  USING (is_league_member(league_id));

-- ============================================================================
-- PART 6: team_scores - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view team scores in their leagues" ON team_scores;

CREATE POLICY "Users can view team scores in their leagues" ON team_scores
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = team_scores.team_id
        AND is_league_member(lp.league_id)
    )
  );

-- ============================================================================
-- PART 7: invitations - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view relevant invitations" ON invitations;

CREATE POLICY "Users can view relevant invitations" ON invitations
  FOR SELECT
  USING (
    is_league_owner(league_id)
    OR email = LOWER((SELECT auth.jwt()) ->> 'email')
  );

-- ============================================================================
-- PART 8: pickup_bids - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view bids in their leagues" ON pickup_bids;

CREATE POLICY "Users can view bids in their leagues" ON pickup_bids
  FOR SELECT
  USING (is_league_member(league_id));

-- ============================================================================
-- PART 9: team_budgets - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view budgets in their leagues" ON team_budgets;

CREATE POLICY "Users can view budgets in their leagues" ON team_budgets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = team_budgets.team_id
        AND is_league_member(lp.league_id)
    )
  );

-- ============================================================================
-- PART 10: pickups - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view pickups in their leagues" ON pickups;

CREATE POLICY "Users can view pickups in their leagues" ON pickups
  FOR SELECT
  USING (is_league_member(league_id));

-- ============================================================================
-- PART 11: team_drops - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view drops in their leagues" ON team_drops;

CREATE POLICY "Users can view drops in their leagues" ON team_drops
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = team_drops.team_id
        AND is_league_member(lp.league_id)
    )
  );

-- ============================================================================
-- PART 12: notifications - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;

CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- PART 13: counterpicks - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Users can view counterpicks in their leagues" ON counterpicks;

CREATE POLICY "Users can view counterpicks in their leagues" ON counterpicks
  FOR SELECT
  USING (is_league_member(league_id));

-- ============================================================================
-- PART 14: trade_offers - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Trade participants can view their trades" ON trade_offers;

CREATE POLICY "Trade participants can view their trades" ON trade_offers
  FOR SELECT
  USING (is_league_member(league_id));

-- ============================================================================
-- PART 15: trade_assets - Remove TO authenticated from SELECT
-- ============================================================================

DROP POLICY IF EXISTS "Trade participants can view their trade assets" ON trade_assets;

CREATE POLICY "Trade participants can view their trade assets" ON trade_assets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trade_offers t
      WHERE t.id = trade_assets.trade_offer_id
        AND is_league_member(t.league_id)
    )
  );

-- ============================================================================
-- Note: INSERT/UPDATE/DELETE policies retain TO authenticated for security
-- as those operations require explicit auth and are triggered by user actions
-- after auth has fully propagated.
-- ============================================================================
