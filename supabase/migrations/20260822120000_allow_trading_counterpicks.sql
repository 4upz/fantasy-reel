-- ============================================================================
-- Allow Counterpicks to be Traded
--
-- A counterpick is an asset a team owns -- an inverted bet on somebody else's
-- movie, worth real points in team_scores.counterpick_points -- but until now
-- it was the one asset that could not be put on the table. TradeItems.movies
-- accepted only 'draft_pick' and 'pickup' sources, so a team could trade the
-- movies it holds and its budget, but never the bets it holds.
--
-- Fantasy Critic allows trading counterpicks (Lib/Services/TradeService.cs
-- treats a counterpick publisher-game like any other), and there is no reason
-- this app should not. This migration adds 'counterpick' as a third trade item
-- source, with source_id = counterpicks.id.
--
-- What moves when a counterpick trades:
--   - counterpicks.counterpicker_team_id     -> the receiving team
--   - draft_picks/pickups.counterpicked_by_team_id (the denormalized copy the
--     drop rules read) -> the same team, so the two cannot drift
--   - team_scores for BOTH teams are recalculated, because counterpick_points
--     moved between them
--
-- counterpicks.target_team_id keeps its old meaning -- whoever holds the
-- counterpicked movie -- and a counterpick trade on its own does not change it.
-- But a single trade can now move BOTH halves, so the two columns are settled
-- together by settle_counterpicks_for_trade(), which replaces (and drops) the
-- retarget-only helper from 20260808160000. See its comment for why one
-- statement is not optional here.
--
-- THE INVARIANT: counterpicks_not_own_movie forbids
-- counterpicker_team_id = target_team_id, and it is not just a constraint --
-- a team betting against its own movie is not a coherent bet. Two trades can
-- now reach that state, and both are rejected up front by one post-trade check
-- in execute_trade():
--   1. a counterpicked movie sent to the team that counterpicked it
--      (already rejected before this migration -- message preserved verbatim)
--   2. a counterpick sent to the team that holds the movie it targets (new)
-- The check is evaluated against POST-trade ownership, not current ownership,
-- so a deal that swaps a movie one way and the counterpick on it the other way
-- is correctly allowed: each ends up on the opposite side from the other.
--
-- Roster-slot and counterpick-slot capacity live in the TypeScript validator
-- (_shared/trade-validation.ts), matching where validateRosterSpace already
-- sits. This function owns ownership and the self-counterpick invariant.
--
-- Adds one column (trade_assets.counterpick_id) and one constraint swap; the
-- rest is function bodies. Safe to run via `migration up`.
-- ============================================================================

-- ============================================================================
-- PART 1: trade_assets can record a transferred counterpick
--
-- Same shape as the existing draft_pick_id/pickup_id columns: nullable, with
-- check_exactly_one_asset widened to count it. Every existing row has exactly
-- one of the old four set, so the new constraint accepts them unchanged.
-- ============================================================================

ALTER TABLE trade_assets
  ADD COLUMN IF NOT EXISTS counterpick_id UUID REFERENCES counterpicks(id) ON DELETE CASCADE;

ALTER TABLE trade_assets DROP CONSTRAINT IF EXISTS check_exactly_one_asset;
ALTER TABLE trade_assets ADD CONSTRAINT check_exactly_one_asset CHECK (
  (
    (movie_id IS NOT NULL)::INTEGER +
    (draft_pick_id IS NOT NULL)::INTEGER +
    (pickup_id IS NOT NULL)::INTEGER +
    (counterpick_id IS NOT NULL)::INTEGER +
    (faab_amount IS NOT NULL)::INTEGER
  ) = 1
);

CREATE INDEX IF NOT EXISTS idx_trade_assets_counterpick_id
  ON trade_assets(counterpick_id)
  WHERE counterpick_id IS NOT NULL;

COMMENT ON COLUMN trade_assets.counterpick_id IS
  'The counterpick transferred by this trade, when the asset is a counterpick rather than a roster holding or budget.';

