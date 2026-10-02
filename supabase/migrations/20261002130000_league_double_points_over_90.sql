-- ============================================================================
-- THE 90+ POINTS RULE BECOMES A PER-SEASON LEAGUE SETTING
-- ============================================================================
--
-- Until now every movie at 90%+ earned 2 fantasy points per Tomatometer point
-- above 90, in every league. Fantasy Critic makes that bonus a league option
-- (its "90+ Points Rule"), starts new leagues on 1 point per point, and applies
-- whichever rule a league picked to counterpicks by flipping the sign -- there
-- is no separate counterpick rule. This migration does the same:
--
--   * leagues.double_points_over_90 is season-scoped, like the other rules.
--     New seasons default to false: 1 point per point all the way to 100.
--     Seasons that already exist keep true, the rule they have been scored
--     under, so no standings move until a commissioner changes it.
--
--   * movies.fantasy_points now holds the DEFAULT rule's points (RT - 60 at
--     90%+). A double-points season adds (RT - 90) above 90, and
--     league_fantasy_points() is the one place that says so. Every
--     season-scoped reader goes through it: team totals, team_holdings, and
--     the inverted counterpicks.fantasy_points. Stored scores are rebased at
--     the end so old and new rows agree.
--
--   * Changing the rule re-scores the season in the same transaction, from
--     any write path -- owners can update their league row directly, not only
--     through update-league. Completed seasons keep the rule they finished
--     under.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The setting
-- ----------------------------------------------------------------------------
-- ADD COLUMN ... DEFAULT true fills every existing season without running an
-- UPDATE (so no row triggers or completed-season guards fire). The default
-- then flips, so seasons created from here on start on 1 point per point.
ALTER TABLE leagues
    ADD COLUMN double_points_over_90 BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE leagues
    ALTER COLUMN double_points_over_90 SET DEFAULT false;

COMMENT ON COLUMN leagues.double_points_over_90 IS
'The season''s 90+ points rule. false (default): 1 fantasy point per Tomatometer point above 90, the same as from 50 up. true: 2 points per point above 90. Counterpicks invert whichever rule applies. Editable until the season completes; changing it re-scores the season.';

