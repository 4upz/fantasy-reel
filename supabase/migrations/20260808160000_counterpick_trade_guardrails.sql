-- ============================================================================
-- Counterpick × Trade Guardrails
--
-- Trades move draft_picks/pickups between teams by UPDATEing team_id in place
-- (execute_trade, see 20260130_fix_trade_assets_constraint.sql). Counterpicks
-- were introduced afterward (20260203_counterpick_system.sql) and execute_trade
-- was never taught about them, which left two gaps:
--
-- 1. A counterpicked movie could be traded straight to the team that
--    counterpicked it. That collapses counterpicker_team_id == target_team_id,
--    which counterpicks_not_own_movie forbids at the DB layer and which makes
--    no sense as a bet: a team can't bet against its own holding.
--
-- 2. counterpicks.target_team_id (and the display copy on pending
--    counterpick_bids) was never updated when the underlying draft_pick/pickup
--    changed hands, so after a trade the counterpick would keep pointing at
--    the movie's PREVIOUS owner instead of its current one.
--
-- Policy this migration encodes (agreed):
--   - A counterpicked movie MAY be traded -- the counterpick is a bet on the
--     movie, not a claim on whoever happens to hold it -- EXCEPT to the team
--     that placed the counterpick.
--   - When a counterpicked holding transfers, counterpicks.target_team_id (and
--     any pending counterpick_bids' display target_team_id) is retargeted to
--     the new holder so history/UI stay truthful.
--   - Counterpicks deliberately survive drops and keep scoring the inverted
--     points against the original counterpicker -- see the refreshed comment
--     on recalculate_team_score_with_counterpicks below. This is NOT an
--     oversight; matches Fantasy Critic's ruleset.
--
-- No schema changes here, only function/comment updates. Safe to run via
-- `migration up`.
-- ============================================================================

-- ============================================================================
-- PART 1: execute_trade -- add the self-counterpick guard and retargeting
--
-- Based on the LATEST prior definition, from 20260130_fix_trade_assets_constraint.sql
-- (validate_trade_items was redefined again in 20260133_trading_faab_config.sql,
-- but execute_trade itself was untouched after 20260130 -- that fix, which
-- inserts only draft_pick_id/pickup_id and never movie_id on trade_assets, is
-- preserved verbatim below).
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
  v_counterpicked_by UUID;
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

  -- Guard: a counterpicked movie may change hands freely EXCEPT to the team
  -- that counterpicked it -- that would make the counterpicker its own target,
  -- which counterpicks_not_own_movie forbids and which is not a coherent bet
  -- anyway. Checked up front for BOTH sides before any row is mutated, so a
  -- rejection here leaves the trade completely untouched (same early-return
  -- pattern as the re-validation above). This is the authoritative gate --
  -- the TS-side check in _shared/trade-validation.ts is a UX-earlier mirror
  -- of the same rule, not a substitute for it.
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      SELECT counterpicked_by_team_id INTO v_counterpicked_by
      FROM draft_picks WHERE id = (v_movie.value->>'source_id')::UUID;
    ELSE
      SELECT counterpicked_by_team_id INTO v_counterpicked_by
      FROM pickups WHERE id = (v_movie.value->>'source_id')::UUID;
    END IF;

    IF v_counterpicked_by IS NOT NULL AND v_counterpicked_by = v_trade.recipient_team_id THEN
      RETURN jsonb_build_object('error', 'Cannot trade a counterpicked movie to the team that counterpicked it');
    END IF;
  END LOOP;

  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.recipient_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      SELECT counterpicked_by_team_id INTO v_counterpicked_by
      FROM draft_picks WHERE id = (v_movie.value->>'source_id')::UUID;
    ELSE
      SELECT counterpicked_by_team_id INTO v_counterpicked_by
      FROM pickups WHERE id = (v_movie.value->>'source_id')::UUID;
    END IF;

    IF v_counterpicked_by IS NOT NULL AND v_counterpicked_by = v_trade.initiator_team_id THEN
      RETURN jsonb_build_object('error', 'Cannot trade a counterpicked movie to the team that counterpicked it');
    END IF;
  END LOOP;

  -- Transfer initiator's movies to recipient
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      UPDATE draft_picks
      SET team_id = v_trade.recipient_team_id, updated_at = now()
      WHERE id = (v_movie.value->>'source_id')::UUID;

      -- counterpicks.target_team_id tracks the CURRENT holder (see column
      -- comment below); retarget it so scoring/display stay truthful. Also
      -- retarget the display copy on any still-pending counterpick bids for
      -- this same reason -- their own self-target revalidation happens at
      -- bid-processing time, not here.
      UPDATE counterpicks
      SET target_team_id = v_trade.recipient_team_id, updated_at = now()
      WHERE draft_pick_id = (v_movie.value->>'source_id')::UUID;

      UPDATE counterpick_bids
      SET target_team_id = v_trade.recipient_team_id
      WHERE draft_pick_id = (v_movie.value->>'source_id')::UUID
        AND status IN ('active', 'outbid');

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

      UPDATE counterpicks
      SET target_team_id = v_trade.recipient_team_id, updated_at = now()
      WHERE pickup_id = (v_movie.value->>'source_id')::UUID;

      UPDATE counterpick_bids
      SET target_team_id = v_trade.recipient_team_id
      WHERE pickup_id = (v_movie.value->>'source_id')::UUID
        AND status IN ('active', 'outbid');

      -- Only insert pickup_id, NOT movie_id (constraint requires exactly one)
      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, pickup_id)
      VALUES (
        p_trade_id,
        v_trade.initiator_team_id,
        v_trade.recipient_team_id,
        (v_movie.value->>'source_id')::UUID
      );
    END IF;
  END LOOP;

  -- Transfer recipient's movies to initiator
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.recipient_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      UPDATE draft_picks
      SET team_id = v_trade.initiator_team_id, updated_at = now()
      WHERE id = (v_movie.value->>'source_id')::UUID;

      UPDATE counterpicks
      SET target_team_id = v_trade.initiator_team_id, updated_at = now()
      WHERE draft_pick_id = (v_movie.value->>'source_id')::UUID;

      UPDATE counterpick_bids
      SET target_team_id = v_trade.initiator_team_id
      WHERE draft_pick_id = (v_movie.value->>'source_id')::UUID
        AND status IN ('active', 'outbid');

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

      UPDATE counterpicks
      SET target_team_id = v_trade.initiator_team_id, updated_at = now()
      WHERE pickup_id = (v_movie.value->>'source_id')::UUID;

      UPDATE counterpick_bids
      SET target_team_id = v_trade.initiator_team_id
      WHERE pickup_id = (v_movie.value->>'source_id')::UUID
        AND status IN ('active', 'outbid');

      -- Only insert pickup_id, NOT movie_id (constraint requires exactly one)
      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, pickup_id)
      VALUES (
        p_trade_id,
        v_trade.recipient_team_id,
        v_trade.initiator_team_id,
        (v_movie.value->>'source_id')::UUID
      );
    END IF;
  END LOOP;

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

  -- Get trade assets for response
  SELECT jsonb_agg(row_to_json(ta))
  INTO v_assets
  FROM trade_assets ta
  WHERE ta.trade_offer_id = p_trade_id;

  RETURN jsonb_build_object('success', true, 'assets', v_assets);
