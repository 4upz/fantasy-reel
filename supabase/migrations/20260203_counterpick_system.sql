-- Migration: Counterpick System
-- Allows players to "bet against" opponents' movies by counterpicking them.
-- When a counterpicked movie scores poorly, the counterpicker earns those negative points as positive.
--
-- Key concepts:
--   - Counterpick slots: Configurable per league for draft and bidding phases
--   - Reverse draft order: Counterpicking happens after main draft in reverse order
--   - Counterpick blocking: Movies with counterpicks cannot be dropped (configurable)
--   - Dual scoring: Teams track both draft points and counterpick points separately

-- ============================================================================
-- PART 1: EXTEND LEAGUES TABLE
-- Add counterpick configuration columns
-- ============================================================================

ALTER TABLE leagues
ADD COLUMN IF NOT EXISTS draft_counterpick_slots INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS bidding_counterpick_slots INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS counterpicks_block_drops BOOLEAN DEFAULT TRUE;

-- Add constraints for counterpick configuration
ALTER TABLE leagues
ADD CONSTRAINT check_draft_counterpick_slots_positive CHECK (draft_counterpick_slots >= 0),
ADD CONSTRAINT check_bidding_counterpick_slots_positive CHECK (bidding_counterpick_slots >= 0);

-- Update status constraint to include 'counterpicking' phase
-- First drop the existing constraint, then create new one
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_status_check;
ALTER TABLE leagues ADD CONSTRAINT leagues_status_check
    CHECK (status IN ('setup', 'drafting', 'counterpicking', 'active', 'completed'));

-- Comments for documentation
COMMENT ON COLUMN leagues.draft_counterpick_slots IS 'Number of counterpicks each team can make during post-draft counterpick round';
COMMENT ON COLUMN leagues.bidding_counterpick_slots IS 'Number of counterpicks each team can make during bidding phase';
COMMENT ON COLUMN leagues.counterpicks_block_drops IS 'If true, movies with counterpicks cannot be dropped';

-- ============================================================================
-- PART 2: EXTEND DRAFT_PICKS TABLE
-- Track which movies have been counterpicked and by whom
-- ============================================================================

ALTER TABLE draft_picks
ADD COLUMN IF NOT EXISTS counterpicked_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- Create partial index for efficient counterpick queries
CREATE INDEX IF NOT EXISTS idx_draft_picks_counterpicked
    ON draft_picks(counterpicked_by_team_id)
    WHERE counterpicked_by_team_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN draft_picks.counterpicked_by_team_id IS 'Team that placed a counterpick on this draft pick (NULL if not counterpicked)';

-- ============================================================================
-- PART 3: CREATE COUNTERPICKS TABLE
-- Central table for tracking all counterpicks with their scoring
-- ============================================================================

CREATE TABLE IF NOT EXISTS counterpicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    counterpicker_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    target_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    draft_pick_id UUID NOT NULL REFERENCES draft_picks(id) ON DELETE CASCADE,
    pick_order INTEGER NOT NULL,
    phase VARCHAR(20) NOT NULL CHECK (phase IN ('draft', 'bidding')),
    fantasy_points DECIMAL(6, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Each movie can only be counterpicked once per league
    CONSTRAINT counterpicks_league_movie_unique UNIQUE (league_id, movie_id),

    -- A team cannot counterpick their own movies
    CONSTRAINT counterpicks_not_own_movie CHECK (counterpicker_team_id != target_team_id)
);

-- Create trigger for updated_at
CREATE TRIGGER update_counterpicks_updated_at
    BEFORE UPDATE ON counterpicks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for common queries
CREATE INDEX idx_counterpicks_league_id ON counterpicks(league_id);
CREATE INDEX idx_counterpicks_counterpicker_team_id ON counterpicks(counterpicker_team_id);
CREATE INDEX idx_counterpicks_target_team_id ON counterpicks(target_team_id);
CREATE INDEX idx_counterpicks_movie_id ON counterpicks(movie_id);
CREATE INDEX idx_counterpicks_draft_pick_id ON counterpicks(draft_pick_id);
CREATE INDEX idx_counterpicks_phase ON counterpicks(phase);

-- Enable RLS
ALTER TABLE counterpicks ENABLE ROW LEVEL SECURITY;

-- Comments for documentation
COMMENT ON TABLE counterpicks IS 'Tracks counterpicks where teams bet against opponent movies';
COMMENT ON COLUMN counterpicks.counterpicker_team_id IS 'Team making the counterpick (betting against)';
COMMENT ON COLUMN counterpicks.target_team_id IS 'Team whose movie is being counterpicked';
COMMENT ON COLUMN counterpicks.pick_order IS 'Order in which counterpick was made during the round';
COMMENT ON COLUMN counterpicks.phase IS 'Phase when counterpick was made: draft or bidding';
COMMENT ON COLUMN counterpicks.fantasy_points IS 'Inverted fantasy points earned from this counterpick';

