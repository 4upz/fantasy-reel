-- Update get_next_draft_pick to use league.draft_slots instead of hardcoded 5
CREATE OR REPLACE FUNCTION get_next_draft_pick(p_league_id UUID)
RETURNS TABLE (
  round INTEGER,
  pick_number INTEGER,
  team_id UUID,
  participant_id UUID,
  user_id UUID
) AS $$
DECLARE
  v_participant_count INTEGER;
  v_picks_made INTEGER;
  v_total_rounds INTEGER;
  v_next_round INTEGER;
  v_next_pick INTEGER;
  v_draft_order INTEGER;
BEGIN
  -- Get participant count
  SELECT COUNT(*) INTO v_participant_count
  FROM league_participants
  WHERE league_id = p_league_id AND status = 'active';

  IF v_participant_count = 0 THEN
    RETURN;
  END IF;

  -- Get total rounds from league config (draft_slots)
  SELECT l.draft_slots INTO v_total_rounds
  FROM leagues l
  WHERE l.id = p_league_id;

  -- Get picks made so far
  SELECT COUNT(*) INTO v_picks_made
  FROM draft_picks
  WHERE league_id = p_league_id;

  -- Calculate next round and pick
  v_next_round := (v_picks_made / v_participant_count) + 1;
  v_next_pick := (v_picks_made % v_participant_count) + 1;

  -- Check if draft is complete
  IF v_next_round > v_total_rounds THEN
    RETURN;
  END IF;

  -- Snake draft: odd rounds go 1,2,3... even rounds go 3,2,1...
  IF v_next_round % 2 = 1 THEN
    v_draft_order := v_next_pick;
  ELSE
    v_draft_order := v_participant_count - v_next_pick + 1;
  END IF;

  -- Return the team whose turn it is
  RETURN QUERY
  SELECT
    v_next_round AS round,
    v_next_pick AS pick_number,
    t.id AS team_id,
    lp.id AS participant_id,
    lp.user_id
  FROM league_participants lp
  JOIN teams t ON t.participant_id = lp.id
  WHERE lp.league_id = p_league_id
    AND lp.status = 'active'
    AND lp.draft_order = v_draft_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_next_draft_pick(UUID) IS
'Returns the team that should make the next pick in a snake draft.
Uses league.draft_slots to determine total rounds.';
