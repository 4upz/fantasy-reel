-- ============================================================================
-- SCORED MOVIES ARE LOCKED
-- ============================================================================
--
-- A movie is scored once it has a Tomatometer: movies.fantasy_points is set
-- (20260802000000). Pre-release scoring (20261002180000) means that can happen
-- weeks before the movie opens, while it is still open to bids and trades.
-- From then on its outcome is known, so buying it at auction, betting against
-- it with a counterpick, or trading it would be trading on a result.
--
-- So a scored movie is locked:
--   * no pickup bid or counterpick bid may be placed on it (place-bid,
--     place-counterpick-bid, and is_movie_eligible_for_pickup below);
--   * a bid already pending on it is cancelled, uncharged, when bids are
--     processed -- resolution_reason 'movie_scored', added below;
--   * it cannot be traded, and nor can the counterpick on it
--     (validate_trade_items below, which execute_trade re-runs under the
--     trade row lock, mirrored in _shared/trade-validation.ts);
--   * an open offer naming one is expired by process-trades
--     (expire_scored_trade_offers below).
--
-- Drops, the draft and draft-phase counterpicks are deliberately unchanged.
-- ============================================================================

-- ============================================================================
-- PART 1: WHY A BID WAS CANCELLED
-- process-bids records 'movie_scored' when it cancels a pending bid on a movie
-- that got its score while the bid waited. Same lists as 20260928023918, plus
-- the new reason.
-- ============================================================================

ALTER TABLE pickup_bids
  DROP CONSTRAINT pickup_bids_resolution_reason_check,
  ADD CONSTRAINT pickup_bids_resolution_reason_check CHECK (
    resolution_reason IS NULL OR (
      status IN ('lost', 'cancelled') AND resolution_reason IN (
        'outbid', 'no_slots', 'insufficient_budget', 'movie_released', 'movie_scored',
        'movie_dropped', 'target_owned', 'target_missing', 'user_cancelled', 'season_completed'
      )
    )
  );

ALTER TABLE counterpick_bids
  DROP CONSTRAINT counterpick_bids_resolution_reason_check,
  ADD CONSTRAINT counterpick_bids_resolution_reason_check CHECK (
    resolution_reason IS NULL OR (
      status IN ('lost', 'cancelled') AND resolution_reason IN (
        'outbid', 'no_slots', 'insufficient_budget', 'movie_released', 'movie_scored',
        'movie_dropped', 'target_owned', 'target_missing', 'user_cancelled', 'season_completed'
      )
    )
  );

-- ============================================================================
-- PART 2: PICKUP ELIGIBILITY
-- Verbatim from 20260805145342 apart from the scored check. place-bid answers
-- first with its own message; this is the backstop, and its "already owned or
-- scored" refusal text is accurate again.
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

  -- Nor scored: a movie with a score is locked, released or not
  IF v_movie_found AND v_movie.fantasy_points IS NOT NULL THEN
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

COMMENT ON FUNCTION is_movie_eligible_for_pickup(UUID, INTEGER, UUID) IS
'Checks if a movie can be picked up: not owned in the league, not released, and not scored (a movie with fantasy_points is locked against bids and trades).';

-- ============================================================================
-- PART 3: THE TRADE REFUSAL
-- One sentence per item kind, shared by validate_trade_items and the offer
-- sweep below so the two cannot drift. User-facing and worded identically to
-- scoredItemError() in _shared/trade-validation.ts -- change them together.
-- ============================================================================

