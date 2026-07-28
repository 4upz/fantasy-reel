-- ============================================================================
-- FIX: Team score recalculation ignores pickups and counts dropped movies
-- GitHub issue #17
-- ============================================================================
--
-- A team's roster is drafted movies PLUS movies won at auction (pickups), minus
-- anything it has dropped. The scoring functions only ever read `draft_picks`
-- with no `dropped_at` filter, so auction wins were worth zero and dropped
-- movies scored forever.
--
-- This is a regression. `20260122_bidding_helper_functions.sql` added the
-- pickups leg and `20260127_enable_draft_pick_drops.sql` added the dropped_at
-- filter; `20260202_hybrid_scoring_system.sql` rewrote the function for
-- fantasy_points and dropped both, and `20260203_counterpick_system.sql`
-- inherited the loss.
--
-- Double-counting is not a concern: both legs filter `dropped_at IS NULL`, and
-- `idx_pickups_league_movie_active` is UNIQUE on (league_id, movie_id) WHERE
-- dropped_at IS NULL, so a movie has at most one active holder per league.
-- ============================================================================

-- ============================================================================
-- PART 1: TRACK PICKUP POINTS SEPARATELY
-- draft_points is surfaced in the UI labelled "Draft", so pickup points get
-- their own column rather than being silently folded into it.
-- ============================================================================

ALTER TABLE team_scores
ADD COLUMN IF NOT EXISTS pickup_points DECIMAL(10, 2) DEFAULT 0;

COMMENT ON COLUMN team_scores.pickup_points IS
'Fantasy points earned from movies acquired via auction pickup (active, non-dropped only)';

COMMENT ON COLUMN team_scores.draft_points IS
'Fantasy points earned from drafted movies only (active, non-dropped only)';

COMMENT ON COLUMN team_scores.movies_scored IS
'Number of scored movies across the active roster (draft picks + pickups)';

COMMENT ON COLUMN team_scores.movies_pending IS
'Number of unscored movies across the active roster (draft picks + pickups)';

COMMENT ON COLUMN team_scores.average_score IS
'Mean fantasy points across scored roster movies (draft picks + pickups); excludes counterpicks';

-- ============================================================================
-- PART 2: SINGLE SOURCE OF TRUTH FOR "WHAT DOES THIS TEAM CURRENTLY HOLD"
-- Two scoring functions previously each inlined their own roster query, and
-- they drifted apart. Both now read from here so they cannot diverge again.
--
-- SECURITY INVOKER (the default) is deliberate: called from inside the
-- SECURITY DEFINER functions below it runs as the definer and sees everything,
-- but a direct call from a user is still constrained by RLS.
-- ============================================================================

CREATE OR REPLACE FUNCTION team_active_roster(p_team_id UUID)
RETURNS TABLE(movie_id UUID, source TEXT) AS $$
    SELECT dp.movie_id, 'draft'::TEXT
    FROM draft_picks dp
    WHERE dp.team_id = p_team_id
      AND dp.dropped_at IS NULL
    UNION ALL
    SELECT pk.movie_id, 'pickup'::TEXT
    FROM pickups pk
    WHERE pk.team_id = p_team_id
      AND pk.dropped_at IS NULL;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION team_active_roster(UUID) IS
'Movies a team currently holds, by acquisition source. Excludes dropped draft picks and dropped pickups.';

-- ============================================================================
-- PART 3: RECALCULATE A SINGLE TEAM'S SCORE
-- total = draft points + pickup points + counterpick points
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_team_score_with_counterpicks(p_team_id UUID)
RETURNS void AS $$
DECLARE
    v_draft_points DECIMAL := 0;
    v_pickup_points DECIMAL := 0;
    v_roster_points DECIMAL := 0;
    v_roster_scored INTEGER := 0;
    v_roster_pending INTEGER := 0;
    v_counterpick_points DECIMAL := 0;
    v_counterpicks_made INTEGER := 0;
    v_counterpicks_scored INTEGER := 0;