-- ============================================================================
-- PART 4: EXTEND TEAM_SCORES TABLE
-- Track draft points and counterpick points separately
-- ============================================================================

ALTER TABLE team_scores
ADD COLUMN IF NOT EXISTS draft_points DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS counterpick_points DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS counterpicks_made INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS counterpicks_scored INTEGER DEFAULT 0;

-- Comments for documentation
COMMENT ON COLUMN team_scores.draft_points IS 'Fantasy points earned from drafted movies only';
COMMENT ON COLUMN team_scores.counterpick_points IS 'Fantasy points earned from counterpicks (inverted opponent scores)';
COMMENT ON COLUMN team_scores.counterpicks_made IS 'Total number of counterpicks placed by this team';
COMMENT ON COLUMN team_scores.counterpicks_scored IS 'Number of counterpicked movies that have received scores';

-- ============================================================================
-- PART 5: RLS POLICIES FOR COUNTERPICKS
-- Use (SELECT auth.uid()) pattern for performance
-- ============================================================================

-- SELECT: League members can view all counterpicks in their leagues
CREATE POLICY "Users can view counterpicks in their leagues" ON counterpicks
    FOR SELECT TO authenticated
    USING (is_league_member(league_id));

-- INSERT: Players can insert counterpicks for their own team
CREATE POLICY "Users can insert counterpicks for their team" ON counterpicks
    FOR INSERT TO authenticated
    WITH CHECK (is_team_owner(counterpicker_team_id));

-- Service role can manage all counterpicks (for Edge Functions)
CREATE POLICY "Service role can manage counterpicks" ON counterpicks
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- PART 6: ENABLE REALTIME
-- Add counterpicks to supabase_realtime publication
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE counterpicks;

-- ============================================================================
-- PART 7: HELPER FUNCTIONS (SECURITY DEFINER)
-- ============================================================================

-- Function: Get next team in counterpick turn (reverse draft order)
-- Returns the team that should make the next counterpick
CREATE OR REPLACE FUNCTION get_next_counterpick_turn(p_league_id UUID)
RETURNS TABLE(
    round INTEGER,
    pick_number INTEGER,
    team_id UUID,
    participant_id UUID,
    user_id UUID,
    counterpicks_remaining INTEGER
) AS $$
DECLARE
    v_total_participants INTEGER;
    v_counterpick_slots INTEGER;
    v_counterpicks_made INTEGER;
    v_current_round INTEGER;
    v_pick_in_round INTEGER;
    v_reverse_draft_order INTEGER;
BEGIN
    -- Get league configuration
    SELECT COUNT(*) INTO v_total_participants
    FROM league_participants lp
    WHERE lp.league_id = p_league_id AND lp.status = 'active';

    SELECT l.draft_counterpick_slots INTO v_counterpick_slots
    FROM leagues l
    WHERE l.id = p_league_id;

    -- If no counterpick slots configured, return empty
    IF v_counterpick_slots = 0 THEN
        RETURN;
    END IF;

    -- Count counterpicks made in draft phase
    SELECT COUNT(*) INTO v_counterpicks_made
    FROM counterpicks c
    WHERE c.league_id = p_league_id AND c.phase = 'draft';

    -- Check if all counterpicks are complete
    IF v_counterpicks_made >= (v_total_participants * v_counterpick_slots) THEN
        RETURN;
    END IF;

    -- Calculate current position (1-indexed)
    v_current_round := (v_counterpicks_made / v_total_participants) + 1;
    v_pick_in_round := (v_counterpicks_made % v_total_participants) + 1;

    -- Reverse draft order: person who picked last in draft picks first in counterpick
    -- In snake draft, the last drafter had the highest draft_order
    -- So counterpick order is: highest draft_order first
    -- For round 1: order = total - pick_in_round + 1 (reverse)
    -- For round 2: order = pick_in_round (forward, snaking back)
    IF v_current_round % 2 = 1 THEN
        -- Odd rounds: reverse order (high to low)
        v_reverse_draft_order := v_total_participants - v_pick_in_round + 1;
    ELSE
        -- Even rounds: forward order (low to high, snake back)
        v_reverse_draft_order := v_pick_in_round;
    END IF;

    -- Return the team that should pick next
    RETURN QUERY
    SELECT
        v_current_round,
        v_pick_in_round,
        t.id,
        lp.id,
        lp.user_id,
        v_counterpick_slots - (
            SELECT COUNT(*)::INTEGER
            FROM counterpicks c
            WHERE c.counterpicker_team_id = t.id AND c.phase = 'draft'
        )
    FROM league_participants lp
    JOIN teams t ON t.participant_id = lp.id
    WHERE lp.league_id = p_league_id
      AND lp.status = 'active'
      AND lp.draft_order = v_reverse_draft_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_next_counterpick_turn(UUID) IS
