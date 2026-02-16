-- Add flag to track whether draft order was manually set or randomized
ALTER TABLE leagues ADD COLUMN custom_draft_order BOOLEAN DEFAULT FALSE;

-- Randomize draft order for all active participants in a league
CREATE OR REPLACE FUNCTION randomize_draft_order(p_league_id UUID)
RETURNS VOID AS $$
DECLARE
  v_participant RECORD;
  v_new_order INTEGER := 1;
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM league_participants
  WHERE league_id = p_league_id AND status = 'active';
  IF v_count < 2 THEN RETURN; END IF;

  FOR v_participant IN
    SELECT id
    FROM league_participants
    WHERE league_id = p_league_id AND status = 'active'
    ORDER BY RANDOM()
  LOOP
    UPDATE league_participants
    SET draft_order = v_new_order
    WHERE id = v_participant.id;

    v_new_order := v_new_order + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reorder draft order for all active participants in a league (transactional)
CREATE OR REPLACE FUNCTION reorder_draft_order(p_league_id UUID, p_participant_order UUID[])
RETURNS VOID AS $$
DECLARE
  v_count INTEGER;
  v_array_len INTEGER;
  v_i INTEGER;
  v_valid_count INTEGER;
BEGIN
  -- Get active participant count
  SELECT COUNT(*) INTO v_count FROM league_participants
  WHERE league_id = p_league_id AND status = 'active';

  v_array_len := array_length(p_participant_order, 1);

  -- Validate array length matches active count
  IF v_array_len IS NULL OR v_array_len != v_count THEN
    RAISE EXCEPTION 'participant_order length must match active participant count';
  END IF;

  -- Validate all IDs belong to this league's active participants
  SELECT COUNT(*) INTO v_valid_count FROM league_participants
  WHERE id = ANY(p_participant_order) AND league_id = p_league_id AND status = 'active';

  IF v_valid_count != v_array_len THEN
    RAISE EXCEPTION 'Invalid participant IDs provided';
  END IF;

  -- Update draft_order for each participant (all in one transaction)
  FOR v_i IN 1..v_array_len LOOP
    UPDATE league_participants
    SET draft_order = v_i
    WHERE id = p_participant_order[v_i] AND league_id = p_league_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-randomize only if custom_draft_order is FALSE (called by start-draft)
CREATE OR REPLACE FUNCTION randomize_draft_order_if_needed(p_league_id UUID)
RETURNS VOID AS $$
DECLARE
  v_custom_order BOOLEAN;
BEGIN
  SELECT custom_draft_order INTO v_custom_order
  FROM leagues
  WHERE id = p_league_id;

  IF v_custom_order = FALSE THEN
    PERFORM randomize_draft_order(p_league_id);

    UPDATE leagues
    SET custom_draft_order = TRUE
    WHERE id = p_league_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