BEGIN
    -- Roster points, split by acquisition source.
    -- Dropped rows are excluded from both legs: a team stops scoring a movie
    -- the moment it drops it.
    SELECT
        COALESCE(SUM(m.fantasy_points) FILTER (WHERE r.source = 'draft'), 0),
        COALESCE(SUM(m.fantasy_points) FILTER (WHERE r.source = 'pickup'), 0),
        COALESCE(SUM(m.fantasy_points), 0),
        COUNT(m.fantasy_points)::INTEGER,
        COUNT(*) FILTER (WHERE m.fantasy_points IS NULL)::INTEGER
    INTO
        v_draft_points,
        v_pickup_points,
        v_roster_points,
        v_roster_scored,
        v_roster_pending
    FROM team_active_roster(p_team_id) r
    JOIN movies m ON m.id = r.movie_id;

    -- Counterpick points (inverted scores from counterpicked movies).
    -- Positive fantasy_points on opponent's movie = negative for counterpicker.
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

    INSERT INTO team_scores (
        team_id,
        total_points,
        draft_points,
        pickup_points,
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
        v_roster_points + v_counterpick_points,
        v_draft_points,
        v_pickup_points,
        v_counterpick_points,
        v_roster_scored,
        v_roster_pending,
        CASE WHEN v_roster_scored > 0
            THEN ROUND(v_roster_points / v_roster_scored, 2)
            ELSE 0 END,
        v_counterpicks_made,
        v_counterpicks_scored,
        NOW()
    )
    ON CONFLICT (team_id) DO UPDATE SET
        total_points = EXCLUDED.total_points,
        draft_points = EXCLUDED.draft_points,
        pickup_points = EXCLUDED.pickup_points,
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
'Recalculates team scores from the active roster (draft picks + pickups, excluding dropped) plus counterpick points (inverted opponent scores).';

-- ============================================================================
-- PART 4: FAN OUT TO EVERY TEAM AFFECTED BY A MOVIE'S SCORE
-- Without the pickups leg, a movie held only via auction would never trigger a
-- recalculation for its owner.
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_teams_for_movie(p_movie_id UUID)
RETURNS void AS $$
DECLARE
    v_team RECORD;
BEGIN
    FOR v_team IN
        SELECT dp.team_id
        FROM draft_picks dp
        WHERE dp.movie_id = p_movie_id
          AND dp.dropped_at IS NULL
        UNION
        SELECT pk.team_id
        FROM pickups pk
        WHERE pk.movie_id = p_movie_id
          AND pk.dropped_at IS NULL
        UNION
        SELECT c.counterpicker_team_id AS team_id
        FROM counterpicks c
        WHERE c.movie_id = p_movie_id
    LOOP
        PERFORM recalculate_team_score_with_counterpicks(v_team.team_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION recalculate_teams_for_movie(UUID) IS
'Recalculates scores for every team affected by a movie: current holders (draft or pickup) and counterpickers.';

-- ============================================================================
-- PART 5: KEEP THE READ-ONLY VARIANT IN SYNC
-- calculate_team_score has no callers in application code today, but leaving a
-- second, differently-wrong scoring function in place is how this regressed.
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE(
    total_points DECIMAL,
    movies_scored INTEGER,
    movies_pending INTEGER,
    average_score DECIMAL
) AS $$
DECLARE
    v_roster_points DECIMAL := 0;
    v_roster_scored INTEGER := 0;
    v_roster_pending INTEGER := 0;
    v_counterpick_points DECIMAL := 0;
BEGIN
    SELECT
        COALESCE(SUM(m.fantasy_points), 0::DECIMAL),
        COUNT(m.fantasy_points)::INTEGER,
        COUNT(*) FILTER (WHERE m.fantasy_points IS NULL)::INTEGER
    INTO v_roster_points, v_roster_scored, v_roster_pending
    FROM team_active_roster(p_team_id) r
    JOIN movies m ON m.id = r.movie_id;

    SELECT COALESCE(SUM(-m.fantasy_points), 0::DECIMAL)
    INTO v_counterpick_points
    FROM counterpicks c
    JOIN movies m ON c.movie_id = m.id
    WHERE c.counterpicker_team_id = p_team_id
      AND m.fantasy_points IS NOT NULL;

    RETURN QUERY SELECT
        v_roster_points + v_counterpick_points,
        v_roster_scored,
        v_roster_pending,
        CASE WHEN v_roster_scored > 0
            THEN ROUND(v_roster_points / v_roster_scored, 2)
            ELSE 0::DECIMAL END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION calculate_team_score(UUID) IS
'Read-only team score from the active roster (draft picks + pickups, excluding dropped) plus counterpick points.';

-- ============================================================================
-- PART 6: BACKFILL
-- Stored team_scores rows are only refreshed when a movie next rescores, so
-- existing totals stay wrong until explicitly recalculated.
-- ============================================================================

DO $$
DECLARE
    v_team RECORD;
BEGIN
    FOR v_team IN SELECT id FROM teams
    LOOP
        PERFORM recalculate_team_score_with_counterpicks(v_team.id);
    END LOOP;
END $$;
