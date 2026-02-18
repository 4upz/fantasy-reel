-- Migration: Counterpick Bids Table
-- Competitive bidding for counterpick slots during the active (bidding) phase.
-- Teams bid FAAB budget to counterpick opponent movies, similar to pickup bids.
-- Reuses the existing bid_status enum (active, outbid, won, lost, cancelled).

-- ============================================================================
-- PART 1: CREATE COUNTERPICK_BIDS TABLE
-- ============================================================================

CREATE TABLE counterpick_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    target_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    draft_pick_id UUID NOT NULL REFERENCES draft_picks(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0 AND amount <= 100),
    status bid_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    countered_at TIMESTAMPTZ,
    response_deadline TIMESTAMPTZ,
    processing_deadline TIMESTAMPTZ NOT NULL
);

-- Comments for documentation
COMMENT ON TABLE counterpick_bids IS 'Competitive bids for counterpick slots during the active/bidding phase';
COMMENT ON COLUMN counterpick_bids.team_id IS 'Team placing the counterpick bid';
COMMENT ON COLUMN counterpick_bids.target_team_id IS 'Team whose movie would be counterpicked';
COMMENT ON COLUMN counterpick_bids.draft_pick_id IS 'The draft pick being targeted for counterpick';
COMMENT ON COLUMN counterpick_bids.amount IS 'FAAB bid amount (0-100)';
COMMENT ON COLUMN counterpick_bids.status IS 'Bid lifecycle status: active, outbid, won, lost, cancelled';
COMMENT ON COLUMN counterpick_bids.countered_at IS 'Timestamp when this bid was outbid by another team';
COMMENT ON COLUMN counterpick_bids.response_deadline IS 'Deadline to counter after being outbid';
COMMENT ON COLUMN counterpick_bids.processing_deadline IS 'When this bid will be processed (next Saturday 8pm UTC)';

-- ============================================================================
-- PART 2: INDEXES
-- ============================================================================

CREATE INDEX idx_counterpick_bids_league_id ON counterpick_bids(league_id);
CREATE INDEX idx_counterpick_bids_team_id ON counterpick_bids(team_id);
CREATE INDEX idx_counterpick_bids_movie_id ON counterpick_bids(movie_id);
CREATE INDEX idx_counterpick_bids_status ON counterpick_bids(status);
CREATE INDEX idx_counterpick_bids_league_movie_status ON counterpick_bids(league_id, movie_id, status);

-- ============================================================================
-- PART 3: ENABLE RLS
-- ============================================================================

ALTER TABLE counterpick_bids ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 4: RLS POLICIES
-- Same pattern as counterpicks table RLS
-- ============================================================================

-- SELECT: League members can view all counterpick bids in their leagues
CREATE POLICY "Users can view counterpick bids in their leagues" ON counterpick_bids
    FOR SELECT TO authenticated
    USING (is_league_member(league_id));

-- INSERT: Players can insert counterpick bids for their own team
CREATE POLICY "Users can insert counterpick bids for their team" ON counterpick_bids
    FOR INSERT TO authenticated
    WITH CHECK (is_team_owner(team_id));

-- UPDATE: Players can update their own team's counterpick bids
CREATE POLICY "Users can update counterpick bids for their team" ON counterpick_bids
    FOR UPDATE TO authenticated
    USING (is_team_owner(team_id));

-- Service role can manage all counterpick bids (for Edge Functions)
CREATE POLICY "Service role can manage counterpick bids" ON counterpick_bids
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- PART 5: ENABLE REALTIME
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE counterpick_bids;
