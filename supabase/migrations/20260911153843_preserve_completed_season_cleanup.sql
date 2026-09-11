-- Preserve shared-movie score fan-out and FK account cleanup while keeping
-- completed gameplay immutable. Follow-up to the initial lifecycle guards.
CREATE OR REPLACE FUNCTION guard_season_activity()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID;
  v_status TEXT;
  v_row JSONB := to_jsonb(NEW);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME IN ('team_scores', 'team_budgets') THEN
      IF (v_row->>'team_id') IS DISTINCT FROM (to_jsonb(OLD)->>'team_id') THEN
        RAISE EXCEPTION 'Season accounting cannot change teams' USING ERRCODE = '42501';
      END IF;
    ELSIF (v_row->>'league_id') IS DISTINCT FROM (to_jsonb(OLD)->>'league_id') THEN
      RAISE EXCEPTION 'Season activity cannot change leagues' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME IN ('team_scores', 'team_budgets') THEN
    SELECT lp.league_id INTO v_league_id FROM teams t
    JOIN league_participants lp ON lp.id = t.participant_id
    WHERE t.id = NEW.team_id;
  ELSE
    v_league_id := (v_row->>'league_id')::UUID;
  END IF;

  SELECT status INTO v_status FROM leagues WHERE id = v_league_id FOR SHARE;
  IF v_status = 'completed' THEN
    -- A movie can still score in another league. Its fan-out should quietly
    -- retain completed team totals while continuing to refresh live seasons.
    IF TG_TABLE_NAME = 'team_scores' THEN RETURN NULL; END IF;
    -- Allow idempotent cleanup of legacy/pending activity, without admitting
    -- roster changes or rewriting already-awarded bids.
    IF TG_OP = 'UPDATE' THEN
      -- Global movie scoring fans out into this denormalized score column.
      -- Retain the completed value while allowing the movie and live leagues
      -- to finish their own score refresh.
      IF TG_TABLE_NAME = 'counterpicks'
        AND (v_row - 'fantasy_points' - 'updated_at') = (to_jsonb(OLD) - 'fantasy_points' - 'updated_at') THEN
        RETURN NULL;
      END IF;
      -- ON DELETE SET NULL must still detach a deleted counterpicker's team.
      -- No ownership, drop state, or score changes can accompany FK cleanup.
      IF TG_TABLE_NAME IN ('draft_picks', 'pickups')
        AND v_row->>'counterpicked_by_team_id' IS NULL
        AND to_jsonb(OLD)->>'counterpicked_by_team_id' IS NOT NULL
        AND (v_row - 'counterpicked_by_team_id' - 'updated_at') = (to_jsonb(OLD) - 'counterpicked_by_team_id' - 'updated_at') THEN
        RETURN NEW;
      END IF;
      IF TG_TABLE_NAME IN ('pickup_bids', 'counterpick_bids')
        AND (to_jsonb(OLD)->>'status') IN ('active', 'outbid') AND (v_row->>'status') = 'cancelled'
        AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at') THEN
        RETURN NEW;
      END IF;
      IF TG_TABLE_NAME = 'trade_offers'
        AND (to_jsonb(OLD)->>'status') IN ('proposed', 'countered', 'accepted', 'review')
        AND (v_row->>'status') = 'expired' AND (v_row->>'expired_reason') = 'season_completed'
        AND (to_jsonb(NEW) - 'status' - 'expired_reason' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'expired_reason' - 'updated_at') THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'This season is finished.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION guard_season_activity() FROM PUBLIC, anon, authenticated;
