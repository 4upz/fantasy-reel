-- Rename FAAB -> Budget in the messages validate_trade_items() returns.
--
-- These three strings are user-reachable. approve-trade returns execute_trade's
-- refusal straight to the commissioner as the HTTP error body (approve-trade
-- /index.ts), and execute_trade re-runs validate_trade_items() under the trade
-- row lock. The TypeScript pre-check in _shared/trade-validation.ts normally
-- answers first with correctly-worded text, but when a holding or budget changes
-- between that pre-check and the locked re-check -- exactly the race the lock
-- exists for -- this function's wording is what the user sees.
--
-- The new wording is copied verbatim from the TypeScript validator so the two
-- paths can no longer drift in what they tell a user.
--
-- Behaviour is otherwise untouched: same signature, same volatility, same
-- security, same control flow. Only the three message literals differ from the
-- definition installed by 20260133_trading_faab_config.sql. Column names,
-- the `faab` JSONB key, and the internal variable names are deliberately left
-- alone -- those are schema identifiers, not display text (see CLAUDE.md).

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
    ELSE
      RETURN 'Invalid movie source: ' || COALESCE(v_movie.value->>'source', 'null');
    END IF;
  END LOOP;

  RETURN NULL; -- Valid
END;
$$;

COMMENT ON FUNCTION validate_trade_items IS
  'Validates trade items including the fantasy budget against league configuration';

COMMENT ON FUNCTION get_league_faab_budget IS
  'Returns the league''s starting fantasy budget for the given team (column is still named faab_budget)';