END;
$$;

COMMENT ON FUNCTION execute_trade(UUID) IS
  'Execute a trade transaction atomically. Rejects trading a counterpicked movie to the team that counterpicked it, and retargets counterpicks.target_team_id (plus pending counterpick_bids display rows) to the new holder on every draft_pick/pickup transfer. Does not violate check_exactly_one_asset (fixed 20260130).';

-- ============================================================================
-- PART 2: Document that target_team_id tracks the CURRENT holder
-- ============================================================================

COMMENT ON COLUMN counterpicks.target_team_id IS
  'Team currently holding the counterpicked movie. Set at award time to the original owner; retargeted by execute_trade() whenever the underlying draft_pick/pickup changes hands via trade. Unaffected by drops -- see recalculate_team_score_with_counterpicks() for why the counterpick leg survives them.';

-- ============================================================================
-- PART 3: Document that counterpicks deliberately survive drops
--
-- recalculate_team_score_with_counterpicks() (20260203_counterpick_system.sql)
-- sums counterpick points with no dropped_at filter on the underlying
-- draft_pick/pickup. That reads like a missed filter next to draft_points,
-- which does exclude dropped picks -- it isn't. No function body changes here,
-- comment only.
-- ============================================================================

COMMENT ON FUNCTION recalculate_team_score_with_counterpicks(UUID) IS
  'Recalculates team scores including both draft points and counterpick points (inverted opponent scores). The counterpick leg intentionally has NO dropped_at filter: counterpicks survive drops of the underlying movie (in leagues where that is even possible -- see leagues.counterpicks_block_drops) and keep scoring the inverted points for the counterpicker. This matches Fantasy Critic''s ruleset and is deliberate, not an omission.';
