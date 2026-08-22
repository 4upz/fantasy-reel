-- ============================================================================
-- Trade validation errors name the movie, not its id
--
-- These strings are user-facing. The trade modals render whatever the Edge
-- Function returns, verbatim, and approve-trade hands execute_trade's refusal
-- straight to the commissioner as the HTTP error body -- so a user reading
-- "Cannot trade a counterpicked movie to the team that counterpicked it:
-- 0e000001-0001-0001-0001-000000000001" is being shown a primary key and
-- expected to work out which of their movies is meant.
--
-- Every message here now names the movie (and, where the rule is about a team
-- holding something, the team). No behaviour changes: same signatures, same
-- volatility, same security, same control flow, same conditions. Only the
-- message literals and the joins needed to build them differ.
--
-- CLAUDE.md requires this function's wording to match the TypeScript validator
-- in _shared/trade-validation.ts, because either can answer first depending on
-- whether a holding changed hands between the pre-check and the locked
-- re-check. The strings below are copied from it verbatim -- change both
-- together.
--
-- Function bodies only. Safe to run via `migration up`.
-- ============================================================================

-- ============================================================================
-- PART 1: validate_trade_items
--
-- Based verbatim on 20260822120000_allow_trading_counterpicks.sql. The three
-- ownership branches now look up the movie title alongside the ownership check
-- they were already doing, and the budget messages are unchanged (they were
-- always readable, and name no ids).
--
-- A title is read even on the failure path, so each branch does its lookup
-- unconditionally rather than only when it needs the message. That is one
-- extra join on a primary-key lookup, against a function that already runs
-- per item.
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
      SELECT m.title, (dp.team_id = p_team_id AND dp.dropped_at IS NULL)
      INTO v_title, v_owned
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
      SELECT m.title, (pk.team_id = p_team_id AND pk.dropped_at IS NULL)
      INTO v_title, v_owned
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
      SELECT m.title, (c.counterpicker_team_id = p_team_id)
      INTO v_title, v_owned
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
  END LOOP;

  RETURN NULL; -- Valid
END;
$$;

COMMENT ON FUNCTION validate_trade_items IS
  'Validates trade items -- draft pick, pickup and counterpick ownership plus the fantasy budget against league configuration. Messages are user-facing and name the movie, not its id; kept worded identically to _shared/trade-validation.ts.';

-- ============================================================================
-- PART 2: execute_trade -- the two counterpick guards name movie and team
--
-- Only the message block changes. The conflict detection above it -- the
-- post-trade ownership CTE, unchanged from 20260822120000 -- already knows
-- which counterpick is at fault; it now also carries the movie title and the
-- team that blocks the move, so the message can be written the way the
-- TypeScript validator writes it.
--
-- The rest of the function (FOR UPDATE re-validation, roster transfers,
-- settle_counterpicks_for_trade, FAAB, competing-offer expiry, rescoring) is
-- reproduced verbatim from 20260822120000.
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
  v_conflict_title TEXT;
  v_conflict_team TEXT;
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
  -- leaves the trade completely untouched. This is the authoritative gate --
  -- the TS-side check in _shared/trade-validation.ts is a UX-earlier mirror of
  -- the same rule, not a substitute for it.
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
           c.movie_id,
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
         mv.title,
         t.name
  INTO v_conflict_kind, v_conflict_title, v_conflict_team
  FROM disturbed d
  LEFT JOIN counterpick_moves cm ON cm.counterpick_id = d.counterpick_id
  LEFT JOIN holding_moves hm ON hm.source_id = d.holding_id AND hm.source = d.holding_source
  JOIN movies mv ON mv.id = d.movie_id
  -- The blocking team is whoever ends up on both sides, which is the same team
  -- either way once the conflict is established.
  JOIN teams t ON t.id = COALESCE(cm.destination_team_id, d.counterpicker_team_id)
  WHERE COALESCE(cm.destination_team_id, d.counterpicker_team_id)
      = COALESCE(hm.destination_team_id, d.holder_team_id)
  LIMIT 1;

  IF v_conflict_kind = 'counterpick_to_holder' THEN
    RETURN jsonb_build_object(
      'error',
      format('%s holds "%s", so they can''t also hold the counterpick on it.', v_conflict_team, v_conflict_title)
    );
  ELSIF v_conflict_kind = 'movie_to_counterpicker' THEN
    RETURN jsonb_build_object(
      'error',
      format('%s holds the counterpick on "%s", so they can''t also hold the movie.', v_conflict_team, v_conflict_title)
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
  -- Expire competing offers that named an asset we just moved. See
  -- 20260809120000 (introduced) and 20260822120000 (counterpicks) for why this
  -- compares source_ids without regard to source, and for the deadlock note.
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
  'Execute a trade transaction atomically -- draft picks, pickups, counterpicks and budget. Re-validates ownership under FOR UPDATE (the sole guard against two competing offers both transferring the same asset). Rejects any deal that would leave one team holding both a movie and the counterpick against it, judged on post-trade ownership, with a message that names the movie and team. Retargets counterpicks when a movie moves, moves counterpicker_team_id when a counterpick moves, rescores both teams, and expires any other open offer naming an asset it moved.';