CREATE OR REPLACE FUNCTION scored_trade_item_error(p_source TEXT, p_title TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT CASE WHEN p_source = 'counterpick'
    THEN format('"%s" already has a score, so the counterpick on it can no longer be traded.', COALESCE(p_title, 'Unknown Movie'))
    ELSE format('"%s" already has a score, so it can no longer be traded.', COALESCE(p_title, 'Unknown Movie'))
  END;
$$;

COMMENT ON FUNCTION scored_trade_item_error(TEXT, TEXT) IS
'Why a trade item is refused once its movie is scored. Worded identically to scoredItemError() in _shared/trade-validation.ts.';

-- ============================================================================
-- PART 4: validate_trade_items REFUSES SCORED ITEMS
-- Verbatim from 20260823120000 apart from v_scored. Each branch already reads
-- the item's movie for its title, so the score comes from the same row. The
-- check runs after ownership, per item, in the order the TypeScript validator
-- runs them. execute_trade re-runs this under the trade row lock, so a movie
-- scored after an offer was agreed stops the trade there too.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_trade_items(
  p_team_id UUID,
  p_items JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_movie RECORD;
  v_faab INTEGER;
  v_budget INTEGER;
  v_max_faab INTEGER;
  v_source_id UUID;
  v_title TEXT;
  v_owned BOOLEAN;
  v_scored BOOLEAN;
BEGIN
  -- Get the league's budget configuration
  v_max_faab := get_league_faab_budget(p_team_id);
  IF v_max_faab IS NULL THEN
    v_max_faab := 100; -- Fallback default
  END IF;

  -- Check the budget amount
  v_faab := COALESCE((p_items->>'faab')::INTEGER, 0);

  -- Validate the budget amount is within bounds
  IF v_faab < 0 THEN
    RETURN 'Budget must be a non-negative number';
  END IF;

  IF v_faab > v_max_faab THEN
    RETURN format('Budget must not exceed the league maximum of $%s', v_max_faab);
  END IF;

  IF v_faab > 0 THEN
    SELECT remaining_budget INTO v_budget
    FROM team_budgets
    WHERE team_id = p_team_id;

    IF v_budget IS NULL OR v_faab > v_budget THEN
      RETURN format('Insufficient budget. Have $%s, trying to trade $%s', COALESCE(v_budget, 0), v_faab);
    END IF;
  END IF;

  -- Check each movie
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(p_items->'movies', '[]'::jsonb)) LOOP
    v_source_id := (v_movie.value->>'source_id')::UUID;

    IF (v_movie.value->>'source') = 'draft_pick' THEN
      SELECT m.title, (dp.team_id = p_team_id AND dp.dropped_at IS NULL), m.fantasy_points IS NOT NULL
      INTO v_title, v_owned, v_scored
      FROM draft_picks dp
      JOIN movies m ON m.id = dp.movie_id
      WHERE dp.id = v_source_id;

      IF NOT FOUND THEN
        RETURN format('"%s" is no longer available to trade.', COALESCE(v_title, 'Unknown Movie'));
      END IF;
      IF NOT v_owned THEN
        RETURN format('"%s" is no longer on that team''s roster, so it can''t be traded.', v_title);
      END IF;

    ELSIF (v_movie.value->>'source') = 'pickup' THEN
      SELECT m.title, (pk.team_id = p_team_id AND pk.dropped_at IS NULL), m.fantasy_points IS NOT NULL
      INTO v_title, v_owned, v_scored
      FROM pickups pk
      JOIN movies m ON m.id = pk.movie_id
      WHERE pk.id = v_source_id;

      IF NOT FOUND THEN
        RETURN format('"%s" is no longer available to trade.', COALESCE(v_title, 'Unknown Movie'));
      END IF;
      IF NOT v_owned THEN
        RETURN format('"%s" is no longer on that team''s roster, so it can''t be traded.', v_title);
      END IF;

    ELSIF (v_movie.value->>'source') = 'counterpick' THEN
      -- Ownership of a counterpick is counterpicker_team_id, nothing else:
      -- it deliberately survives a drop of the movie it targets, so a row that
      -- still exists is still worth points and still tradeable.
      SELECT m.title, (c.counterpicker_team_id = p_team_id), m.fantasy_points IS NOT NULL
      INTO v_title, v_owned, v_scored
      FROM counterpicks c
      JOIN movies m ON m.id = c.movie_id
      WHERE c.id = v_source_id;

      IF NOT FOUND THEN
        RETURN format('The counterpick on "%s" is no longer available to trade.', COALESCE(v_title, 'Unknown Movie'));
      END IF;
      IF NOT v_owned THEN
        RETURN format('The counterpick on "%s" is no longer owned by that team, so it can''t be traded.', v_title);
      END IF;

    ELSE
      RETURN 'Invalid movie source: ' || COALESCE(v_movie.value->>'source', 'null');
    END IF;

    -- A scored movie is locked, and so is the counterpick on it: either way
    -- the trade would change hands on a known result.
    IF v_scored THEN
      RETURN scored_trade_item_error(v_movie.value->>'source', v_title);
    END IF;
  END LOOP;

  RETURN NULL; -- Valid
END;
$$;

COMMENT ON FUNCTION validate_trade_items IS
  'Validates trade items -- draft pick, pickup and counterpick ownership, that no item''s movie is scored (a scored movie is locked), and the fantasy budget against league configuration. Messages are user-facing and name the movie, not its id; kept worded identically to _shared/trade-validation.ts.';

-- ============================================================================
-- PART 5: OPEN OFFERS NAMING A SCORED MOVIE EXPIRE
-- An offer naming a scored movie can never execute any more, so process-trades
-- ends it rather than leaving it to sit open until its clock runs out, or until
-- an agreed trade fails validation at execution as though something had broken.
--
-- Each item's movie is resolved through its source row, never the items JSONB:
-- the movie_id there is client-supplied, and the title a snapshot. The reason
-- names the first scored item, initiator side first, in the words
-- validate_trade_items would use. expired_reason stays NULL -- veto_reason
-- carries the explanation, as for any offer that stopped validating -- and the
-- trade card shows it as is.
--
-- The four open statuses are the list hardcoded in get_contested_source_ids,
-- execute_trade and the partial indexes of 20260809120000. Claims and flips in
-- one statement, re-checking the status under the row lock, so overlapping
-- cron runs cannot both notify -- the shape expire_lapsed_trade_offers uses.
-- ============================================================================

CREATE OR REPLACE FUNCTION expire_scored_trade_offers()
RETURNS SETOF trade_offers
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT DISTINCT ON (t.id)
           t.id,
           scored_trade_item_error(item.source, m.title) AS reason
    FROM trade_offers t
    JOIN leagues l ON l.id = t.league_id
    CROSS JOIN LATERAL (
      SELECT 1 AS side, e.position, e.value->>'source' AS source, (e.value->>'source_id')::UUID AS source_id
      FROM jsonb_array_elements(COALESCE(t.initiator_items->'movies', '[]'::jsonb))
        WITH ORDINALITY AS e(value, position)
      UNION ALL
      SELECT 2, e.position, e.value->>'source', (e.value->>'source_id')::UUID
      FROM jsonb_array_elements(COALESCE(t.recipient_items->'movies', '[]'::jsonb))
        WITH ORDINALITY AS e(value, position)
    ) item
    LEFT JOIN draft_picks dp ON item.source = 'draft_pick' AND dp.id = item.source_id
    LEFT JOIN pickups pk ON item.source = 'pickup' AND pk.id = item.source_id
    LEFT JOIN counterpicks c ON item.source = 'counterpick' AND c.id = item.source_id
    JOIN movies m ON m.id = COALESCE(dp.movie_id, pk.movie_id, c.movie_id)
    WHERE t.status IN ('proposed', 'countered', 'accepted', 'review')
      -- A finished season's offers are expireFinishedSeasonOffers' to end.
      AND l.status IS DISTINCT FROM 'completed'
      AND m.fantasy_points IS NOT NULL
    ORDER BY t.id, item.side, item.position
  )
  UPDATE trade_offers t
  SET status = 'expired'::trade_status,
      veto_reason = scored.reason,
      updated_at = now()
  FROM scored
  WHERE t.id = scored.id
    AND t.status IN ('proposed', 'countered', 'accepted', 'review')
  RETURNING t.*;
END;
$$;

COMMENT ON FUNCTION expire_scored_trade_offers() IS
  'Expires every open offer (proposed, countered, accepted, review) that names a scored movie or the counterpick on one, with veto_reason saying which, worded as validate_trade_items would. Claims and flips in one statement so overlapping cron runs cannot double-notify; the caller notifies exactly the returned rows.';

REVOKE EXECUTE ON FUNCTION expire_scored_trade_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_scored_trade_offers() TO service_role;
