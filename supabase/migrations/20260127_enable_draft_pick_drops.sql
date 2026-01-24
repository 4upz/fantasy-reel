-- ============================================================================
-- Enable Dropping Draft Picks
-- ============================================================================
-- This migration adds support for dropping draft picks (not just pickups).
-- The drop limit is shared across both draft picks and pickups.
-- ============================================================================

-- 1. Add dropped_at column to draft_picks
ALTER TABLE draft_picks ADD COLUMN dropped_at TIMESTAMPTZ;

-- 2. Index for efficient filtering of active (non-dropped) picks
CREATE INDEX idx_draft_picks_active ON draft_picks(team_id) WHERE dropped_at IS NULL;

-- 3. Make team_drops.pickup_id nullable (it was NOT NULL before)
ALTER TABLE team_drops ALTER COLUMN pickup_id DROP NOT NULL;

-- 4. Add draft_pick_id column to team_drops
ALTER TABLE team_drops ADD COLUMN draft_pick_id UUID REFERENCES draft_picks(id) ON DELETE CASCADE;

-- 5. Constraint: exactly one of pickup_id or draft_pick_id must be set
ALTER TABLE team_drops ADD CONSTRAINT team_drops_exactly_one_source CHECK (
  (pickup_id IS NOT NULL AND draft_pick_id IS NULL) OR
  (pickup_id IS NULL AND draft_pick_id IS NOT NULL)
);

-- 6. Index for draft_pick_id lookups
CREATE INDEX idx_team_drops_draft_pick_id ON team_drops(draft_pick_id);

-- 7. Update calculate_team_score() to exclude dropped draft picks
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
    -- Draft picks (excluding dropped)
    SELECT dp.movie_id
    FROM draft_picks dp
    WHERE dp.team_id = p_team_id AND dp.dropped_at IS NULL
    UNION ALL
    -- Active pickups (not dropped)
    SELECT pk.movie_id
    FROM pickups pk
    WHERE pk.team_id = p_team_id AND pk.dropped_at IS NULL
  ) AS team_movies
  JOIN movies m ON m.id = team_movies.movie_id;
END;
$$ LANGUAGE plpgsql;

-- 8. Update is_movie_eligible_for_pickup() to account for dropped draft picks
-- A movie becomes eligible for pickup if its draft pick was dropped
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
  -- Only consider non-dropped entries
  SELECT EXISTS (
    SELECT 1 FROM draft_picks dp
    JOIN movies m ON m.id = dp.movie_id
    WHERE dp.league_id = p_league_id
      AND m.tmdb_id = p_tmdb_id
      AND dp.dropped_at IS NULL  -- Exclude dropped draft picks
    UNION
    SELECT 1 FROM pickups p
    JOIN movies m ON m.id = p.movie_id
    WHERE p.league_id = p_league_id
      AND m.tmdb_id = p_tmdb_id
      AND p.dropped_at IS NULL
  ) INTO v_is_owned;

  RETURN NOT v_is_owned;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON COLUMN draft_picks.dropped_at IS
'Timestamp when the draft pick was dropped. NULL means the pick is still active.';

COMMENT ON COLUMN team_drops.draft_pick_id IS
'Reference to the dropped draft pick. Either pickup_id OR draft_pick_id must be set.';

COMMENT ON CONSTRAINT team_drops_exactly_one_source ON team_drops IS
'Ensures exactly one of pickup_id or draft_pick_id is set for each drop record.';
