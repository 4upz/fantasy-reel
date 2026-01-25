-- ============================================================================
-- Trading System Race Condition Fixes
--
-- Addresses the following issues:
-- 1. BE#1 - Same movie in multiple pending trades
-- 2. BE#2 - No row-level locking on trade status updates
-- 3. BE#3 - FAAB budget race condition
-- 4. BE#6 - Missing uniqueness constraint for active trades
-- ============================================================================

-- ============================================================================
-- PART 1: Partial Unique Index for Active Trades Between Teams (BE#6)
-- ============================================================================

-- Prevent two pending trades between the same pair of teams
-- Uses LEAST/GREATEST to handle the direction-agnostic constraint
CREATE UNIQUE INDEX idx_unique_active_trade_between_teams
ON trade_offers (
  LEAST(initiator_team_id, recipient_team_id),
  GREATEST(initiator_team_id, recipient_team_id)
)
WHERE status IN ('proposed', 'countered');

COMMENT ON INDEX idx_unique_active_trade_between_teams IS
  'Prevents multiple pending trades between the same two teams';

-- ============================================================================
-- PART 2: Check Constraint for Non-Negative FAAB Budget (BE#3)
-- ============================================================================

-- Add constraint to team_budgets to ensure remaining_budget never goes negative
ALTER TABLE team_budgets
ADD CONSTRAINT check_remaining_budget_non_negative
CHECK (remaining_budget >= 0);

-- ============================================================================
-- PART 3: Function to Check if Movie is in Pending Trade (BE#1)
-- ============================================================================

-- Helper function to check if a movie (via source_id) is already in a pending trade
-- Returns the trade_offer_id if found, NULL otherwise
CREATE OR REPLACE FUNCTION get_pending_trade_for_movie(
  p_league_id UUID,
  p_source_id UUID,
  p_source_type TEXT,  -- 'draft_pick' or 'pickup'
  p_exclude_trade_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_trade_id UUID;
BEGIN
  -- Check if this movie's source is in any pending trade's items
  SELECT id INTO v_trade_id
  FROM trade_offers
  WHERE league_id = p_league_id
    AND status IN ('proposed', 'countered', 'review', 'accepted')
    AND (p_exclude_trade_id IS NULL OR id != p_exclude_trade_id)
    AND (
      -- Check initiator_items
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(initiator_items->'movies') AS movie
        WHERE (movie->>'source_id')::UUID = p_source_id
          AND movie->>'source' = p_source_type
      )
      OR
      -- Check recipient_items
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(recipient_items->'movies') AS movie
        WHERE (movie->>'source_id')::UUID = p_source_id
          AND movie->>'source' = p_source_type
      )
    )
  LIMIT 1;

  RETURN v_trade_id;
END;
$$;

COMMENT ON FUNCTION get_pending_trade_for_movie IS
  'Returns trade_offer_id if the movie source is already in a pending trade, NULL otherwise';

-- ============================================================================
-- PART 4: Trigger to Validate Movie Availability Before Trade Insert/Update (BE#1)
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_trade_movies_not_in_pending()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movie RECORD;
  v_existing_trade_id UUID;
  v_exclude_id UUID;
BEGIN
  -- Only validate for pending/active statuses
  IF NEW.status NOT IN ('proposed', 'countered', 'review', 'accepted') THEN
    RETURN NEW;
  END IF;

  -- For updates to same trade, exclude self from check
  IF TG_OP = 'UPDATE' THEN
    v_exclude_id := OLD.id;
  ELSE
    v_exclude_id := NULL;
  END IF;

  -- Check all movies in initiator_items
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.initiator_items->'movies', '[]'::jsonb)) LOOP
    v_existing_trade_id := get_pending_trade_for_movie(
      NEW.league_id,
      (v_movie.value->>'source_id')::UUID,
      v_movie.value->>'source',
      v_exclude_id
    );

    IF v_existing_trade_id IS NOT NULL THEN
      RAISE EXCEPTION 'Movie % is already in a pending trade (%)',
        v_movie.value->>'source_id',
        v_existing_trade_id
        USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;

  -- Check all movies in recipient_items
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.recipient_items->'movies', '[]'::jsonb)) LOOP
    v_existing_trade_id := get_pending_trade_for_movie(
      NEW.league_id,
      (v_movie.value->>'source_id')::UUID,
      v_movie.value->>'source',
      v_exclude_id
    );

    IF v_existing_trade_id IS NOT NULL THEN
      RAISE EXCEPTION 'Movie % is already in a pending trade (%)',
        v_movie.value->>'source_id',
        v_existing_trade_id
        USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_trade_movies_trigger
