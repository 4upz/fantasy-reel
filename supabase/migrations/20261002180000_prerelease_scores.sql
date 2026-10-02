-- ============================================================================
-- PRE-RELEASE SCORES
-- ============================================================================
--
-- A rostered movie is now scored as soon as Rotten Tomatoes has a Tomatometer
-- for it, which is often days or weeks before it opens -- the way Fantasy
-- Critic scores a game from OpenCritic before launch. update-scores looks for
-- those scores and posts them to Discord.
--
-- A score is not points earned, though. A movie's points count toward its
-- team's total (and against its counterpicker) only from its release date, so
-- standings, rank changes and standings posts all wait for release.
-- movies.fantasy_points keeps meaning "what this movie is worth"; this
-- migration moves the "does it count yet" decision into team scoring.
-- ============================================================================

-- ============================================================================
-- PART 1: THE RULE
-- One definition of "released" for scoring. UTC calendar date, matching the
-- other release checks (counterpick eligibility, complete_league_season) and
-- update-scores' own `new Date().toISOString()` date. Plain SQL with no SET
-- clause so the planner can inline it into the aggregates below.
-- ============================================================================

CREATE OR REPLACE FUNCTION movie_has_released(p_release_date DATE)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT p_release_date IS NOT NULL
     AND p_release_date <= (now() AT TIME ZONE 'UTC')::DATE;
$$;

COMMENT ON FUNCTION movie_has_released(DATE) IS
'True once a movie''s release date has arrived (UTC calendar date). A movie''s fantasy points count toward team totals only from then; a score it gets earlier is a pre-release score.';

