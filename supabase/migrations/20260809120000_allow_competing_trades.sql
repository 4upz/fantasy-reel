-- ============================================================================
-- Allow Competing Trades
--
-- Users reported being unable to propose a trade for a movie that was already
-- named in someone else's pending offer. Two constraints added by
-- 20260132_trading_race_condition_fixes.sql caused that:
--
--   1. validate_trade_movies_trigger -> validate_trade_movies_not_in_pending()
--      A BEFORE INSERT OR UPDATE trigger on trade_offers that raised
--      'Movie % is already in a pending trade' whenever any movie in the new
--      offer appeared in another offer with status proposed/countered/review/
--      accepted.
--
--   2. idx_unique_active_trade_between_teams
--      A partial unique index that allowed only ONE open offer between any
--      given pair of teams, regardless of which movies were involved.
--
-- Both are dropped here. The desired behaviour is the one Fantasy Critic uses
-- (SteveF92/FantasyCritic, Lib/Services/TradeService.cs + Domain/Trades/Trade.cs):
-- any number of offers may name the same movie, and validation is LATE-BOUND --
-- re-checked at execution time, where the first trade to execute wins and the
-- rest fail with "no longer has all of the games involved in this trade".
--
-- That late-bound guarantee ALREADY exists in this codebase and is what makes
-- dropping the trigger safe -- the trigger was redundant belt-and-braces, not
-- the thing enforcing one-execution:
--
--   * execute_trade() takes `FOR UPDATE` on the trade row and re-runs
--     validate_trade_items() for both sides, which verifies the sending team
--     still owns every draft_pick/pickup (and that it is not dropped). Once one
--     trade moves a holding, any competing trade naming it fails that check.
--   * process-trades re-runs the full validateTradeProposal() before calling
--     execute_trade, and marks anything that fails as 'expired' with a reason.
--   * respond-trade re-validates at accept time.
--
-- What this migration ADDS on top, so losing offers die immediately and
-- visibly rather than lingering until someone tries to act on them:
--
--   * execute_trade() now expires every other open offer that names a holding
--     it just transferred, and returns those offers in `invalidated_trades` so
--     the caller (process-trades) can notify both parties.
--   * get_contested_source_ids() reports which holdings appear in more than one
--     open offer, powering the "Contested" badge in the trade UI.
--
-- ALSO FIXED HERE (pre-existing, unrelated to competing trades but blocking):
--   execute_trade() updated draft_picks.updated_at, a column that does not
--   exist and never has. Every trade involving a draft pick has aborted with
--   'column "updated_at" of relation "draft_picks" does not exist' since the
--   trading system shipped in 20260128 -- i.e. no trade has ever completed.
--   Found because the competing-offer expiry below runs at the end of
--   execute_trade and could not be reached. See the inline BUGFIX note.
--
-- No schema changes -- functions, one trigger drop, two index changes only.
-- Safe to run via `migration up`.
-- ============================================================================

-- ============================================================================
-- PART 1: Drop the two blocking constraints
-- ============================================================================

DROP TRIGGER IF EXISTS validate_trade_movies_trigger ON trade_offers;
DROP FUNCTION IF EXISTS validate_trade_movies_not_in_pending();

-- Teams may now have several distinct offers open with each other at once
-- (e.g. an "A package" and a "B package" for the counterparty to choose from).
DROP INDEX IF EXISTS idx_unique_active_trade_between_teams;

-- get_pending_trade_for_movie() existed only to serve the dropped trigger: it
-- returns a single arbitrary competing trade id, which is now both insufficient
-- (we need all of them) and misleading (its name implies a prohibition that no
-- longer exists). Superseded by get_contested_source_ids() below.
DROP FUNCTION IF EXISTS get_pending_trade_for_movie(UUID, UUID, TEXT, UUID);

