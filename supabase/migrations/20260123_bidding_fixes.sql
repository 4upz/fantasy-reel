-- Follow-up fixes from code review

-- ============================================================================
-- Add missing drop_limit constraint
-- ============================================================================
ALTER TABLE leagues
ADD CONSTRAINT check_drop_limit_non_negative CHECK (drop_limit >= 0);

-- ============================================================================
-- Add missing updated_at trigger for team_budgets
-- ============================================================================
CREATE TRIGGER update_team_budgets_updated_at
    BEFORE UPDATE ON team_budgets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Add missing composite index for bid processing queries
-- ============================================================================
CREATE INDEX idx_pickup_bids_league_tmdb ON pickup_bids(league_id, tmdb_id);

-- ============================================================================
-- Add index for notification ordering
-- ============================================================================
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
