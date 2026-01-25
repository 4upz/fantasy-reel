-- ============================================================================
-- Trading FAAB Configuration
--
-- Adds league-level FAAB budget configuration to replace hard-coded maximum.
-- Also documents the counter-offer role swap behavior.
-- ============================================================================

-- ============================================================================
-- PART 1: Add FAAB Budget Configuration to Leagues
-- ============================================================================

-- Add faab_budget column to leagues with default of 100 (maintaining backwards compatibility)
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS faab_budget INTEGER NOT NULL DEFAULT 100;

-- Add constraint to ensure reasonable FAAB limits
ALTER TABLE leagues ADD CONSTRAINT check_faab_budget_reasonable
  CHECK (faab_budget >= 0 AND faab_budget <= 10000);

COMMENT ON COLUMN leagues.faab_budget IS 'Starting FAAB budget for each team in the league (default 100)';

-- ============================================================================
-- PART 2: Update team_budgets Default to Use League Config
-- ============================================================================

-- Create function to get league FAAB budget for a team
CREATE OR REPLACE FUNCTION get_league_faab_budget(p_team_id UUID)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT l.faab_budget
  FROM leagues l
  JOIN league_participants lp ON lp.league_id = l.id
  JOIN teams t ON t.participant_id = lp.id
  WHERE t.id = p_team_id
$$;

COMMENT ON FUNCTION get_league_faab_budget IS 'Returns the configured FAAB budget for a team''s league';

-- ============================================================================
-- PART 3: Update trade_items Validation to Use Dynamic FAAB Max
-- ============================================================================

-- Replace validate_trade_items to use league's FAAB configuration
CREATE OR REPLACE FUNCTION validate_trade_items(
  p_team_id UUID,
  p_items JSONB
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_movie RECORD;
  v_faab INTEGER;
  v_budget INTEGER;
  v_max_faab INTEGER;
BEGIN
  -- Get the league's FAAB budget configuration
  v_max_faab := get_league_faab_budget(p_team_id);
  IF v_max_faab IS NULL THEN
    v_max_faab := 100; -- Fallback default
  END IF;

  -- Check FAAB amount
  v_faab := COALESCE((p_items->>'faab')::INTEGER, 0);

  -- Validate FAAB is within bounds
  IF v_faab < 0 THEN
    RETURN 'FAAB must be non-negative';
  END IF;

  IF v_faab > v_max_faab THEN
    RETURN format('FAAB must not exceed league budget of $%s', v_max_faab);
  END IF;

  IF v_faab > 0 THEN
    SELECT remaining_budget INTO v_budget
    FROM team_budgets
    WHERE team_id = p_team_id;

    IF v_budget IS NULL OR v_faab > v_budget THEN
      RETURN format('Insufficient FAAB budget. Have $%s, trying to trade $%s', COALESCE(v_budget, 0), v_faab);
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
  'Validates trade items including FAAB against league configuration';

-- ============================================================================
-- PART 4: Document Counter-Offer Role Swap Behavior
-- ============================================================================

-- Add comment to counter_trade function explaining the role swap
COMMENT ON FUNCTION counter_trade IS
  'Atomically counters a trade with proper row-level locking.

ROLE SWAP BEHAVIOR:
When a counter-offer is submitted, the initiator and recipient roles are swapped:
- The original recipient becomes the new initiator (they are proposing the counter)
- The original initiator becomes the new recipient (they must respond)

This design means:
- initiator_team_id always identifies WHO PROPOSED the current version of the trade
- recipient_team_id always identifies WHO MUST RESPOND to the current version
- The trade record represents the CURRENT STATE, not the original proposal

UX IMPLICATIONS:
- Notifications should say "You are now responding to a counter-offer" to the new recipient
- Email templates should clearly indicate role changes
- UI should show current proposer/responder clearly
- Authorization checks use current roles (current recipient can accept/reject/counter)

ALTERNATIVES CONSIDERED:
1. Keep original initiator/recipient, add current_proposer_team_id - More complex schema
2. Create new trade record linked to parent - Loses single trade view
3. Current approach - Simple, clear "who is waiting for response"

The swap model was chosen for simplicity: there is always exactly one team waiting
for a response, and that team is always recipient_team_id.';

-- ============================================================================
-- PART 5: Comments
-- ============================================================================

COMMENT ON CONSTRAINT check_faab_budget_reasonable ON leagues IS
  'Ensures FAAB budget is between 0 and 10000';