BEFORE INSERT OR UPDATE ON trade_offers
FOR EACH ROW
EXECUTE FUNCTION validate_trade_movies_not_in_pending();

COMMENT ON TRIGGER validate_trade_movies_trigger ON trade_offers IS
  'Prevents the same movie from being included in multiple pending trades';

-- ============================================================================
-- PART 5: Function to Lock Trade for Atomic Updates (BE#2)
-- ============================================================================

-- Get trade offer with row-level lock for atomic operations
CREATE OR REPLACE FUNCTION get_trade_offer_for_update(p_trade_id UUID)
RETURNS trade_offers
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
BEGIN
  SELECT * INTO v_trade
  FROM trade_offers
  WHERE id = p_trade_id
  FOR UPDATE;

  RETURN v_trade;
END;
$$;

COMMENT ON FUNCTION get_trade_offer_for_update IS
  'Fetches and locks a trade offer row for atomic update operations';

-- ============================================================================
-- PART 6: Function to Lock Team Budget for Atomic Updates (BE#3)
-- ============================================================================

-- Get team budget with row-level lock for atomic FAAB operations
CREATE OR REPLACE FUNCTION get_team_budget_for_update(p_team_id UUID)
RETURNS team_budgets
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget team_budgets;
BEGIN
  SELECT * INTO v_budget
  FROM team_budgets
  WHERE team_id = p_team_id
  FOR UPDATE;

  RETURN v_budget;
END;
$$;

COMMENT ON FUNCTION get_team_budget_for_update IS
  'Fetches and locks a team budget row for atomic FAAB operations';

-- ============================================================================
-- PART 7: Function to Atomically Respond to Trade (BE#2, BE#3)
-- ============================================================================

-- Atomic trade response that handles locking and status transitions
CREATE OR REPLACE FUNCTION respond_to_trade(
  p_trade_id UUID,
  p_response TEXT,  -- 'accept' or 'reject'
  p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
  v_league RECORD;
  v_review_ends_at TIMESTAMPTZ;
  v_new_status TEXT;
  v_error TEXT;
BEGIN
  -- Lock and fetch the trade
  v_trade := get_trade_offer_for_update(p_trade_id);

  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Trade not found', 'status_code', 404);
  END IF;

  IF v_trade.status NOT IN ('proposed', 'countered') THEN
    RETURN jsonb_build_object(
      'error', format('Cannot respond to a trade with status "%s"', v_trade.status),
      'status_code', 400
    );
  END IF;

  IF p_response = 'reject' THEN
    UPDATE trade_offers
    SET status = 'rejected'::trade_status,
        responded_at = now(),
        response_message = NULLIF(trim(p_message), '')
    WHERE id = p_trade_id;

    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  -- Accept: re-validate trade items
  v_error := validate_trade_items(v_trade.initiator_team_id, v_trade.initiator_items);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Initiator validation failed: ' || v_error, 'status_code', 400);
  END IF;

  v_error := validate_trade_items(v_trade.recipient_team_id, v_trade.recipient_items);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Recipient validation failed: ' || v_error, 'status_code', 400);
  END IF;

  -- Get league config
  SELECT trade_veto_hours, trade_review_enabled
  INTO v_league
  FROM leagues
  WHERE id = v_trade.league_id;

  IF v_league.trade_review_enabled AND v_league.trade_veto_hours > 0 THEN
    v_new_status := 'review';
    v_review_ends_at := now() + (v_league.trade_veto_hours || ' hours')::INTERVAL;
  ELSE
    v_new_status := 'accepted';
    v_review_ends_at := NULL;
  END IF;

  UPDATE trade_offers
  SET status = v_new_status::trade_status,
      responded_at = now(),
      accepted_at = now(),
      review_ends_at = v_review_ends_at,
      response_message = NULLIF(trim(p_message), '')
  WHERE id = p_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'review_ends_at', v_review_ends_at
  );
END;
$$;

COMMENT ON FUNCTION respond_to_trade IS
  'Atomically responds to a trade with proper row-level locking';

-- ============================================================================
-- PART 8: Function to Atomically Counter a Trade (BE#2)
-- ============================================================================

-- Atomic counter-offer that handles locking
CREATE OR REPLACE FUNCTION counter_trade(
  p_trade_id UUID,
  p_new_initiator_team_id UUID,
  p_new_recipient_team_id UUID,
  p_new_initiator_items JSONB,
  p_new_recipient_items JSONB,
  p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
BEGIN
  -- Lock and fetch the trade
  v_trade := get_trade_offer_for_update(p_trade_id);

  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Trade not found', 'status_code', 404);
  END IF;

  IF v_trade.status NOT IN ('proposed', 'countered') THEN
    RETURN jsonb_build_object(
      'error', format('Cannot counter a trade with status "%s"', v_trade.status),
      'status_code', 400
    );
  END IF;

  -- Update the trade with counter-offer
  -- The trigger validate_trade_movies_trigger will check movie availability
  UPDATE trade_offers
  SET status = 'countered'::trade_status,
      initiator_team_id = p_new_initiator_team_id,
      recipient_team_id = p_new_recipient_team_id,
      initiator_items = p_new_initiator_items,
      recipient_items = p_new_recipient_items,
      responded_at = now(),
      accepted_at = NULL,
      review_ends_at = NULL,
      response_message = NULLIF(trim(p_message), '')
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION counter_trade IS
  'Atomically counters a trade with proper row-level locking';

-- ============================================================================
-- PART 9: Function to Atomically Veto a Trade (BE#2)
-- ============================================================================

CREATE OR REPLACE FUNCTION veto_trade(
  p_trade_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
BEGIN
  -- Lock and fetch the trade
  v_trade := get_trade_offer_for_update(p_trade_id);

  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Trade not found', 'status_code', 404);
  END IF;

  IF v_trade.status != 'review' THEN
    RETURN jsonb_build_object(
      'error', format('Cannot veto a trade with status "%s". Trades can only be vetoed during review.', v_trade.status),
      'status_code', 400
    );
  END IF;

  UPDATE trade_offers
  SET status = 'vetoed'::trade_status,
      veto_reason = NULLIF(trim(p_reason), '')
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION veto_trade IS
  'Atomically vetoes a trade with proper row-level locking';

-- ============================================================================
-- PART 10: Supporting Index for Movie-in-Trade Lookups
-- ============================================================================

-- GIN index on JSONB for faster movie lookups in pending trades
CREATE INDEX idx_trade_offers_movies_gin ON trade_offers
USING GIN (
  (initiator_items->'movies'),
  (recipient_items->'movies')
)
WHERE status IN ('proposed', 'countered', 'review', 'accepted');

COMMENT ON INDEX idx_trade_offers_movies_gin IS
  'Supports fast lookups of movies in pending trades';

-- ============================================================================
-- PART 11: Comments
-- ============================================================================

COMMENT ON CONSTRAINT check_remaining_budget_non_negative ON team_budgets IS
  'Ensures team FAAB budget never goes negative';