'Returns the team that should make the next counterpick. Uses reverse snake draft order.';

-- Function: Get available movies for counterpicking
-- Returns opponent movies that can be counterpicked by the given team
CREATE OR REPLACE FUNCTION get_counterpick_options(p_league_id UUID, p_team_id UUID)
RETURNS TABLE(
    draft_pick_id UUID,
    movie_id UUID,
    movie_title VARCHAR(500),
    poster_url TEXT,
    release_date DATE,
    owner_team_id UUID,
    owner_team_name VARCHAR(100),
    fantasy_points DECIMAL(6, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dp.id AS draft_pick_id,
        dp.movie_id,
        m.title AS movie_title,
        m.poster_url,
        m.release_date,
        dp.team_id AS owner_team_id,
        t.name AS owner_team_name,
        m.fantasy_points
    FROM draft_picks dp
    JOIN movies m ON dp.movie_id = m.id
    JOIN teams t ON dp.team_id = t.id
    WHERE dp.league_id = p_league_id
      -- Not dropped
      AND dp.dropped_at IS NULL
      -- Not the requesting team's own movies
      AND dp.team_id != p_team_id
      -- Not already counterpicked in this league
      AND NOT EXISTS (
          SELECT 1 FROM counterpicks c
          WHERE c.league_id = p_league_id AND c.movie_id = dp.movie_id
      )
    ORDER BY m.release_date ASC NULLS LAST, m.title ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_counterpick_options(UUID, UUID) IS
'Returns opponent movies available for counterpicking by the given team.';

-- ============================================================================
-- PART 8: UPDATE SCORING FUNCTIONS
-- Add counterpick scoring to team calculations
-- ============================================================================

-- Function: Recalculate team score with counterpicks
-- Calculates draft_points, counterpick_points, and total_points separately
CREATE OR REPLACE FUNCTION recalculate_team_score_with_counterpicks(p_team_id UUID)
RETURNS void AS $$
DECLARE
    v_draft_points DECIMAL := 0;
    v_draft_scored INTEGER := 0;
    v_draft_pending INTEGER := 0;
    v_counterpick_points DECIMAL := 0;
    v_counterpicks_made INTEGER := 0;
    v_counterpicks_scored INTEGER := 0;
BEGIN
    -- Calculate draft points (movies owned by this team)
    SELECT
        COALESCE(SUM(m.fantasy_points), 0),
        COUNT(m.fantasy_points)::INTEGER,
        COUNT(*) FILTER (WHERE m.fantasy_points IS NULL)::INTEGER
    INTO v_draft_points, v_draft_scored, v_draft_pending
    FROM draft_picks dp
    JOIN movies m ON dp.movie_id = m.id
    WHERE dp.team_id = p_team_id;

    -- Calculate counterpick points (inverted scores from counterpicked movies)
    -- Positive fantasy_points on opponent's movie = negative for counterpicker
    -- Negative fantasy_points on opponent's movie = positive for counterpicker
    SELECT
        COUNT(*)::INTEGER,
        COUNT(m.fantasy_points)::INTEGER,
        COALESCE(SUM(
            CASE WHEN m.fantasy_points IS NOT NULL
            THEN -m.fantasy_points  -- Invert the score
            ELSE 0 END
        ), 0)
    INTO v_counterpicks_made, v_counterpicks_scored, v_counterpick_points
    FROM counterpicks c
    JOIN movies m ON c.movie_id = m.id
    WHERE c.counterpicker_team_id = p_team_id;

    -- Update team_scores with all calculated values
    INSERT INTO team_scores (
        team_id,
        total_points,
        draft_points,
        counterpick_points,
        movies_scored,
        movies_pending,
        average_score,
        counterpicks_made,
        counterpicks_scored,
        last_calculated_at
    )
    VALUES (
        p_team_id,
        v_draft_points + v_counterpick_points,  -- Total = draft + counterpick
        v_draft_points,
        v_counterpick_points,
        v_draft_scored,
        v_draft_pending,
        CASE WHEN v_draft_scored > 0
            THEN ROUND(v_draft_points / v_draft_scored, 2)
            ELSE 0 END,
        v_counterpicks_made,
        v_counterpicks_scored,
        NOW()
    )
    ON CONFLICT (team_id) DO UPDATE SET
        total_points = EXCLUDED.total_points,
        draft_points = EXCLUDED.draft_points,
        counterpick_points = EXCLUDED.counterpick_points,
        movies_scored = EXCLUDED.movies_scored,
        movies_pending = EXCLUDED.movies_pending,
        average_score = EXCLUDED.average_score,
        counterpicks_made = EXCLUDED.counterpicks_made,
        counterpicks_scored = EXCLUDED.counterpicks_scored,
        last_calculated_at = EXCLUDED.last_calculated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION recalculate_team_score_with_counterpicks(UUID) IS
'Recalculates team scores including both draft points and counterpick points (inverted opponent scores).';

-- Update recalculate_teams_for_movie to also recalculate counterpickers
CREATE OR REPLACE FUNCTION recalculate_teams_for_movie(p_movie_id UUID)
RETURNS void AS $$
DECLARE
    v_team RECORD;
BEGIN
    -- Find all teams that drafted this movie and recalculate their scores
    FOR v_team IN
        SELECT DISTINCT dp.team_id
        FROM draft_picks dp
        WHERE dp.movie_id = p_movie_id
    LOOP
        PERFORM recalculate_team_score_with_counterpicks(v_team.team_id);
    END LOOP;

    -- Also recalculate scores for teams that counterpicked this movie
    FOR v_team IN
        SELECT DISTINCT c.counterpicker_team_id AS team_id
        FROM counterpicks c
        WHERE c.movie_id = p_movie_id
    LOOP
        PERFORM recalculate_team_score_with_counterpicks(v_team.team_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update calculate_team_score to use the new function
CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE(
    total_points DECIMAL,
    movies_scored INTEGER,
    movies_pending INTEGER,
    average_score DECIMAL
) AS $$
DECLARE
    v_draft_points DECIMAL := 0;
    v_draft_scored INTEGER := 0;
    v_draft_pending INTEGER := 0;
    v_counterpick_points DECIMAL := 0;
BEGIN
    -- Calculate draft points
    SELECT
        COALESCE(SUM(m.fantasy_points), 0::DECIMAL),
        COUNT(m.fantasy_points)::INTEGER,
        COUNT(*) FILTER (WHERE m.fantasy_points IS NULL)::INTEGER
    INTO v_draft_points, v_draft_scored, v_draft_pending
    FROM draft_picks dp
    JOIN movies m ON dp.movie_id = m.id
    WHERE dp.team_id = p_team_id;

    -- Calculate counterpick points (inverted)
    SELECT COALESCE(SUM(-m.fantasy_points), 0::DECIMAL)
    INTO v_counterpick_points
    FROM counterpicks c
    JOIN movies m ON c.movie_id = m.id
    WHERE c.counterpicker_team_id = p_team_id
      AND m.fantasy_points IS NOT NULL;

    RETURN QUERY SELECT
        v_draft_points + v_counterpick_points AS total_points,
        v_draft_scored AS movies_scored,
        v_draft_pending AS movies_pending,
        CASE WHEN v_draft_scored > 0
            THEN ROUND(v_draft_points / v_draft_scored, 2)
            ELSE 0::DECIMAL END AS average_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PART 9: UPDATE COUNTERPICK FANTASY POINTS ON MOVIE SCORE
-- When a movie's fantasy_points changes, update the counterpick record
-- ============================================================================

CREATE OR REPLACE FUNCTION update_counterpick_points()
RETURNS TRIGGER AS $$
BEGIN
    -- When movie fantasy_points changes, update related counterpick
    IF NEW.fantasy_points IS DISTINCT FROM OLD.fantasy_points THEN
        UPDATE counterpicks
        SET fantasy_points = -NEW.fantasy_points,  -- Inverted score
            updated_at = NOW()
        WHERE movie_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on movies table
DROP TRIGGER IF EXISTS trigger_update_counterpick_points ON movies;
CREATE TRIGGER trigger_update_counterpick_points
    AFTER UPDATE OF fantasy_points ON movies
    FOR EACH ROW
    EXECUTE FUNCTION update_counterpick_points();

COMMENT ON FUNCTION update_counterpick_points() IS
'Trigger function that updates counterpick.fantasy_points when the movie score changes.';

-- ============================================================================
-- PART 10: PERFORMANCE INDEXES
-- ============================================================================

-- Index for checking if a movie is counterpicked in a league
CREATE INDEX IF NOT EXISTS idx_counterpicks_league_movie
    ON counterpicks(league_id, movie_id);

-- Index for team counterpick counts by phase
CREATE INDEX IF NOT EXISTS idx_counterpicks_team_phase
    ON counterpicks(counterpicker_team_id, phase);

-- Index for scoring queries
CREATE INDEX IF NOT EXISTS idx_counterpicks_scoring
    ON counterpicks(counterpicker_team_id, movie_id)
    INCLUDE (fantasy_points);