-- ============================================================================
-- PART 2: TEAM TOTALS COUNT RELEASED MOVIES ONLY
-- Same legs and columns as before (20260728164550). Each roster movie and
-- each counterpick now contributes its points only once released; until then
-- it is pending, exactly like a movie with no score at all, so movies_scored,
-- movies_pending, average_score and counterpicks_scored all agree with the
-- total.
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_team_score_with_counterpicks(p_team_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    -- Roster points, split by acquisition source. Dropped rows are excluded by
    -- team_active_roster: a team stops scoring a movie the moment it drops it.
    SELECT
        COALESCE(SUM(roster.points) FILTER (WHERE roster.source = 'draft'), 0),
        COALESCE(SUM(roster.points) FILTER (WHERE roster.source = 'pickup'), 0),
        COALESCE(SUM(roster.points), 0),
        COUNT(roster.points)::INTEGER,
        COUNT(*) FILTER (WHERE roster.points IS NULL)::INTEGER
    INTO
        v_draft_points,
        v_pickup_points,
        v_roster_points,
        v_roster_scored,
        v_roster_pending
    FROM (
        SELECT
            r.source,
            CASE WHEN movie_has_released(m.release_date) THEN m.fantasy_points END AS points
        FROM team_active_roster(p_team_id) r
        JOIN movies m ON m.id = r.movie_id
    ) roster;

    -- Counterpick points: the opponent's movie score, inverted. Counterpicks
    -- survive drops, so there is no dropped_at filter here (see the comment
    -- added in 20260808160000_counterpick_trade_guardrails.sql).
    SELECT
        COUNT(*)::INTEGER,
        COUNT(cp.points)::INTEGER,
        COALESCE(SUM(-cp.points), 0)
    INTO v_counterpicks_made, v_counterpicks_scored, v_counterpick_points
    FROM (
        SELECT CASE WHEN movie_has_released(m.release_date) THEN m.fantasy_points END AS points
        FROM counterpicks c
        JOIN movies m ON m.id = c.movie_id
        WHERE c.counterpicker_team_id = p_team_id
    ) cp;

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
$$;

COMMENT ON FUNCTION recalculate_team_score_with_counterpicks(UUID) IS
'Recalculates team scores from the active roster (draft picks + pickups, excluding dropped) plus counterpick points (inverted opponent scores). Only released movies count (movie_has_released); a pre-release score is pending.';

-- The read-only variant stays in step, so the two can never disagree about
-- what counts (that drift is how issue #17 happened).
CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE(
    total_points DECIMAL,
    movies_scored INTEGER,
    movies_pending INTEGER,
    average_score DECIMAL
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_roster_points DECIMAL := 0;
    v_roster_scored INTEGER := 0;
    v_roster_pending INTEGER := 0;
    v_counterpick_points DECIMAL := 0;
BEGIN
    SELECT
        COALESCE(SUM(roster.points), 0::DECIMAL),
        COUNT(roster.points)::INTEGER,
        COUNT(*) FILTER (WHERE roster.points IS NULL)::INTEGER
    INTO v_roster_points, v_roster_scored, v_roster_pending
    FROM (
        SELECT CASE WHEN movie_has_released(m.release_date) THEN m.fantasy_points END AS points
        FROM team_active_roster(p_team_id) r
        JOIN movies m ON m.id = r.movie_id
    ) roster;

    SELECT COALESCE(SUM(-m.fantasy_points), 0::DECIMAL)
    INTO v_counterpick_points
    FROM counterpicks c
    JOIN movies m ON c.movie_id = m.id
    WHERE c.counterpicker_team_id = p_team_id
      AND m.fantasy_points IS NOT NULL
      AND movie_has_released(m.release_date);

    RETURN QUERY SELECT
        v_roster_points + v_counterpick_points,
        v_roster_scored,
        v_roster_pending,
        CASE WHEN v_roster_scored > 0
            THEN ROUND(v_roster_points / v_roster_scored, 2)
            ELSE 0::DECIMAL END;
END;
$$;

COMMENT ON FUNCTION calculate_team_score(UUID) IS
'Read-only team score from the active roster (draft picks + pickups, excluding dropped) plus counterpick points. Only released movies count, as in recalculate_team_score_with_counterpicks.';

-- ============================================================================
-- PART 3: THE RELEASE POST IS OWED
-- Score posts record the score they posted (announced_*, 20261002120000).
-- A score posted before release says its points count from release day, so
-- release day owes a second post saying they now do. This flag is that debt:
-- set when a pre-release score is posted, cleared by the next post made after
-- release. update-scores finds released movies still carrying it, rescores
-- their teams, and posts.
-- ============================================================================

ALTER TABLE movies
  ADD COLUMN announced_before_release BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN movies.announced_before_release IS
'True when the score last posted to Discord (announced_*) was posted before the movie released, so its release is still due a post saying the points now count.';

-- Only released movies were ever scored before this migration, but a release
-- date can move later after scoring (sync-release-dates). Such a movie now
-- counts nothing until its new date, and should get its release post then.
UPDATE movies
SET announced_before_release = true
WHERE announced_fantasy_points IS NOT NULL
  AND NOT movie_has_released(release_date);

-- ============================================================================
-- PART 4: WHICH MOVIES ARE ON A LIVE ROSTER
-- update-scores' pre-release lookups and release posts are for movies held or
-- counterpicked in a season still being played -- not the long tail of
-- unrostered movies the nightly batch also rescores. in_live_season is the
-- condition the view already filtered on, now exposed as a column. The row set
-- is unchanged.
--
-- Dropped and recreated: the column list is being defined afresh (it also
-- picks up the movies columns added since the view was created).
-- ============================================================================

DROP VIEW IF EXISTS score_update_candidates;

CREATE VIEW score_update_candidates WITH (security_invoker = true) AS
SELECT m.*, live.in_live_season
FROM movies m
CROSS JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1 FROM team_holdings h JOIN leagues l ON l.id = h.league_id
    WHERE h.movie_id = m.id AND l.status IS DISTINCT FROM 'completed'
  ) OR EXISTS (
    SELECT 1 FROM counterpicks c JOIN leagues l ON l.id = c.league_id
    WHERE c.movie_id = m.id AND l.status IS DISTINCT FROM 'completed'
  ) AS in_live_season
) live
WHERE live.in_live_season OR (
  NOT EXISTS (SELECT 1 FROM team_holdings h WHERE h.movie_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM counterpicks c WHERE c.movie_id = m.id)
);

COMMENT ON VIEW score_update_candidates IS
'Movies update-scores may rescore: unrostered movies, plus movies held or counterpicked in a season that is not completed (in_live_season). Movies that only affect completed seasons are filtered before PostgREST applies its batch limit.';

REVOKE ALL ON score_update_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON score_update_candidates TO service_role;

-- ============================================================================
-- PART 5: BRING STORED TOTALS IN LINE
-- team_scores only refreshes when something rescores a team. Any live team
-- holding a scored movie that has not released (only possible after a release
-- date moved) would otherwise keep counting it. Teams without a team_scores
-- row are left alone: their season has not activated. Completed seasons are
-- frozen by guard_season_activity.
-- ============================================================================

DO $$
DECLARE
    v_team RECORD;
BEGIN
    FOR v_team IN
        SELECT ts.team_id
        FROM team_scores ts
        JOIN teams t ON t.id = ts.team_id
        JOIN league_participants lp ON lp.id = t.participant_id
        JOIN leagues l ON l.id = lp.league_id
        WHERE l.status IS DISTINCT FROM 'completed'
    LOOP
        PERFORM recalculate_team_score_with_counterpicks(v_team.team_id);
    END LOOP;
END $$;