-- ----------------------------------------------------------------------------
-- 2. One definition of a movie's points within a season
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_fantasy_points(
    p_fantasy_points NUMERIC,
    p_combined_score NUMERIC,
    p_double_points_over_90 BOOLEAN
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT p_fantasy_points
        + CASE WHEN p_double_points_over_90 AND p_combined_score > 90
               THEN p_combined_score - 90
               ELSE 0 END;
$$;

COMMENT ON FUNCTION league_fantasy_points(NUMERIC, NUMERIC, BOOLEAN) IS
'A movie''s fantasy points in one season: movies.fantasy_points (the default 1-point-per-point rule) plus (combined_score - 90) above 90 when the season uses double points. Pending (NULL) points stay NULL.';

-- ----------------------------------------------------------------------------
-- 3. movies.fantasy_points: the default rule
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_movie_score(p_movie_id UUID)
RETURNS DECIMAL
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

    -- 1 point per point from 50 to 100. Seasons with double points add the
    -- 90+ bonus when they read the score (league_fantasy_points).
    IF v_rt >= 50 THEN
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
$$;

COMMENT ON FUNCTION calculate_movie_score(UUID) IS
'Calculates fantasy points from the Rotten Tomatoes Tomatometer only, under the default rule: RT>=50 -> RT-60; below 50 the slope halves every 10 points (asymptote ~ -20, no hard floor). Seasons with leagues.double_points_over_90 add (RT-90) above 90 on read, via league_fantasy_points(). Movies without an RT review are unscored (NULL). Sets combined_score to the RT score and triggers team score recalculation.';

COMMENT ON COLUMN movies.fantasy_points IS
'Fantasy points from the RT-only curve under the default rule (baseline 60, 1 point per point from 50 up). Can be negative. A season''s own points come from league_fantasy_points(), which adds the 90+ bonus for double-points seasons.';

-- ----------------------------------------------------------------------------
-- 4. counterpicks.fantasy_points follows each season's rule
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_counterpick_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- The 90+ bonus reads combined_score, so a change to either column counts.
    IF NEW.fantasy_points IS DISTINCT FROM OLD.fantasy_points
       OR NEW.combined_score IS DISTINCT FROM OLD.combined_score THEN
        -- Share-lock the seasons first: a concurrent rule change commits
        -- before the UPDATE below takes its snapshot, so it reads the new rule.
        PERFORM 1 FROM leagues l
        WHERE l.id IN (SELECT c.league_id FROM counterpicks c WHERE c.movie_id = NEW.id)
        FOR SHARE;

        UPDATE counterpicks c
        SET fantasy_points = -league_fantasy_points(NEW.fantasy_points, NEW.combined_score, l.double_points_over_90),
            updated_at = NOW()
        FROM leagues l
        WHERE c.movie_id = NEW.id
          AND l.id = c.league_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_counterpick_points ON movies;
CREATE TRIGGER trigger_update_counterpick_points
    AFTER UPDATE OF fantasy_points, combined_score ON movies
    FOR EACH ROW
    EXECUTE FUNCTION update_counterpick_points();

-- New rows derive the value too, so no write path (commit_counterpick,
-- process-bids, admin scripts) can store points under the wrong rule.
CREATE OR REPLACE FUNCTION set_counterpick_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    SELECT -league_fantasy_points(m.fantasy_points, m.combined_score, l.double_points_over_90)
    INTO NEW.fantasy_points
    FROM movies m
    JOIN leagues l ON l.id = NEW.league_id
    WHERE m.id = NEW.movie_id
    FOR SHARE OF l;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_counterpick_points_trigger
    BEFORE INSERT ON counterpicks
    FOR EACH ROW
    EXECUTE FUNCTION set_counterpick_points();

COMMENT ON COLUMN counterpicks.fantasy_points IS
'Inverted fantasy points earned from this counterpick, under its season''s 90+ points rule (-league_fantasy_points). Kept in sync by update_counterpick_points and by rule changes.';

-- ----------------------------------------------------------------------------
-- 5. Team totals apply the season's rule
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalculate_team_score_with_counterpicks(p_team_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_double_points_over_90 BOOLEAN;
    v_draft_points DECIMAL := 0;
    v_pickup_points DECIMAL := 0;
    v_roster_points DECIMAL := 0;
    v_roster_scored INTEGER := 0;
    v_roster_pending INTEGER := 0;
    v_counterpick_points DECIMAL := 0;
    v_counterpicks_made INTEGER := 0;
    v_counterpicks_scored INTEGER := 0;
BEGIN
    -- The season's 90+ rule, under a share lock: a concurrent rule change
    -- re-scores every team itself, and must not then be overwritten with
    -- totals this call computed under the old rule.
    SELECT l.double_points_over_90 INTO v_double_points_over_90
    FROM teams t
    JOIN league_participants lp ON lp.id = t.participant_id
    JOIN leagues l ON l.id = lp.league_id
    WHERE t.id = p_team_id
    FOR SHARE OF l;

    -- Roster points, split by acquisition source.
    -- Dropped rows are excluded from both legs: a team stops scoring a movie
    -- the moment it drops it.
    SELECT
        COALESCE(SUM(r.points) FILTER (WHERE r.source = 'draft'), 0),
        COALESCE(SUM(r.points) FILTER (WHERE r.source = 'pickup'), 0),
        COALESCE(SUM(r.points), 0),
        COUNT(r.points)::INTEGER,
        COUNT(*) FILTER (WHERE r.points IS NULL)::INTEGER
    INTO
        v_draft_points,
        v_pickup_points,
        v_roster_points,
        v_roster_scored,
        v_roster_pending
    FROM (
        SELECT ar.source,
               league_fantasy_points(m.fantasy_points, m.combined_score, v_double_points_over_90) AS points
        FROM team_active_roster(p_team_id) ar
        JOIN movies m ON m.id = ar.movie_id
    ) r;

    -- Counterpick points (inverted scores from counterpicked movies).
    -- Positive points on opponent's movie = negative for counterpicker.
    SELECT
        COUNT(*)::INTEGER,
        COUNT(m.fantasy_points)::INTEGER,
        COALESCE(SUM(
            -league_fantasy_points(m.fantasy_points, m.combined_score, v_double_points_over_90)
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
$$;

COMMENT ON FUNCTION recalculate_team_score_with_counterpicks(UUID) IS
'Recalculates team scores from the active roster (draft picks + pickups, excluding dropped) plus counterpick points (inverted opponent scores), every movie scored under the season''s 90+ points rule (league_fantasy_points). The counterpick leg intentionally has NO dropped_at filter: counterpicks survive drops of the underlying movie (in leagues where that is even possible -- see leagues.counterpicks_block_drops) and keep scoring the inverted points for the counterpicker. This matches Fantasy Critic''s ruleset and is deliberate, not an omission.';

-- The read-only preview counterpart, kept in step.
CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE(total_points NUMERIC, movies_scored INTEGER, movies_pending INTEGER, average_score NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_double_points_over_90 BOOLEAN;
    v_roster_points DECIMAL := 0;
    v_roster_scored INTEGER := 0;
    v_roster_pending INTEGER := 0;
    v_counterpick_points DECIMAL := 0;
BEGIN
    SELECT l.double_points_over_90 INTO v_double_points_over_90
    FROM teams t
    JOIN league_participants lp ON lp.id = t.participant_id
    JOIN leagues l ON l.id = lp.league_id
    WHERE t.id = p_team_id;

    SELECT
        COALESCE(SUM(r.points), 0::DECIMAL),
        COUNT(r.points)::INTEGER,
        COUNT(*) FILTER (WHERE r.points IS NULL)::INTEGER
    INTO v_roster_points, v_roster_scored, v_roster_pending
    FROM (
        SELECT league_fantasy_points(m.fantasy_points, m.combined_score, v_double_points_over_90) AS points
        FROM team_active_roster(p_team_id) ar
        JOIN movies m ON m.id = ar.movie_id
    ) r;

    SELECT COALESCE(SUM(-league_fantasy_points(m.fantasy_points, m.combined_score, v_double_points_over_90)), 0::DECIMAL)
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
$$;

-- ----------------------------------------------------------------------------
-- 6. team_holdings: each holding's points under its season's rule
-- ----------------------------------------------------------------------------
-- Same columns, same order, same types; only fantasy_points changes meaning,
-- so CREATE OR REPLACE keeps the grants and every consumer's query shape.
CREATE OR REPLACE VIEW public.team_holdings
WITH (security_invoker = true) AS
    SELECT
        dp.id                       AS holding_id,
        'draft'::TEXT               AS source,
        dp.league_id,
        dp.team_id,
        dp.movie_id,
        dp.picked_at                AS acquired_at,
        dp.counterpicked_by_team_id,
        cbt.name                    AS counterpicked_by_name,
        dp.round,
        dp.pick_number,
        NULL::UUID                  AS bid_id,
        NULL::INTEGER               AS amount_paid,
        t.name                      AS team_name,
        m.tmdb_id,
        m.title,
        m.release_date,
        m.poster_url,
        m.status                    AS movie_status,
        m.imdb_id,
        m.combined_score,
        league_fantasy_points(m.fantasy_points, m.combined_score, l.double_points_over_90)::DECIMAL(6, 2)
                                    AS fantasy_points,
        m.overview,
        m.backdrop_url,
        m.vote_average,
        m.vote_count,
        m.popularity,
        m.scoring_bonuses,
        m.scores_updated_at
    FROM draft_picks dp
    JOIN leagues l ON l.id = dp.league_id
    JOIN teams t ON t.id = dp.team_id
    JOIN movies m ON m.id = dp.movie_id
    -- LEFT: most holdings are not counterpicked, and those rows must survive.
    LEFT JOIN teams cbt ON cbt.id = dp.counterpicked_by_team_id
    WHERE dp.dropped_at IS NULL

    UNION ALL

    SELECT
        pk.id                       AS holding_id,
        'pickup'::TEXT              AS source,
        pk.league_id,
        pk.team_id,
        pk.movie_id,
        pk.picked_up_at             AS acquired_at,
        pk.counterpicked_by_team_id,
        cbt.name                    AS counterpicked_by_name,
        NULL::INTEGER               AS round,
        NULL::INTEGER               AS pick_number,
        pk.bid_id,
        pk.amount_paid,
        t.name                      AS team_name,
        m.tmdb_id,
        m.title,
        m.release_date,
        m.poster_url,
        m.status                    AS movie_status,
        m.imdb_id,
        m.combined_score,
        league_fantasy_points(m.fantasy_points, m.combined_score, l.double_points_over_90)::DECIMAL(6, 2)
                                    AS fantasy_points,
        m.overview,
        m.backdrop_url,
        m.vote_average,
        m.vote_count,
        m.popularity,
        m.scoring_bonuses,
        m.scores_updated_at
    FROM pickups pk
    JOIN leagues l ON l.id = pk.league_id
    JOIN teams t ON t.id = pk.team_id
    JOIN movies m ON m.id = pk.movie_id
    LEFT JOIN teams cbt ON cbt.id = pk.counterpicked_by_team_id
    WHERE pk.dropped_at IS NULL;

COMMENT ON VIEW public.team_holdings IS
'Single read surface for active team rosters: drafted movies (draft_picks) plus auction wins (pickups), both filtered to dropped_at IS NULL, with the holding team, the counterpicking team, and the full movie row denormalized in for PostgREST. fantasy_points is the movie''s points under the holding season''s 90+ points rule (league_fantasy_points), not the raw movies.fantasy_points. Read-only -- writes still go to the base tables. Readers needing dropped rows must query the base tables directly.';

-- ----------------------------------------------------------------------------
-- 7. Completed seasons keep their rule; a change re-scores the season
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_league_season()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.series_id IS DISTINCT FROM OLD.series_id THEN
      RAISE EXCEPTION 'A season cannot change series' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'completed' AND (
      NEW.status IS DISTINCT FROM OLD.status OR
      NEW.season_year IS DISTINCT FROM OLD.season_year OR
      NEW.season_end IS DISTINCT FROM OLD.season_end OR
      NEW.double_points_over_90 IS DISTINCT FROM OLD.double_points_over_90 OR
      NEW.completed_at IS DISTINCT FROM OLD.completed_at OR
      NEW.winner_team_ids IS DISTINCT FROM OLD.winner_team_ids OR
      NEW.final_standings IS DISTINCT FROM OLD.final_standings
    ) THEN
      RAISE EXCEPTION 'This season is finished.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF current_user IN ('anon', 'authenticated') THEN
    IF NOT EXISTS (
      SELECT 1 FROM league_series s
      WHERE s.id = NEW.series_id AND s.owner_id = (SELECT auth.uid())
    ) THEN
      RAISE EXCEPTION 'Only the series owner can create its seasons' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'completed' OR NEW.completed_at IS NOT NULL
        OR NEW.winner_team_ids IS NOT NULL OR NEW.final_standings IS NOT NULL THEN
        RAISE EXCEPTION 'Season results are managed by completion' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.winner_team_ids IS DISTINCT FROM OLD.winner_team_ids
      OR NEW.final_standings IS DISTINCT FROM OLD.final_standings
      OR (NEW.status = 'completed' AND OLD.status <> 'completed') THEN
      RAISE EXCEPTION 'Season results are managed by completion' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rescore_season_for_scoring_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_team_id UUID;
BEGIN
    UPDATE counterpicks c
    SET fantasy_points = -league_fantasy_points(m.fantasy_points, m.combined_score, NEW.double_points_over_90),
        updated_at = NOW()
    FROM movies m
    WHERE c.league_id = NEW.id
      AND m.id = c.movie_id
      AND c.fantasy_points IS DISTINCT FROM
          -league_fantasy_points(m.fantasy_points, m.combined_score, NEW.double_points_over_90);

    FOR v_team_id IN
        SELECT t.id
        FROM teams t
        JOIN league_participants lp ON lp.id = t.participant_id
        WHERE lp.league_id = NEW.id
    LOOP
        PERFORM recalculate_team_score_with_counterpicks(v_team_id);
    END LOOP;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION rescore_season_for_scoring_rule() IS
'Re-scores a season after its 90+ points rule changes: refreshes counterpicks.fantasy_points and every team''s totals in the same transaction as the change.';

CREATE TRIGGER rescore_season_on_scoring_rule_change
    AFTER UPDATE OF double_points_over_90 ON leagues
    FOR EACH ROW
    WHEN (OLD.double_points_over_90 IS DISTINCT FROM NEW.double_points_over_90)
    EXECUTE FUNCTION rescore_season_for_scoring_rule();

-- ----------------------------------------------------------------------------
-- 8. Rebase stored scores onto the default rule
-- ----------------------------------------------------------------------------
-- Above 90 the old stored value was the double-points one. Subtracting the
-- bonus is exactly the inverse of league_fantasy_points(), so every existing
-- (double-points) season reads back the same per-movie points and totals: no
-- team needs re-scoring. The counterpick fan-out (section 4) recomputes the
-- same inverted values, and completed seasons keep theirs via
-- guard_season_activity.
UPDATE movies
SET fantasy_points = fantasy_points - (combined_score - 90)
WHERE combined_score > 90
  AND fantasy_points IS NOT NULL;

-- The score last posted to Discord moves onto the same basis; left on the old
-- one, every 90%+ movie would be re-announced as having dropped.
UPDATE movies
SET announced_fantasy_points = announced_fantasy_points - (announced_rt_score - 90)
WHERE announced_rt_score > 90
  AND announced_fantasy_points IS NOT NULL;
