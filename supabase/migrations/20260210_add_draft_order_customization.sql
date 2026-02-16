-- Add flag to track whether draft order was manually set or randomized
ALTER TABLE leagues ADD COLUMN custom_draft_order BOOLEAN DEFAULT FALSE;

-- Randomize draft order for all active participants in a league
CREATE OR REPLACE FUNCTION randomize_draft_order(p_league_id UUID)
RETURNS VOID AS $$
DECLARE
  v_participant RECORD;
  v_new_order INTEGER := 1;
BEGIN
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
