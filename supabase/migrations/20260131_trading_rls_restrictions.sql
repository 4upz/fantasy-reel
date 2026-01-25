-- ============================================================================
-- Trading RLS Restrictions
--
-- Tightens RLS policies on trade_offers table:
-- - Only trade participants (initiator/recipient) can view trade details
-- - League owners can also view trades for moderation purposes
-- - Uses (SELECT auth.uid()) pattern for performance
-- - Adds TO authenticated role targeting
--
-- Security issue: Previous policy allowed any league member to see all trades,
-- exposing trade offers between other teams (what movies/FAAB they're trading).
-- ============================================================================

-- ============================================================================
-- PART 1: Create helper function for trade participant check
-- ============================================================================

-- Check if the current user is a participant in a trade (initiator or recipient)
-- Uses SECURITY DEFINER to break RLS recursion
CREATE OR REPLACE FUNCTION is_trade_participant_by_id(check_trade_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trade_offers t
    WHERE t.id = check_trade_id
      AND (is_team_owner(t.initiator_team_id) OR is_team_owner(t.recipient_team_id))
  )
$$;

-- ============================================================================
-- PART 2: Drop existing overly permissive policy
-- ============================================================================

DROP POLICY IF EXISTS "Users can view trades in their leagues" ON trade_offers;

-- ============================================================================
-- PART 3: Create restrictive SELECT policy
-- ============================================================================

-- Only trade participants and league owners can view trade details
-- This prevents teams from seeing what other teams are trading
CREATE POLICY "Trade participants can view their trades" ON trade_offers
  FOR SELECT TO authenticated
  USING (
    -- User is the initiator team owner
    is_team_owner(initiator_team_id)
    -- User is the recipient team owner
    OR is_team_owner(recipient_team_id)
    -- League owner can view for moderation/veto purposes
    OR is_league_owner(league_id)
  );

-- ============================================================================
-- PART 4: Add index to support RLS query performance
-- ============================================================================

-- Index for looking up trades by team (supports is_team_owner checks)
CREATE INDEX IF NOT EXISTS idx_trade_offers_initiator_team
  ON trade_offers (initiator_team_id);

CREATE INDEX IF NOT EXISTS idx_trade_offers_recipient_team
  ON trade_offers (recipient_team_id);

-- Composite index for pending trades (common query pattern)
CREATE INDEX IF NOT EXISTS idx_trade_offers_teams_status
  ON trade_offers (initiator_team_id, recipient_team_id, status)
  WHERE status IN ('proposed', 'countered', 'review');

-- ============================================================================
-- PART 5: Update trade_assets policy to match
-- ============================================================================

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view trade assets in their leagues" ON trade_assets;

-- Only trade participants and league owners can view trade asset records
CREATE POLICY "Trade participants can view their trade assets" ON trade_assets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM trade_offers t
      WHERE t.id = trade_assets.trade_offer_id
        AND (
          is_team_owner(t.initiator_team_id)
          OR is_team_owner(t.recipient_team_id)
          OR is_league_owner(t.league_id)
        )
    )
  );

-- ============================================================================
-- PART 6: Comments
-- ============================================================================

COMMENT ON POLICY "Trade participants can view their trades" ON trade_offers IS
  'Restricts trade visibility to initiator, recipient, and league owner only';

COMMENT ON POLICY "Trade participants can view their trade assets" ON trade_assets IS
  'Restricts trade asset visibility to initiator, recipient, and league owner only';
