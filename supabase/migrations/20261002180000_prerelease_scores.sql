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
-- One definition of "released" for scoring: the UTC calendar date, the same
-- calendar update-scores and the other release checks use. Plain SQL with no
-- SET clause so the planner can inline it into the aggregates below.
--
-- Not the acquisition boundary. movie_release_boundary() (20260824120000)
-- keeps a movie open to drafts, bids and drops through its release day;
-- scoring has always counted a movie from its release day itself.
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
-- calculate_team_score() becomes the one definition of a team's score, every
-- leg of it, and recalculate_team_score_with_counterpicks() stores what it
-- returns. Each used to inline the same legs (20260728164550), and that pair
-- had already drifted apart once (issue #17).
--
-- Each roster movie and each counterpick contributes its points only once
-- released; until then it is pending, exactly like a movie with no score, so
-- movies_scored, movies_pending, average_score and counterpicks_scored all
-- agree with the total.
--
-- The return type grows to everything team_scores stores, so the function is
-- recreated; its original four columns keep their positions. It no longer
-- needs SECURITY DEFINER: the recalculation calls it with the definer's
-- access, and anyone else sees only what RLS already shows them.
-- ============================================================================

DROP FUNCTION IF EXISTS calculate_team_score(UUID);

CREATE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE(
    total_points DECIMAL,
    movies_scored INTEGER,
    movies_pending INTEGER,
    average_score DECIMAL,
    draft_points DECIMAL,
    pickup_points DECIMAL,
    counterpick_points DECIMAL,
    counterpicks_made INTEGER,
    counterpicks_scored INTEGER
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
    WITH roster AS (
        -- Dropped rows are excluded by team_active_roster: a team stops
        -- scoring a movie the moment it drops it.
        SELECT
            r.source,
            CASE WHEN movie_has_released(m.release_date) THEN m.fantasy_points END AS points
        FROM team_active_roster(p_team_id) r
        JOIN movies m ON m.id = r.movie_id
    ),
    counterpicked AS (
        -- The opponent's movie score, inverted. Counterpicks survive drops, so
        -- no dropped_at filter (see 20260808160000_counterpick_trade_guardrails).
        SELECT CASE WHEN movie_has_released(m.release_date) THEN -m.fantasy_points END AS points
        FROM counterpicks c
        JOIN movies m ON m.id = c.movie_id
        WHERE c.counterpicker_team_id = p_team_id
    )
    SELECT
        r.points + c.points,
        r.scored,
        r.pending,
        CASE WHEN r.scored > 0 THEN ROUND(r.points / r.scored, 2) ELSE 0 END,
        r.draft,
        r.pickup,
        c.points,
        c.made,
        c.scored
    FROM (
        SELECT
            COALESCE(SUM(points), 0) AS points,
            COUNT(points)::INTEGER AS scored,
            COUNT(*) FILTER (WHERE points IS NULL)::INTEGER AS pending,
            COALESCE(SUM(points) FILTER (WHERE source = 'draft'), 0) AS draft,
            COALESCE(SUM(points) FILTER (WHERE source = 'pickup'), 0) AS pickup
        FROM roster
    ) r, (
        SELECT
            COALESCE(SUM(points), 0) AS points,
            COUNT(*)::INTEGER AS made,
            COUNT(points)::INTEGER AS scored
        FROM counterpicked
    ) c;
$$;

COMMENT ON FUNCTION calculate_team_score(UUID) IS
'A team''s score from its active roster (draft picks + pickups, excluding dropped) plus counterpick points (inverted opponent scores). Only released movies count (movie_has_released); a pre-release score is pending. The one definition: recalculate_team_score_with_counterpicks stores what this returns.';

CREATE OR REPLACE FUNCTION recalculate_team_score_with_counterpicks(p_team_id UUID)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    SELECT
        p_team_id,
        s.total_points,
        s.draft_points,
        s.pickup_points,
        s.counterpick_points,
        s.movies_scored,
        s.movies_pending,
        s.average_score,
        s.counterpicks_made,
        s.counterpicks_scored,
        NOW()
    FROM calculate_team_score(p_team_id) s
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
$$;

COMMENT ON FUNCTION recalculate_team_score_with_counterpicks(UUID) IS
'Stores calculate_team_score() for a team in team_scores. Only released movies count; a pre-release score is pending.';

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
