-- ============================================================================
-- Get next Saturday 8pm UTC (weekly processing deadline)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_next_processing_deadline()
RETURNS TIMESTAMPTZ AS $$
DECLARE
  now_utc TIMESTAMPTZ := now() AT TIME ZONE 'UTC';
  next_saturday TIMESTAMPTZ;
  days_until_saturday INTEGER;
BEGIN
  -- Calculate days until next Saturday (6 = Saturday in PostgreSQL)
  days_until_saturday := (6 - EXTRACT(DOW FROM now_utc)::INTEGER + 7) % 7;

  -- If it's Saturday but before 8pm, use today
  IF days_until_saturday = 0 AND EXTRACT(HOUR FROM now_utc) < 20 THEN
    next_saturday := date_trunc('day', now_utc) + INTERVAL '20 hours';
  ELSE
    -- If it's Saturday after 8pm, go to next Saturday
    IF days_until_saturday = 0 THEN
      days_until_saturday := 7;
    END IF;
    next_saturday := date_trunc('day', now_utc) + (days_until_saturday || ' days')::INTERVAL + INTERVAL '20 hours';
  END IF;

  RETURN next_saturday;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Get team's active pickup count (non-dropped pickups)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_team_pickup_count(p_team_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM pickups
    WHERE team_id = p_team_id
    AND dropped_at IS NULL
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Get team's drop count
-- ============================================================================
CREATE OR REPLACE FUNCTION get_team_drop_count(p_team_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM team_drops
    WHERE team_id = p_team_id
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Check if movie is eligible for pickup (not released, not scored, not owned)
-- ============================================================================
CREATE OR REPLACE FUNCTION is_movie_eligible_for_pickup(
  p_league_id UUID,
  p_tmdb_id INTEGER,
  p_movie_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_movie RECORD;
  v_is_owned BOOLEAN;
BEGIN
  -- If we have a movie_id, check the DB record
  IF p_movie_id IS NOT NULL THEN
    SELECT * INTO v_movie FROM movies WHERE id = p_movie_id;

    -- Movie must exist
    IF NOT FOUND THEN
      RETURN FALSE;
    END IF;

    -- Movie must not be released yet (or released but no scores)
    IF v_movie.release_date IS NOT NULL AND v_movie.release_date < CURRENT_DATE THEN
      -- Check if it has scores
      IF v_movie.combined_score IS NOT NULL THEN
        RETURN FALSE;
      END IF;
    END IF;
  END IF;

  -- Check if movie is already owned in this league (via draft or pickup)
  SELECT EXISTS (
    SELECT 1 FROM draft_picks dp
    JOIN movies m ON m.id = dp.movie_id
    WHERE dp.league_id = p_league_id AND m.tmdb_id = p_tmdb_id
    UNION
    SELECT 1 FROM pickups p
    JOIN movies m ON m.id = p.movie_id
    WHERE p.league_id = p_league_id AND m.tmdb_id = p_tmdb_id AND p.dropped_at IS NULL
  ) INTO v_is_owned;

  RETURN NOT v_is_owned;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Update calculate_team_score to include pickups
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE (
  total_points DECIMAL(10, 2),
  movies_scored INTEGER,
  movies_pending INTEGER,
  average_score DECIMAL(5, 2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(m.combined_score), 0)::DECIMAL(10, 2) AS total_points,
    COUNT(m.combined_score)::INTEGER AS movies_scored,
    COUNT(*) FILTER (WHERE m.combined_score IS NULL)::INTEGER AS movies_pending,
    COALESCE(AVG(m.combined_score), 0)::DECIMAL(5, 2) AS average_score
  FROM (
    -- Draft picks
    SELECT dp.movie_id
    FROM draft_picks dp
    WHERE dp.team_id = p_team_id
    UNION ALL
    -- Active pickups (not dropped)
    SELECT pk.movie_id
    FROM pickups pk
    WHERE pk.team_id = p_team_id AND pk.dropped_at IS NULL
  ) AS team_movies
  JOIN movies m ON m.id = team_movies.movie_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Initialize team budget (called when league becomes active)
-- ============================================================================
CREATE OR REPLACE FUNCTION initialize_team_budgets(p_league_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO team_budgets (team_id, remaining_budget, total_spent)
  SELECT t.id, 100, 0
  FROM teams t
  JOIN league_participants lp ON lp.id = t.participant_id
  WHERE lp.league_id = p_league_id
  ON CONFLICT (team_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON FUNCTION get_next_processing_deadline() IS
'Returns next Saturday 8pm UTC - the weekly bid processing deadline';

COMMENT ON FUNCTION get_team_pickup_count(UUID) IS
'Returns count of active (non-dropped) pickups for a team';

COMMENT ON FUNCTION get_team_drop_count(UUID) IS
'Returns count of drops a team has made this season';

COMMENT ON FUNCTION is_movie_eligible_for_pickup(UUID, INTEGER, UUID) IS
'Checks if a movie can be picked up (not owned, not released with scores)';

COMMENT ON FUNCTION initialize_team_budgets(UUID) IS
'Creates budget records for all teams in a league with $100 starting budget';
