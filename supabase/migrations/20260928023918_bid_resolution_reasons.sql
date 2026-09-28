-- Persist the outcome of an unawarded bid independently of notifications.
-- Leave historical reasons unknown rather than inferring them from status alone.

ALTER TABLE pickup_bids
  ADD COLUMN resolution_reason TEXT,
  ADD CONSTRAINT pickup_bids_resolution_reason_check CHECK (
    resolution_reason IS NULL OR (
      status IN ('lost', 'cancelled') AND resolution_reason IN (
        'outbid', 'no_slots', 'insufficient_budget', 'movie_released',
        'movie_dropped', 'target_owned', 'target_missing', 'user_cancelled', 'season_completed'
      )
    )
  );

COMMENT ON COLUMN pickup_bids.resolution_reason IS
  'Why a bid was lost or cancelled; NULL for pending/won bids and unknown historical outcomes.';

ALTER TABLE counterpick_bids
  ADD COLUMN resolution_reason TEXT,
  ADD CONSTRAINT counterpick_bids_resolution_reason_check CHECK (
    resolution_reason IS NULL OR (
      status IN ('lost', 'cancelled') AND resolution_reason IN (
        'outbid', 'no_slots', 'insufficient_budget', 'movie_released',
        'movie_dropped', 'target_owned', 'target_missing', 'user_cancelled', 'season_completed'
      )
    )
  );

COMMENT ON COLUMN counterpick_bids.resolution_reason IS
  'Why a bid was lost or cancelled; NULL for pending/won bids and unknown historical outcomes.';

-- Finish a season in one transaction. Score refresh, the immutable snapshot,
-- and cancellation of pending activity must either all commit or all retry.
CREATE OR REPLACE FUNCTION complete_league_season(
  p_league_id UUID,
  p_trigger TEXT DEFAULT 'owner'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league leagues%ROWTYPE;
  v_team RECORD;
  v_standings JSONB;
  v_winners UUID[];
  v_pickups INTEGER;
  v_counterpicks INTEGER;
  v_trades INTEGER;
BEGIN
  IF p_trigger NOT IN ('owner', 'cron') OR p_trigger IS NULL THEN
    RAISE EXCEPTION 'Invalid completion trigger' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_league FROM leagues WHERE id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_league.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;
  -- Recheck under the lock: the commissioner may have extended the season
  -- after the cron selected its overdue candidates.
  IF p_trigger = 'cron'
     AND v_league.season_end >= (now() AT TIME ZONE 'UTC')::DATE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_due');
  END IF;

  FOR v_team IN
    SELECT t.id FROM teams t
    JOIN league_participants lp ON lp.id = t.participant_id
    WHERE lp.league_id = p_league_id AND lp.status = 'active'
    ORDER BY t.id
  LOOP
    PERFORM recalculate_team_score_with_counterpicks(v_team.id);
  END LOOP;

  SELECT COALESCE(jsonb_agg(
    to_jsonb(s) || jsonb_build_object('display_name', pr.display_name)
    ORDER BY s.rank, s.team_name, s.team_id
  ), '[]'::JSONB)
  INTO v_standings
  FROM league_standings(p_league_id) s
  LEFT JOIN profiles pr ON pr.user_id = s.user_id;

  SELECT COALESCE(array_agg((s->>'team_id')::UUID), ARRAY[]::UUID[])
  INTO v_winners FROM jsonb_array_elements(v_standings) s
  WHERE (s->>'rank')::INTEGER = 1;

  -- Do this before marking completed so gameplay guards also apply to every
  -- writer that was already in flight when completion took the season lock.
  UPDATE pickup_bids SET status = 'cancelled', resolution_reason = 'season_completed'
  WHERE league_id = p_league_id AND status IN ('active', 'outbid');
  GET DIAGNOSTICS v_pickups = ROW_COUNT;
  UPDATE counterpick_bids SET status = 'cancelled', resolution_reason = 'season_completed'
  WHERE league_id = p_league_id AND status IN ('active', 'outbid');
  GET DIAGNOSTICS v_counterpicks = ROW_COUNT;
  UPDATE trade_offers SET status = 'expired', expired_reason = 'season_completed'
  WHERE league_id = p_league_id AND status IN ('proposed', 'countered', 'accepted', 'review');
  GET DIAGNOSTICS v_trades = ROW_COUNT;

  UPDATE leagues SET
    status = 'completed',
    completed_at = now(),
    winner_team_ids = v_winners,
    final_standings = v_standings
  WHERE id = p_league_id
  RETURNING * INTO v_league;

  RETURN jsonb_build_object(
    'ok', true,
    'league', to_jsonb(v_league),
    'standings', v_standings,
    'winnerTeamIds', to_jsonb(v_winners),
    'voidedBids', v_pickups + v_counterpicks,
    'expiredTrades', v_trades
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_league_season(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_league_season(UUID, TEXT) TO service_role;


-- Keep the completed-season cleanup exception narrow: the only new metadata
-- it can record is season_completed. Status-only legacy cleanup remains valid.
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
        AND (v_row->>'resolution_reason' IS NULL OR v_row->>'resolution_reason' = 'season_completed')
        AND (v_row - 'status' - 'resolution_reason' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'resolution_reason' - 'updated_at') THEN
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