-- ============================================================================
-- PART 2: settle every counterpick a trade disturbs, in one pass
--
-- BOTH of a counterpick's team columns can move in a single trade, and
-- counterpicks_not_own_movie (counterpicker_team_id != target_team_id) is a
-- plain CHECK -- evaluated per statement, never deferred to commit. Consider
-- the legal swap where A sends movie M to C while C sends the counterpick on M
-- back to A. Afterwards A owns the bet and C holds the movie, which is fine.
-- Getting there one column at a time is not:
--
--   retarget the target first  -> counterpicker C, target C   -> CHECK fails
--   move the counterpicker first -> counterpicker A, target A -> CHECK fails
--
-- There is no ordering that works, so the two columns must be written by the
-- SAME statement -- which is what this function does. It replaces the previous
-- pair of helpers (retarget_counterpicks_for_holding, dropped below): splitting
-- the work by which half moved is exactly the shape that cannot express a swap.
--
-- Three effects, in order:
--   1. counterpicks: both team columns set to their post-trade values at once
--   2. draft_picks/pickups.counterpicked_by_team_id: the denormalized copy the
--      drop rules read (leagues.counterpicks_block_drops) follows the bet, or
--      the wrong team is told it owns the block
--   3. counterpick_bids: still-pending bids display the movie's current holder,
--      so they follow the movie (their own self-target revalidation happens at
--      bid-processing time, not here)
--
-- Called with the trade already settled on the roster side: draft_picks and
-- pickups must already carry their new team_id, because the post-trade holder
-- of a movie NOT named in this trade is read straight off those tables.
--
-- SECURITY INVOKER on purpose, same reasoning as the helper it replaces: inside
-- SECURITY DEFINER execute_trade it runs unrestricted, and EXECUTE is revoked
-- from client roles below.
-- ============================================================================

