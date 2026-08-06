-- ============================================================================
-- FIX: Counterpicks are draft-only and bidding/counterpicking ignores release
-- ============================================================================
--
-- Bug 1: counterpicks.draft_pick_id and counterpick_bids.draft_pick_id are
-- NOT NULL foreign keys to draft_picks, and get_counterpick_options only
-- queries draft_picks. Movies acquired via pickup can never be counterpicked.
--
-- Bug 2: is_movie_eligible_for_pickup only rejects a released movie once it
-- also has a combined_score, and get_counterpick_options has no release
-- predicate at all. Both let users bid on / counterpick already-released
-- movies whose scores are already known -- a risk-free exploit.
--
-- The release rule everywhere below is exactly one predicate:
--   release_date IS NOT NULL AND release_date >= CURRENT_DATE
-- ============================================================================

-- ============================================================================
-- PART 1: MAKE COUNTERPICK TABLES SOURCE-AGNOSTIC
-- Mirrors the existing team_drops pattern: nullable draft_pick_id, nullable
-- pickup_id, CHECK enforcing exactly one is set.
-- ============================================================================

ALTER TABLE counterpicks ALTER COLUMN draft_pick_id DROP NOT NULL;
ALTER TABLE counterpicks ADD COLUMN pickup_id UUID REFERENCES pickups(id) ON DELETE CASCADE;
ALTER TABLE counterpicks ADD CONSTRAINT counterpicks_exactly_one_source CHECK (
  (pickup_id IS NOT NULL AND draft_pick_id IS NULL) OR
  (pickup_id IS NULL AND draft_pick_id IS NOT NULL)
);
CREATE INDEX idx_counterpicks_pickup_id ON counterpicks(pickup_id);

ALTER TABLE counterpick_bids ALTER COLUMN draft_pick_id DROP NOT NULL;
ALTER TABLE counterpick_bids ADD COLUMN pickup_id UUID REFERENCES pickups(id) ON DELETE CASCADE;
ALTER TABLE counterpick_bids ADD CONSTRAINT counterpick_bids_exactly_one_source CHECK (
  (pickup_id IS NOT NULL AND draft_pick_id IS NULL) OR
  (pickup_id IS NULL AND draft_pick_id IS NOT NULL)
);
CREATE INDEX idx_counterpick_bids_pickup_id ON counterpick_bids(pickup_id);

COMMENT ON COLUMN counterpicks.pickup_id IS
'Reference to the pickup being counterpicked. Either pickup_id OR draft_pick_id must be set.';
COMMENT ON CONSTRAINT counterpicks_exactly_one_source ON counterpicks IS
'Ensures exactly one of pickup_id or draft_pick_id is set for each counterpick.';

COMMENT ON COLUMN counterpick_bids.pickup_id IS
'Reference to the pickup being counterpicked. Either pickup_id OR draft_pick_id must be set.';
COMMENT ON CONSTRAINT counterpick_bids_exactly_one_source ON counterpick_bids IS
'Ensures exactly one of pickup_id or draft_pick_id is set for each counterpick bid.';

-- ============================================================================
-- PART 2: ADD THE COUNTERPICKED FLAG TO PICKUPS
-- Mirrors draft_picks.counterpicked_by_team_id from 20260203_counterpick_system.sql.
-- ============================================================================

ALTER TABLE pickups
ADD COLUMN counterpicked_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX idx_pickups_counterpicked
    ON pickups(counterpicked_by_team_id)
    WHERE counterpicked_by_team_id IS NOT NULL;

COMMENT ON COLUMN pickups.counterpicked_by_team_id IS 'Team that placed a counterpick on this pickup (NULL if not counterpicked)';

-- ============================================================================
-- PART 3: REWRITE get_counterpick_options TO COVER BOTH SOURCES AND RELEASE
-- Adds `source` ('draft' | 'pickup') and `pickup_id` columns. draft_pick_id
-- stays but is now nullable (null for pickup rows).
-- ============================================================================

-- Postgres cannot CREATE OR REPLACE a function into a different RETURNS TABLE
-- shape (source/pickup_id are new columns), so the old signature must be
-- dropped first.
DROP FUNCTION IF EXISTS get_counterpick_options(UUID, UUID);

CREATE FUNCTION get_counterpick_options(p_league_id UUID, p_team_id UUID)
RETURNS TABLE(
    draft_pick_id UUID,
    movie_id UUID,
    movie_title VARCHAR(500),
    poster_url TEXT,
    release_date DATE,
    owner_team_id UUID,
    owner_team_name VARCHAR(100),
    fantasy_points DECIMAL(6, 2),
    source TEXT,
    pickup_id UUID
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
        m.fantasy_points,
        'draft'::TEXT AS source,
        NULL::UUID AS pickup_id
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
      -- Not yet released
      AND m.release_date IS NOT NULL AND m.release_date >= CURRENT_DATE

    UNION ALL

    SELECT
        NULL::UUID AS draft_pick_id,
        pk.movie_id,
        m.title AS movie_title,
        m.poster_url,
        m.release_date,
        pk.team_id AS owner_team_id,
        t.name AS owner_team_name,
        m.fantasy_points,
        'pickup'::TEXT AS source,
        pk.id AS pickup_id
    FROM pickups pk
    JOIN movies m ON pk.movie_id = m.id
    JOIN teams t ON pk.team_id = t.id
    WHERE pk.league_id = p_league_id
      -- Not dropped
      AND pk.dropped_at IS NULL
      -- Not the requesting team's own movies
      AND pk.team_id != p_team_id
      -- Not already counterpicked in this league
      AND NOT EXISTS (
          SELECT 1 FROM counterpicks c
          WHERE c.league_id = p_league_id AND c.movie_id = pk.movie_id
      )
      -- Not yet released
      AND m.release_date IS NOT NULL AND m.release_date >= CURRENT_DATE

    ORDER BY release_date ASC NULLS LAST, movie_title ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_counterpick_options(UUID, UUID) IS
'Returns opponent movies available for counterpicking by the given team, drafted or acquired via pickup, excluding movies that have already been released.';

-- ============================================================================
-- PART 4: FIX is_movie_eligible_for_pickup
-- Two bugs fixed:
--   1. The release check now runs regardless of which identifier the caller
--      passed -- when p_movie_id is NULL, look the movie up by p_tmdb_id. A
--      movie not yet in the database is not a rejection; it stays eligible.
--   2. The rejection condition is now "released" on its own, not "released
--      AND has a score".
-- ============================================================================

CREATE OR REPLACE FUNCTION is_movie_eligible_for_pickup(
  p_league_id UUID,
  p_tmdb_id INTEGER,
  p_movie_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_movie RECORD;
  v_movie_found BOOLEAN;
  v_is_owned BOOLEAN;
BEGIN
  IF p_movie_id IS NOT NULL THEN
    SELECT * INTO v_movie FROM movies WHERE id = p_movie_id;
    IF NOT FOUND THEN
      RETURN FALSE;
    END IF;
    v_movie_found := TRUE;
  ELSE
    -- No movie_id given: look the movie up by tmdb_id instead so the release
    -- check still runs. If it isn't in the database yet, that's the normal
    -- path for a movie being bid on for the first time -- not a rejection.
    SELECT * INTO v_movie FROM movies WHERE tmdb_id = p_tmdb_id;
    v_movie_found := FOUND;
  END IF;

  -- Movie must not be released yet
  IF v_movie_found AND v_movie.release_date IS NOT NULL AND v_movie.release_date < CURRENT_DATE THEN
    RETURN FALSE;
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