-- ============================================================================
-- PART 2: Contested-holding lookup (drives the "Contested" UI badge)
--
-- Returns one row per holding that appears in MORE THAN ONE open offer in the
-- league, with how many offers name it. Deliberately returns only counts, never
-- which teams or which offers: trade_offers RLS restricts offer contents to the
-- two participants plus the league owner, and this function must not become a
-- way around that.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_contested_source_ids(p_league_id UUID)
RETURNS TABLE (source_id UUID, source TEXT, trade_count BIGINT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  WITH claimed AS (
    SELECT t.id AS trade_id,
           (m.value->>'source_id')::UUID AS source_id,
           m.value->>'source' AS source
    FROM trade_offers t
    CROSS JOIN LATERAL (
      SELECT value FROM jsonb_array_elements(COALESCE(t.initiator_items->'movies', '[]'::jsonb))
      UNION ALL
      SELECT value FROM jsonb_array_elements(COALESCE(t.recipient_items->'movies', '[]'::jsonb))
    ) AS m
    WHERE t.league_id = p_league_id
      -- "Open" = still holding a claim on its movies. This literal list is
      -- repeated in execute_trade and in the partial indexes at the bottom
      -- rather than factored into a helper function on purpose: a function call
      -- here would stop the planner proving the partial-index predicate and the
      -- indexes would go unused. Change all four together.
      AND t.status IN ('proposed', 'countered', 'review', 'accepted')
  )
  SELECT claimed.source_id,
         claimed.source,
         COUNT(DISTINCT claimed.trade_id) AS trade_count
  FROM claimed
  GROUP BY claimed.source_id, claimed.source
  HAVING COUNT(DISTINCT claimed.trade_id) > 1
$$;

COMMENT ON FUNCTION get_contested_source_ids(UUID) IS
  'Holdings (draft_pick/pickup source_ids) named by more than one open trade offer in the league, with the number of offers naming each. Counts only -- never exposes which teams or offers are involved, so it cannot be used to bypass trade_offers RLS.';

-- Callable by league members through get-trades (which runs service-role) and
-- safe for authenticated users directly, since it leaks only counts. Still
-- revoked from PUBLIC/anon per the project convention that a bare GRANT to
-- service_role restricts nothing (see 20260805200000).
REVOKE EXECUTE ON FUNCTION get_contested_source_ids(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_contested_source_ids(UUID) TO authenticated, service_role;

-- ============================================================================
-- PART 3: execute_trade -- expire competing offers on success
--
-- Based verbatim on the latest prior definition
-- (20260808160000_counterpick_trade_guardrails.sql), which itself preserved the
-- 20260130 trade_assets fix. The counterpick self-trade guard and the
-- retarget_counterpicks_for_holding() calls are carried over unchanged; the
-- only additions are the two marked blocks at the end.
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
  -- forbid the overlap up front is gone (see PART 1). Both run while the trade
  -- row is held under FOR UPDATE, and validate_trade_items() checks live
  -- draft_picks/pickups ownership, so whichever competing trade reaches this
  -- point second sees the holding already gone and returns an error instead of
  -- transferring it again. Do not weaken these checks.

  -- Guard: a counterpicked movie may change hands freely EXCEPT to the team
  -- that counterpicked it -- that would make the counterpicker its own target,
  -- which counterpicks_not_own_movie forbids and which is not a coherent bet
  -- anyway. Checked up front for BOTH sides in one batched statement before
  -- any row is mutated, so a rejection here leaves the trade completely
  -- untouched (same early-return pattern as the re-validation above). This is
  -- the authoritative gate -- the TS-side check in _shared/trade-validation.ts
  -- is a UX-earlier mirror of the same rule, not a substitute for it.
  IF EXISTS (
    WITH traded AS (
      SELECT (m.value->>'source') AS source,
             (m.value->>'source_id')::UUID AS source_id,
             v_trade.recipient_team_id AS destination_team_id
      FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb)) m
      UNION ALL
      SELECT (m.value->>'source'),
             (m.value->>'source_id')::UUID,
             v_trade.initiator_team_id
      FROM jsonb_array_elements(COALESCE(v_trade.recipient_items->'movies', '[]'::jsonb)) m
    )
    SELECT 1
    FROM traded
    LEFT JOIN draft_picks dp ON traded.source = 'draft_pick' AND dp.id = traded.source_id
    LEFT JOIN pickups pk ON traded.source = 'pickup' AND pk.id = traded.source_id
    WHERE COALESCE(dp.counterpicked_by_team_id, pk.counterpicked_by_team_id) = traded.destination_team_id
  ) THEN
    RETURN jsonb_build_object('error', 'Cannot trade a counterpicked movie to the team that counterpicked it');
  END IF;

  -- Transfer initiator's movies to recipient
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      -- BUGFIX: this statement previously also set `updated_at = now()`, but
      -- draft_picks has no such column and never has -- the only updated_at
      -- ever added by a migration is on trade_offers (20260128) and movies
      -- (20260115, as scores_updated_at). Every execute_trade() involving a
      -- draft pick therefore aborted with
      --   column "updated_at" of relation "draft_picks" does not exist
      -- meaning NO trade has ever completed since the trading system shipped in
      -- 20260128. The bad reference was copied forward verbatim through
      -- 20260130 and 20260808160000. Dropped here rather than adding the column:
      -- the sibling `UPDATE pickups` branch never tracked updated_at either, and
      -- the transfer is already timestamped in trade_assets, so nothing is lost.
      UPDATE draft_picks
      SET team_id = v_trade.recipient_team_id
      WHERE id = (v_movie.value->>'source_id')::UUID;

      -- counterpicks.target_team_id tracks the CURRENT holder (see column
      -- comment below); retarget_counterpicks_for_holding points it at the new owner so scoring/display stay truthful. It also retargets the display copy on any still-pending counterpick bids for
      -- this same reason -- their own self-target revalidation happens at
      -- bid-processing time, not here.
      PERFORM retarget_counterpicks_for_holding('draft_pick', (v_movie.value->>'source_id')::UUID, v_trade.recipient_team_id);

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

      PERFORM retarget_counterpicks_for_holding('pickup', (v_movie.value->>'source_id')::UUID, v_trade.recipient_team_id);

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
      -- Same non-existent-column bugfix as the initiator branch above.
      UPDATE draft_picks
      SET team_id = v_trade.initiator_team_id
      WHERE id = (v_movie.value->>'source_id')::UUID;

      PERFORM retarget_counterpicks_for_holding('draft_pick', (v_movie.value->>'source_id')::UUID, v_trade.initiator_team_id);

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

      PERFORM retarget_counterpicks_for_holding('pickup', (v_movie.value->>'source_id')::UUID, v_trade.initiator_team_id);

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

  -- ==========================================================================
  -- NEW: expire competing offers that named a holding we just moved
  --
  -- Without this, a losing offer would sit in the recipient's queue looking
  -- actionable until they tried to accept it (respond-trade re-validates and
  -- rejects) or until process-trades next swept it. Expiring here closes that
  -- window and gives us the rows needed to tell both parties why.
  --
  -- Only MOVIE overlap invalidates. An offer that merely shares a team or spends
  -- from the same FAAB budget stays open: budget sufficiency is re-checked at
  -- its own execution time by validate_trade_items(), so an offer that is still
  -- affordable remains perfectly valid.
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
  'Execute a trade transaction atomically. Re-validates ownership under FOR UPDATE (the sole guard against two competing offers both transferring the same holding, now that offers may overlap). Rejects trading a counterpicked movie to the team that counterpicked it, and retargets counterpicks.target_team_id (plus pending counterpick_bids display rows) to the new holder on every transfer. Expires any other open offer naming a holding it moved and returns them as invalidated_trades. Does not violate check_exactly_one_asset (fixed 20260130).';

-- ============================================================================
-- PART 4: Supporting index
--
-- idx_trade_offers_movies_gin (20260132) already indexes the movie arrays for
-- open statuses and still serves the competing-offer lookups above. The
-- teams+status index from 20260131 omitted 'accepted', which now matters
-- because two offers can sit in accepted/review at once; widen it to the full
-- open set so the per-league scans in this migration stay cheap.
-- ============================================================================

DROP INDEX IF EXISTS idx_trade_offers_teams_status;

CREATE INDEX IF NOT EXISTS idx_trade_offers_teams_status
  ON trade_offers (initiator_team_id, recipient_team_id, status)
  WHERE status IN ('proposed', 'countered', 'review', 'accepted');

CREATE INDEX IF NOT EXISTS idx_trade_offers_league_open
  ON trade_offers (league_id)
  WHERE status IN ('proposed', 'countered', 'review', 'accepted');

COMMENT ON INDEX idx_trade_offers_league_open IS
  'Supports per-league scans over open offers (competing-offer expiry in execute_trade, get_contested_source_ids).';
