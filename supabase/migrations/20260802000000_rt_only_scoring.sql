-- Migration: Rotten Tomatoes-only scoring (Fantasy Critic-style curve)
--
-- Replaces the 3-source weighted hybrid system (IMDb 35% / RT 40% / MC 25%,
-- baseline 70, threshold bonuses) with a single-source curve driven by the
-- RT Tomatometer. Calibrated to match Fantasy Critic's season distribution
-- (see docs/scoring-simulation/RESULTS.md).
--
-- Formula (RT score, 0-100):
--   RT >= 90        -> 30 + 2*(RT-90)          "The 90% Club"
--   50 <= RT < 90   -> RT - 60                 baseline 60 = RT's Fresh line
--   below 50        -> slope halves every 10 points, asymptote ~ -20:
--     40-50: -10   - 0.5     * (50-RT)
--     30-40: -15   - 0.25    * (40-RT)
--     20-30: -17.5 - 0.125   * (30-RT)
--     10-20: -18.75 - 0.0625 * (20-RT)
--      0-10: -19.375 - 0.03125 * (10-RT)
--
-- Other changes:
--   * combined_score now stores the RT score itself (critic score of record).
--   * Bonuses (Certified Fresh / Critical Darling / Critical Disaster) are
--     retired; scoring_bonuses is always NULL (column kept for compatibility).
--   * A movie without an RT review is unscored: combined_score and
--     fantasy_points stay NULL until the Tomatometer exists. IMDb/Metacritic
--     reviews are still stored for display but never produce a score.

CREATE OR REPLACE FUNCTION calculate_movie_score(p_movie_id UUID)
RETURNS DECIMAL AS $$
DECLARE
    v_rt DECIMAL;
    v_fantasy_pts DECIMAL;
BEGIN
    SELECT score INTO v_rt
    FROM reviews
    WHERE movie_id = p_movie_id AND source = 'rotten_tomatoes';

    -- No Tomatometer yet: movie stays unscored (pending)
    IF v_rt IS NULL THEN
        UPDATE movies SET
            combined_score = NULL,
            fantasy_points = NULL,
            scoring_bonuses = NULL,
            scores_updated_at = NOW()
        WHERE id = p_movie_id;

        -- A previously scored movie may have lost its score; keep teams in sync
        PERFORM recalculate_teams_for_movie(p_movie_id);
        RETURN NULL;
    END IF;

    IF v_rt >= 90 THEN
        v_fantasy_pts := 30 + (v_rt - 90) * 2;
    ELSIF v_rt >= 50 THEN
        v_fantasy_pts := v_rt - 60;
    ELSIF v_rt >= 40 THEN
        v_fantasy_pts := -10 - (50 - v_rt) * 0.5;
    ELSIF v_rt >= 30 THEN
        v_fantasy_pts := -15 - (40 - v_rt) * 0.25;
    ELSIF v_rt >= 20 THEN
        v_fantasy_pts := -17.5 - (30 - v_rt) * 0.125;
    ELSIF v_rt >= 10 THEN
        v_fantasy_pts := -18.75 - (20 - v_rt) * 0.0625;
    ELSE
        v_fantasy_pts := -19.375 - (10 - v_rt) * 0.03125;
    END IF;

    v_fantasy_pts := ROUND(v_fantasy_pts, 2);

    UPDATE movies SET
        combined_score = v_rt,
        fantasy_points = v_fantasy_pts,
        scoring_bonuses = NULL,
        scores_updated_at = NOW()
    WHERE id = p_movie_id;

    -- Cascade: recalculate scores for all teams holding this movie
    PERFORM recalculate_teams_for_movie(p_movie_id);

    RETURN v_fantasy_pts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- DATA MIGRATION: Recalculate every movie that has reviews or a stale score
--
-- Every scoring column is checked independently, not just combined_score: a row
-- can carry fantasy_points with combined_score NULL (integration tests write
-- fantasy_points directly, and older scoring functions were not required to set
-- both together). Filtering on combined_score alone would leave those rows with
-- stale points that the new system says should be NULL.
-- ============================================================================
DO $$
DECLARE
    v_movie RECORD;
BEGIN
    FOR v_movie IN
        SELECT DISTINCT m.id
        FROM movies m
        LEFT JOIN reviews r ON r.movie_id = m.id
        WHERE m.combined_score IS NOT NULL
           OR m.fantasy_points IS NOT NULL
           OR m.scoring_bonuses IS NOT NULL
           OR r.id IS NOT NULL
    LOOP
        PERFORM calculate_movie_score(v_movie.id);
    END LOOP;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON FUNCTION calculate_movie_score(UUID) IS
'Calculates fantasy points from the Rotten Tomatoes Tomatometer only.
RT>=90 -> 30 + 2*(RT-90); 50<=RT<90 -> RT-60; below 50 the slope halves every
10 points (asymptote ~ -20, no hard floor). No bonuses. Movies without an RT
review are unscored (NULL). Sets combined_score to the RT score and triggers
team score recalculation.';

COMMENT ON COLUMN movies.combined_score IS
'Rotten Tomatoes Tomatometer score (0-100). NULL until an RT review exists.';

COMMENT ON COLUMN movies.fantasy_points IS
'Fantasy points from the RT-only curve (baseline 60, 2x above 90). Can be negative.';

COMMENT ON COLUMN movies.scoring_bonuses IS
'Retired: bonuses were removed with RT-only scoring. Always NULL; column kept for compatibility.';
