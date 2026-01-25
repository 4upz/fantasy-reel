-- Migration: Hybrid Fantasy Points Scoring System
-- Replaces weighted average (0-100) with baseline-relative fantasy points.
--
-- Base Points Formula:
--   90+ → +20 base + 2 pts per point above 90
--   70-89 → +1 pt per point above 70
--   Below 70 → -0.5 pts per point below 70 (floor: -15)
--
-- Bonus Multipliers:
--   Certified Fresh: RT >= 75% → +3
--   Critical Darling: All 3 sources >= 80 → +5
--   Critical Disaster: Any source < 40 → -5 (doesn't stack)

-- ============================================================================
-- SCHEMA CHANGES: Add fantasy points columns to movies table
-- ============================================================================
ALTER TABLE movies ADD COLUMN IF NOT EXISTS fantasy_points DECIMAL(6, 2);
ALTER TABLE movies ADD COLUMN IF NOT EXISTS scoring_bonuses JSONB;

-- Create index for efficient fantasy points queries
CREATE INDEX IF NOT EXISTS idx_movies_fantasy_points ON movies(fantasy_points);

-- ============================================================================
-- HYBRID FANTASY POINTS CALCULATION FUNCTION
-- Calculates fantasy points based on baseline-relative formula with bonuses
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_movie_score(p_movie_id UUID)
RETURNS DECIMAL AS $$
DECLARE
    v_imdb DECIMAL;
    v_rt DECIMAL;
    v_mc DECIMAL;
    v_combined DECIMAL;
    v_fantasy_pts DECIMAL;
    v_base_pts DECIMAL;
    v_certified_fresh BOOLEAN := FALSE;
    v_critical_darling BOOLEAN := FALSE;
    v_critical_disaster BOOLEAN := FALSE;
    v_total_weight DECIMAL := 0;
    v_bonuses JSONB;
BEGIN
    -- Get individual scores
    SELECT score INTO v_imdb FROM reviews WHERE movie_id = p_movie_id AND source = 'imdb';
    SELECT score INTO v_rt FROM reviews WHERE movie_id = p_movie_id AND source = 'rotten_tomatoes';
    SELECT score INTO v_mc FROM reviews WHERE movie_id = p_movie_id AND source = 'metacritic';

    -- Calculate weighted average for combined_score (preserve legacy behavior)
    -- Weights: IMDb=35%, RT=40%, Metacritic=25%
    SELECT ROUND(
        SUM(r.score * w.weight) / NULLIF(SUM(w.weight), 0),
        2
    )
    INTO v_combined
    FROM reviews r
    JOIN (VALUES
        ('imdb', 0.35::DECIMAL),
        ('rotten_tomatoes', 0.40::DECIMAL),
        ('metacritic', 0.25::DECIMAL)
    ) AS w(source, weight) ON r.source = w.source
    WHERE r.movie_id = p_movie_id;

    -- Return NULL if no scores available
    IF v_combined IS NULL THEN
        UPDATE movies SET
            combined_score = NULL,
            fantasy_points = NULL,
            scoring_bonuses = NULL,
            scores_updated_at = NOW()
        WHERE id = p_movie_id;
        RETURN NULL;
    END IF;

    -- Calculate base fantasy points from weighted average
    IF v_combined >= 90 THEN
        -- 90+ → +20 base + 2 pts per point above 90
        v_base_pts := 20 + (v_combined - 90) * 2;
    ELSIF v_combined >= 70 THEN
        -- 70-89 → +1 pt per point above 70
        v_base_pts := v_combined - 70;
    ELSE
        -- Below 70 → -0.5 pts per point below 70 (floor: -15)
        v_base_pts := GREATEST((70 - v_combined) * -0.5, -15);
    END IF;

    -- Check for bonus conditions
    -- Certified Fresh: RT >= 75%
    IF v_rt IS NOT NULL AND v_rt >= 75 THEN
        v_certified_fresh := TRUE;
    END IF;

    -- Critical Darling: All 3 sources >= 80
    IF v_imdb IS NOT NULL AND v_rt IS NOT NULL AND v_mc IS NOT NULL
       AND v_imdb >= 80 AND v_rt >= 80 AND v_mc >= 80 THEN
        v_critical_darling := TRUE;
    END IF;

    -- Critical Disaster: Any source < 40
    IF (v_imdb IS NOT NULL AND v_imdb < 40)
       OR (v_rt IS NOT NULL AND v_rt < 40)
       OR (v_mc IS NOT NULL AND v_mc < 40) THEN
        v_critical_disaster := TRUE;
    END IF;

    -- Calculate total fantasy points
    v_fantasy_pts := v_base_pts;
    IF v_certified_fresh THEN
        v_fantasy_pts := v_fantasy_pts + 3;
    END IF;
    IF v_critical_darling THEN
        v_fantasy_pts := v_fantasy_pts + 5;
    END IF;
    IF v_critical_disaster THEN
        v_fantasy_pts := v_fantasy_pts - 5;
    END IF;

    -- Round to 2 decimal places
    v_fantasy_pts := ROUND(v_fantasy_pts, 2);

    -- Build bonuses JSON
    v_bonuses := jsonb_build_object(
        'certified_fresh', v_certified_fresh,
        'critical_darling', v_critical_darling,
        'critical_disaster', v_critical_disaster
    );

    -- Update movie record
    UPDATE movies SET
        combined_score = v_combined,
        fantasy_points = v_fantasy_pts,
        scoring_bonuses = v_bonuses,
        scores_updated_at = NOW()
    WHERE id = p_movie_id;

    -- Cascade: Recalculate scores for all teams that drafted this movie
    PERFORM recalculate_teams_for_movie(p_movie_id);

    RETURN v_fantasy_pts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RECALCULATE TEAM SCORES FOR A SPECIFIC MOVIE
-- Now uses fantasy_points instead of combined_score
-- ============================================================================
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
        -- Update team_scores using fantasy_points from movies table
        INSERT INTO team_scores (team_id, total_points, movies_scored, movies_pending, average_score, last_calculated_at)
        SELECT
            v_team.team_id,
            COALESCE(SUM(m.fantasy_points), 0),
            COUNT(m.fantasy_points)::INTEGER,
            COUNT(*) FILTER (WHERE m.fantasy_points IS NULL)::INTEGER,
            COALESCE(AVG(m.fantasy_points), 0),
            NOW()
        FROM draft_picks dp
        JOIN movies m ON dp.movie_id = m.id
        WHERE dp.team_id = v_team.team_id
        ON CONFLICT (team_id) DO UPDATE SET
            total_points = EXCLUDED.total_points,
            movies_scored = EXCLUDED.movies_scored,
            movies_pending = EXCLUDED.movies_pending,
            average_score = EXCLUDED.average_score,
            last_calculated_at = EXCLUDED.last_calculated_at;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE calculate_team_score TO USE fantasy_points
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE(
    total_points DECIMAL,
    movies_scored INTEGER,
    movies_pending INTEGER,
    average_score DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(m.fantasy_points), 0::DECIMAL) AS total_points,
        COUNT(m.fantasy_points)::INTEGER AS movies_scored,
        COUNT(*) FILTER (WHERE m.fantasy_points IS NULL)::INTEGER AS movies_pending,
        CASE
            WHEN COUNT(m.fantasy_points) > 0
            THEN ROUND(COALESCE(SUM(m.fantasy_points), 0) / COUNT(m.fantasy_points), 2)
            ELSE 0::DECIMAL
        END AS average_score
    FROM draft_picks dp
    JOIN movies m ON dp.movie_id = m.id
    WHERE dp.team_id = p_team_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- DATA MIGRATION: Recalculate scores for all existing scored movies
-- ============================================================================
DO $$
DECLARE
    v_movie RECORD;
    v_result DECIMAL;
BEGIN
    -- Find all movies with combined_score and recalculate with new formula
    FOR v_movie IN
        SELECT id FROM movies WHERE combined_score IS NOT NULL
    LOOP
        -- Recalculate using the new formula
        SELECT calculate_movie_score(v_movie.id) INTO v_result;
    END LOOP;
END;
$$;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================
COMMENT ON FUNCTION calculate_movie_score(UUID) IS
'Calculates hybrid fantasy points for a movie using baseline-relative scoring.
Base points: 90+→(+20+2*excess), 70-89→(+1 per point above 70), <70→(-0.5 per point below, floor -15).
Bonuses: Certified Fresh (RT>=75→+3), Critical Darling (all>=80→+5), Critical Disaster (any<40→-5).
Updates movies.fantasy_points and triggers team score recalculation.';

COMMENT ON COLUMN movies.fantasy_points IS
'Hybrid fantasy points calculated from critic scores with bonuses. Can be negative.';

COMMENT ON COLUMN movies.scoring_bonuses IS
'JSON object tracking which bonuses were applied: certified_fresh, critical_darling, critical_disaster.';