CREATE OR REPLACE FUNCTION settle_counterpicks_for_trade(
  p_initiator_items JSONB,
  p_recipient_items JSONB,
  p_initiator_team_id UUID,
  p_recipient_team_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_done INTEGER;
BEGIN
  -- All five updates live in one statement, sharing one `moves` definition and
  -- one snapshot. Data-modifying CTEs always run to completion whether or not
  -- the primary query reads their output, so `SELECT 1` at the end is the whole
  -- result -- there is nothing to collect.
  WITH moves AS (
    SELECT (m.value->>'source') AS source,
           (m.value->>'source_id')::UUID AS source_id,
           p_recipient_team_id AS destination_team_id
    FROM jsonb_array_elements(COALESCE(p_initiator_items->'movies', '[]'::jsonb)) m
    UNION ALL
    SELECT (m.value->>'source'),
           (m.value->>'source_id')::UUID,
           p_initiator_team_id
    FROM jsonb_array_elements(COALESCE(p_recipient_items->'movies', '[]'::jsonb)) m
  ),
  -- Every counterpick this trade disturbs -- the bet moved, the movie under it
  -- moved, or both -- with where each half ends up.
  settled AS (
    SELECT c.id,
           c.draft_pick_id,
           c.pickup_id,
           COALESCE(cm.destination_team_id, c.counterpicker_team_id) AS counterpicker_team_id,
           COALESCE(hm.destination_team_id, c.target_team_id) AS target_team_id,
           (cm.source_id IS NOT NULL) AS counterpick_moved
    FROM counterpicks c
    LEFT JOIN moves cm
      ON cm.source = 'counterpick' AND cm.source_id = c.id
    LEFT JOIN moves hm
      ON hm.source = CASE WHEN c.draft_pick_id IS NOT NULL THEN 'draft_pick' ELSE 'pickup' END
     AND hm.source_id = COALESCE(c.draft_pick_id, c.pickup_id)
    WHERE cm.source_id IS NOT NULL OR hm.source_id IS NOT NULL
  ),
  -- 1. Both team columns at once -- the whole reason this function exists.
  --    Rows whose values do not actually change keep their updated_at.
  moved_counterpicks AS (
    UPDATE counterpicks c
    SET counterpicker_team_id = s.counterpicker_team_id,
        target_team_id = s.target_team_id,
        updated_at = now()
    FROM settled s
    WHERE c.id = s.id
      AND (c.counterpicker_team_id IS DISTINCT FROM s.counterpicker_team_id
        OR c.target_team_id IS DISTINCT FROM s.target_team_id)
    RETURNING c.id
  ),
  -- 2. The denormalized copy follows the bet. Read off `settled` rather than
  --    counterpicks, which under this statement's snapshot still holds the
  --    pre-trade values.
  synced_draft_picks AS (
    UPDATE draft_picks dp
    SET counterpicked_by_team_id = s.counterpicker_team_id
    FROM settled s
    WHERE s.counterpick_moved
      AND dp.id = s.draft_pick_id
      AND dp.counterpicked_by_team_id IS DISTINCT FROM s.counterpicker_team_id
    RETURNING dp.id
  ),
  synced_pickups AS (
    UPDATE pickups pk
    SET counterpicked_by_team_id = s.counterpicker_team_id
    FROM settled s
    WHERE s.counterpick_moved
      AND pk.id = s.pickup_id
      AND pk.counterpicked_by_team_id IS DISTINCT FROM s.counterpicker_team_id
    RETURNING pk.id
  ),
  -- 3. Pending bids display the movie's current holder, so they follow it.
  --    Two statements over one table, but never the same row: a bid carries a
  --    draft_pick_id or a pickup_id, never both.
  retargeted_draft_pick_bids AS (
    UPDATE counterpick_bids b
    SET target_team_id = m.destination_team_id
    FROM moves m
    WHERE m.source = 'draft_pick'
      AND b.draft_pick_id = m.source_id
      AND b.status IN ('active', 'outbid')
    RETURNING b.id
  ),
  retargeted_pickup_bids AS (
    UPDATE counterpick_bids b
    SET target_team_id = m.destination_team_id
    FROM moves m
    WHERE m.source = 'pickup'
      AND b.pickup_id = m.source_id
      AND b.status IN ('active', 'outbid')
    RETURNING b.id
  )
  SELECT 1 INTO v_done;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION settle_counterpicks_for_trade(JSONB, JSONB, UUID, UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION settle_counterpicks_for_trade(JSONB, JSONB, UUID, UUID) IS
  'Points every counterpick a trade disturbs at its post-trade owner and holder in a single UPDATE (both columns at once, because counterpicks_not_own_movie is a non-deferred CHECK and a movie/counterpick swap has no valid one-column-at-a-time ordering), then syncs the denormalized counterpicked_by_team_id and any pending counterpick_bids. Call after the roster transfers. Not callable by client roles.';

-- retarget_counterpicks_for_holding (20260808160000) is superseded: it moved
-- only target_team_id, which cannot express a trade where the bet moves too.
-- execute_trade below was its only caller, and it was already revoked from
-- every client role, so nothing else can be relying on it.
DROP FUNCTION IF EXISTS retarget_counterpicks_for_holding(TEXT, UUID, UUID);

-- ============================================================================
-- PART 3: validate_trade_items -- accept and verify counterpick items
--
-- Based verbatim on the latest prior definition
-- (20260816120000_rename_faab_in_trade_validation.sql). Only the new
-- 'counterpick' branch is added; the budget checks and the draft_pick/pickup
-- branches are unchanged, including their wording, which is deliberately
-- identical to the TypeScript validator (see CLAUDE.md -- this function's
-- messages reach the commissioner through approve-trade).
--
-- Ownership of a counterpick is counterpicker_team_id, nothing else. There is
-- no dropped_at to check: a counterpick has no lifecycle of its own and
-- deliberately survives a drop of the movie it targets (see
-- recalculate_team_score_with_counterpicks). A row that still exists is still
-- worth points, so it is still tradeable.
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
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      -- Verify draft pick ownership
      IF NOT EXISTS (
        SELECT 1 FROM draft_picks
        WHERE id = (v_movie.value->>'source_id')::UUID
          AND team_id = p_team_id
          AND dropped_at IS NULL
      ) THEN
        RETURN 'Draft pick not owned or already dropped: ' || (v_movie.value->>'source_id');
      END IF;
    ELSIF (v_movie.value->>'source') = 'pickup' THEN
      -- Verify pickup ownership
      IF NOT EXISTS (
        SELECT 1 FROM pickups
        WHERE id = (v_movie.value->>'source_id')::UUID
          AND team_id = p_team_id
          AND dropped_at IS NULL
      ) THEN
        RETURN 'Pickup not owned or already dropped: ' || (v_movie.value->>'source_id');
      END IF;
    ELSIF (v_movie.value->>'source') = 'counterpick' THEN
      -- Verify counterpick ownership. This is the late-bound guard for
      -- competing offers that both name the same counterpick: the first to
      -- execute moves counterpicker_team_id, and the second fails here.
      IF NOT EXISTS (
        SELECT 1 FROM counterpicks
        WHERE id = (v_movie.value->>'source_id')::UUID
          AND counterpicker_team_id = p_team_id
      ) THEN
        RETURN 'Counterpick not owned: ' || (v_movie.value->>'source_id');
      END IF;
    ELSE
      RETURN 'Invalid movie source: ' || COALESCE(v_movie.value->>'source', 'null');
    END IF;
  END LOOP;

  RETURN NULL; -- Valid
END;
$$;

COMMENT ON FUNCTION validate_trade_items IS
  'Validates trade items -- draft pick, pickup and counterpick ownership plus the fantasy budget against league configuration';

-- ============================================================================
-- PART 4: execute_trade -- transfer counterpicks, and rescore both teams
--
-- Based verbatim on the latest prior definition
-- (20260809120000_allow_competing_trades.sql). Carried over unchanged: the
-- FOR UPDATE re-validation that makes competing offers safe, the roster
-- transfer loops, the trade_assets one-column inserts, the FAAB legs, and the
-- competing-offer expiry. Changed:
--
--   a) the counterpick self-target guard now reasons about POST-trade
--      ownership and covers counterpick items as well as movie items
--   b) counterpick items are recorded in trade_assets, and the four inline
--      retarget_counterpicks_for_holding() calls are replaced by a single
--      settle_counterpicks_for_trade() after every holding has moved
--   c) both teams are rescored at the end
--
-- On (c): nothing rescored teams after a trade before this. That was already
-- wrong for movies (draft_points/pickup_points moved without team_scores
-- following until the next update-scores run), and it is unmissable for
-- counterpicks, whose whole value is the points they carry. Rescoring here
-- makes the trade atomic with its own consequences.
-- ============================================================================

CREATE OR REPLACE FUNCTION execute_trade(p_trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
  v_movie RECORD;
  v_initiator_faab INTEGER;
  v_recipient_faab INTEGER;
  v_error TEXT;
  v_assets JSONB := '[]'::jsonb;
  v_traded_source_ids UUID[];
  v_invalidated JSONB := '[]'::jsonb;
  v_conflict_kind TEXT;
  v_conflict_id UUID;
BEGIN
  -- Lock and fetch the trade
  SELECT * INTO v_trade
  FROM trade_offers
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Trade not found');
  END IF;

  IF v_trade.status NOT IN ('accepted', 'review') THEN
    RETURN jsonb_build_object('error', 'Trade not in executable state');
  END IF;

  -- Re-validate initiator items
  v_error := validate_trade_items(v_trade.initiator_team_id, v_trade.initiator_items);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Initiator validation failed: ' || v_error);
  END IF;

  -- Re-validate recipient items
  v_error := validate_trade_items(v_trade.recipient_team_id, v_trade.recipient_items);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Recipient validation failed: ' || v_error);
  END IF;

  -- This pair of re-validations is what makes competing offers safe. Now that
  -- several open offers may name the same holding, this is the ONLY thing
  -- standing between them and a double-transfer -- the trigger that used to
  -- forbid the overlap up front is gone (see 20260809120000). Both run while
  -- the trade row is held under FOR UPDATE, and validate_trade_items() checks
  -- live draft_picks/pickups/counterpicks ownership, so whichever competing
  -- trade reaches this point second sees the asset already gone and returns an
  -- error instead of transferring it again. Do not weaken these checks.

  -- Guard: no team may end this trade holding both a movie and the counterpick
  -- against it -- counterpicks_not_own_movie forbids
  -- counterpicker_team_id = target_team_id at the DB layer, and betting against
  -- your own holding is not a coherent bet anyway.
  --
  -- Evaluated against POST-trade ownership: for every counterpick that this
  -- trade could disturb (either the bet moves, or the movie under it moves),
  -- work out who will own the bet and who will hold the movie once the trade
  -- settles, and reject if they are the same team. Reasoning post-trade is what
  -- lets a swap -- movie one way, the counterpick on it the other -- through,
  -- while a current-ownership check would wrongly refuse it.
  --
  -- Checked in one statement before any row is mutated, so a rejection here
  -- leaves the trade completely untouched (same early-return pattern as the
  -- re-validation above). This is the authoritative gate -- the TS-side check
  -- in _shared/trade-validation.ts is a UX-earlier mirror of the same rule, not
  -- a substitute for it.
  WITH moves AS (
    SELECT (m.value->>'source') AS source,
           (m.value->>'source_id')::UUID AS source_id,
           v_trade.recipient_team_id AS destination_team_id
    FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb)) m
    UNION ALL
    SELECT (m.value->>'source'),
           (m.value->>'source_id')::UUID,
           v_trade.initiator_team_id
    FROM jsonb_array_elements(COALESCE(v_trade.recipient_items->'movies', '[]'::jsonb)) m
  ),
  holding_moves AS (
    SELECT source, source_id, destination_team_id FROM moves
    WHERE source IN ('draft_pick', 'pickup')
  ),
  counterpick_moves AS (
    SELECT source_id AS counterpick_id, destination_team_id FROM moves
    WHERE source = 'counterpick'
  ),
  -- Every counterpick this trade disturbs, with where its two halves live now.
  disturbed AS (
    SELECT c.id AS counterpick_id,
           c.counterpicker_team_id,
           CASE WHEN c.draft_pick_id IS NOT NULL THEN 'draft_pick' ELSE 'pickup' END AS holding_source,
           COALESCE(c.draft_pick_id, c.pickup_id) AS holding_id,
           COALESCE(dp.team_id, pk.team_id) AS holder_team_id
    FROM counterpicks c
    LEFT JOIN draft_picks dp ON dp.id = c.draft_pick_id
    LEFT JOIN pickups pk ON pk.id = c.pickup_id
    WHERE c.id IN (SELECT counterpick_id FROM counterpick_moves)
       OR c.draft_pick_id IN (SELECT source_id FROM holding_moves WHERE source = 'draft_pick')
       OR c.pickup_id IN (SELECT source_id FROM holding_moves WHERE source = 'pickup')
  )
  SELECT CASE WHEN cm.counterpick_id IS NOT NULL THEN 'counterpick_to_holder'
              ELSE 'movie_to_counterpicker' END,
         COALESCE(cm.counterpick_id, d.holding_id)
  INTO v_conflict_kind, v_conflict_id
  FROM disturbed d
  LEFT JOIN counterpick_moves cm ON cm.counterpick_id = d.counterpick_id
  LEFT JOIN holding_moves hm ON hm.source_id = d.holding_id AND hm.source = d.holding_source
  WHERE COALESCE(cm.destination_team_id, d.counterpicker_team_id)
      = COALESCE(hm.destination_team_id, d.holder_team_id)
  LIMIT 1;

  IF v_conflict_kind = 'counterpick_to_holder' THEN
    RETURN jsonb_build_object(
      'error',
      'Cannot trade a counterpick to the team that holds the counterpicked movie: ' || v_conflict_id
    );
  ELSIF v_conflict_kind = 'movie_to_counterpicker' THEN
    -- Wording preserved from 20260808160000: respond-trade surfaces this
    -- string to the accepting team and its test asserts on it.
    RETURN jsonb_build_object(
      'error',
      'Cannot trade a counterpicked movie to the team that counterpicked it: ' || v_conflict_id
    );
  END IF;

  -- ==========================================================================
  -- ORDERING: the loops below move roster holdings and record every transfer,
  -- but touch no counterpick row. settle_counterpicks_for_trade() does all of
  -- that afterwards, in one statement.
  --
  -- This is not a style choice. counterpicks_not_own_movie is a plain CHECK,
  -- evaluated per statement, so counterpicker_team_id and target_team_id may
  -- never be equal even momentarily -- and in a movie-for-its-own-counterpick
  -- swap, BOTH have to change. Writing them one at a time aborts the trade in
  -- either order (see the comment on settle_counterpicks_for_trade), so the
  -- counterpick side cannot be interleaved with these loops at all.
  -- ==========================================================================

  -- Transfer initiator's movies to recipient
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      -- draft_picks has no updated_at column -- see the BUGFIX note in
      -- 20260809120000 for why this UPDATE deliberately does not set one.
      UPDATE draft_picks
      SET team_id = v_trade.recipient_team_id
      WHERE id = (v_movie.value->>'source_id')::UUID;

      -- Only insert draft_pick_id, NOT movie_id (constraint requires exactly one)
      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, draft_pick_id)
      VALUES (
        p_trade_id,
        v_trade.initiator_team_id,
        v_trade.recipient_team_id,
        (v_movie.value->>'source_id')::UUID
      );
    ELSIF (v_movie.value->>'source') = 'pickup' THEN
      UPDATE pickups
      SET team_id = v_trade.recipient_team_id
      WHERE id = (v_movie.value->>'source_id')::UUID;

      -- Only insert pickup_id, NOT movie_id (constraint requires exactly one)
      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, pickup_id)
      VALUES (
        p_trade_id,
        v_trade.initiator_team_id,
        v_trade.recipient_team_id,
        (v_movie.value->>'source_id')::UUID
      );
    END IF;
    -- 'counterpick' items are deliberately skipped here; see the pass below.
  END LOOP;

  -- Transfer recipient's movies to initiator
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.recipient_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      UPDATE draft_picks
      SET team_id = v_trade.initiator_team_id
      WHERE id = (v_movie.value->>'source_id')::UUID;

      -- Only insert draft_pick_id, NOT movie_id (constraint requires exactly one)
      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, draft_pick_id)
      VALUES (
        p_trade_id,
        v_trade.recipient_team_id,
        v_trade.initiator_team_id,
        (v_movie.value->>'source_id')::UUID
      );
    ELSIF (v_movie.value->>'source') = 'pickup' THEN
      UPDATE pickups
      SET team_id = v_trade.initiator_team_id
      WHERE id = (v_movie.value->>'source_id')::UUID;

      -- Only insert pickup_id, NOT movie_id (constraint requires exactly one)
      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, pickup_id)
      VALUES (
        p_trade_id,
        v_trade.recipient_team_id,
        v_trade.initiator_team_id,
        (v_movie.value->>'source_id')::UUID
      );
    END IF;
    -- 'counterpick' items are deliberately skipped here; see the pass below.
  END LOOP;

  -- Record the counterpick transfers. One loop rather than two because the
  -- direction is already carried on each row -- the movie loops above only need
  -- two because they also differ in which table's team_id they set.
  FOR v_movie IN
    SELECT (m.value->>'source_id')::UUID AS counterpick_id,
           v_trade.initiator_team_id AS from_team_id,
           v_trade.recipient_team_id AS to_team_id
    FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb)) m
    WHERE m.value->>'source' = 'counterpick'
    UNION ALL
    SELECT (m.value->>'source_id')::UUID,
           v_trade.recipient_team_id,
           v_trade.initiator_team_id
    FROM jsonb_array_elements(COALESCE(v_trade.recipient_items->'movies', '[]'::jsonb)) m
    WHERE m.value->>'source' = 'counterpick'
  LOOP
    -- Only insert counterpick_id (constraint requires exactly one)
    INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, counterpick_id)
    VALUES (p_trade_id, v_movie.from_team_id, v_movie.to_team_id, v_movie.counterpick_id);
  END LOOP;

  -- Now that every holding carries its new team_id, point each disturbed
  -- counterpick at its post-trade owner AND holder in one statement.
  PERFORM settle_counterpicks_for_trade(
    v_trade.initiator_items,
    v_trade.recipient_items,
    v_trade.initiator_team_id,
    v_trade.recipient_team_id
  );

  -- Transfer FAAB
  v_initiator_faab := COALESCE((v_trade.initiator_items->>'faab')::INTEGER, 0);
  v_recipient_faab := COALESCE((v_trade.recipient_items->>'faab')::INTEGER, 0);

  IF v_initiator_faab > 0 THEN
    -- Initiator gives FAAB to recipient
    UPDATE team_budgets
    SET remaining_budget = remaining_budget - v_initiator_faab,
        total_spent = total_spent + v_initiator_faab,
        updated_at = now()
    WHERE team_id = v_trade.initiator_team_id;

    UPDATE team_budgets
    SET remaining_budget = remaining_budget + v_initiator_faab,
        updated_at = now()
    WHERE team_id = v_trade.recipient_team_id;

    INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, faab_amount)
    VALUES (p_trade_id, v_trade.initiator_team_id, v_trade.recipient_team_id, v_initiator_faab);
  END IF;

  IF v_recipient_faab > 0 THEN
    -- Recipient gives FAAB to initiator
    UPDATE team_budgets
    SET remaining_budget = remaining_budget - v_recipient_faab,
        total_spent = total_spent + v_recipient_faab,
        updated_at = now()
    WHERE team_id = v_trade.recipient_team_id;

    UPDATE team_budgets
    SET remaining_budget = remaining_budget + v_recipient_faab,
        updated_at = now()
    WHERE team_id = v_trade.initiator_team_id;

    INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, faab_amount)
    VALUES (p_trade_id, v_trade.recipient_team_id, v_trade.initiator_team_id, v_recipient_faab);
  END IF;

  -- Mark trade as completed
  UPDATE trade_offers
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = p_trade_id;

  -- ==========================================================================
  -- Expire competing offers that named an asset we just moved
  --
  -- Without this, a losing offer would sit in the recipient's queue looking
  -- actionable until they tried to accept it (respond-trade re-validates and
  -- rejects) or until process-trades next swept it. Expiring here closes that
  -- window and gives us the rows needed to tell both parties why.
  --
  -- source_ids are compared without regard to source, which is what lets a
  -- traded counterpick invalidate competing offers for free: counterpicks.id,
  -- draft_picks.id and pickups.id are all UUIDs from distinct tables, so a
  -- collision across sources is not a practical concern.
  --
  -- Only ASSET overlap invalidates. An offer that merely shares a team or
  -- spends from the same FAAB budget stays open: budget sufficiency is
  -- re-checked at its own execution time by validate_trade_items(), so an offer
  -- that is still affordable remains perfectly valid.
  --
  -- Deadlock note: this UPDATE touches other trade_offers rows while we hold
  -- FOR UPDATE on p_trade_id. Two overlapping executions of mutually competing
  -- trades can therefore deadlock, and Postgres will abort one of them. That is
  -- a SAFE outcome here -- the aborted trade rolls back untouched and is retried
  -- on the next process-trades run, by which point it fails re-validation and is
  -- expired normally. In practice process-trades executes sequentially within a
  -- single invocation, so this needs overlapping cron runs to occur at all.
  -- ==========================================================================
  SELECT ARRAY_AGG(DISTINCT (m.value->>'source_id')::UUID)
  INTO v_traded_source_ids
  FROM (
    SELECT value FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb))
    UNION ALL
    SELECT value FROM jsonb_array_elements(COALESCE(v_trade.recipient_items->'movies', '[]'::jsonb))
  ) AS m;

  IF v_traded_source_ids IS NOT NULL AND array_length(v_traded_source_ids, 1) > 0 THEN
    WITH competing AS (
      SELECT DISTINCT t.id
      FROM trade_offers t
      CROSS JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(COALESCE(t.initiator_items->'movies', '[]'::jsonb))
        UNION ALL
        SELECT value FROM jsonb_array_elements(COALESCE(t.recipient_items->'movies', '[]'::jsonb))
      ) AS m
      WHERE t.league_id = v_trade.league_id
        AND t.id <> p_trade_id
        AND t.status IN ('proposed', 'countered', 'review', 'accepted')
        AND (m.value->>'source_id')::UUID = ANY (v_traded_source_ids)
    ),
    expired AS (
      UPDATE trade_offers
      SET status = 'expired'::trade_status,
          veto_reason = 'A movie in this trade was traded in another deal',
          updated_at = now()
      WHERE id IN (SELECT id FROM competing)
      RETURNING id, league_id, initiator_team_id, recipient_team_id
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(expired)), '[]'::jsonb)
    INTO v_invalidated
    FROM expired;
  END IF;

  -- Rescore both sides. Movies and counterpicks have moved between them, and
  -- team_scores is a materialized total -- without this it keeps last night's
  -- answer until the next update-scores run. Idempotent upsert, two rows.
  PERFORM recalculate_team_score_with_counterpicks(v_trade.initiator_team_id);
  PERFORM recalculate_team_score_with_counterpicks(v_trade.recipient_team_id);

  -- Get trade assets for response
  SELECT jsonb_agg(row_to_json(ta))
  INTO v_assets
  FROM trade_assets ta
  WHERE ta.trade_offer_id = p_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'assets', v_assets,
    -- Consumed by process-trades to notify the losing parties. Always present
    -- (empty array when nothing competed) so callers need no null handling.
    'invalidated_trades', v_invalidated
  );
END;
$$;

COMMENT ON FUNCTION execute_trade(UUID) IS
  'Execute a trade transaction atomically -- draft picks, pickups, counterpicks and budget. Re-validates ownership under FOR UPDATE (the sole guard against two competing offers both transferring the same asset, now that offers may overlap). Rejects any deal that would leave one team holding both a movie and the counterpick against it, judged on post-trade ownership. Retargets counterpicks.target_team_id when a movie moves, moves counterpicker_team_id (and its denormalized copy) when a counterpick moves, rescores both teams, and expires any other open offer naming an asset it moved. Does not violate check_exactly_one_asset (fixed 20260130).';

-- ============================================================================
-- PART 5: documentation touch-ups
-- ============================================================================

COMMENT ON COLUMN counterpicks.counterpicker_team_id IS
  'Team that currently owns this counterpick (betting against the target movie). Set at award time to the team that made it; moved by execute_trade() when the counterpick itself is traded. Kept in step with draft_picks/pickups.counterpicked_by_team_id.';

COMMENT ON FUNCTION get_contested_source_ids(UUID) IS
  'Assets (draft_pick/pickup/counterpick source_ids) named by more than one open trade offer in the league, with the number of offers naming each. Counts only -- never exposes which teams or offers are involved, so it cannot be used to bypass trade_offers RLS.';
