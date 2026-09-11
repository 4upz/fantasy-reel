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
  UPDATE pickup_bids SET status = 'cancelled'
  WHERE league_id = p_league_id AND status IN ('active', 'outbid');
  GET DIAGNOSTICS v_pickups = ROW_COUNT;
  UPDATE counterpick_bids SET status = 'cancelled'
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

-- RLS lets owners edit league settings. It must not also let them attach a
-- season to somebody else's series, reopen history, or forge a final result.
CREATE OR REPLACE FUNCTION guard_league_season()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.series_id IS DISTINCT FROM OLD.series_id THEN
      RAISE EXCEPTION 'A season cannot change series' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'completed' AND (
      NEW.status IS DISTINCT FROM OLD.status OR
      NEW.season_year IS DISTINCT FROM OLD.season_year OR
      NEW.season_end IS DISTINCT FROM OLD.season_end OR
      NEW.completed_at IS DISTINCT FROM OLD.completed_at OR
      NEW.winner_team_ids IS DISTINCT FROM OLD.winner_team_ids OR
      NEW.final_standings IS DISTINCT FROM OLD.final_standings
    ) THEN
      RAISE EXCEPTION 'This season is finished.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF current_user IN ('anon', 'authenticated') THEN
    IF NOT EXISTS (
      SELECT 1 FROM league_series s
      WHERE s.id = NEW.series_id AND s.owner_id = (SELECT auth.uid())
    ) THEN
      RAISE EXCEPTION 'Only the series owner can create its seasons' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'completed' OR NEW.completed_at IS NOT NULL
        OR NEW.winner_team_ids IS NOT NULL OR NEW.final_standings IS NOT NULL THEN
        RAISE EXCEPTION 'Season results are managed by completion' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.winner_team_ids IS DISTINCT FROM OLD.winner_team_ids
      OR NEW.final_standings IS DISTINCT FROM OLD.final_standings
      OR (NEW.status = 'completed' AND OLD.status <> 'completed') THEN
      RAISE EXCEPTION 'Season results are managed by completion' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION guard_league_season() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_league_season_trigger
  BEFORE INSERT OR UPDATE ON leagues FOR EACH ROW EXECUTE FUNCTION guard_league_season();

-- Acquiring a conflicting lock with finalization closes the read-then-write
-- race in Edge Functions and score fan-out. Deletes remain governed by existing
-- RLS/FKs so account deletion can still cascade without erasing the snapshot.
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

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'draft_picks', 'pickups', 'counterpicks', 'team_budgets',
    'pickup_bids', 'counterpick_bids', 'trade_offers', 'team_scores'
  ] LOOP
    EXECUTE format('CREATE TRIGGER guard_season_activity_trigger BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_season_activity()', v_table);
  END LOOP;
END;
$$;

-- Rollover resets every result field, including the later-added snapshot.
CREATE OR REPLACE FUNCTION start_next_season(
  p_league_id   UUID,
  p_season_year INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source        leagues%ROWTYPE;
  v_new           leagues%ROWTYPE;
  v_participant   RECORD;
  v_new_part_id   UUID;
BEGIN
  -- FOR UPDATE, so two clicks on "Start next season" cannot both pass the
  -- duplicate check below and create two seasons for the same year. The unique
  -- index leagues_series_season_uidx is the backstop; this is the clean error.
  SELECT * INTO v_source FROM leagues WHERE id = p_league_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'League % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_source.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a finished season can roll over (this one is %)', v_source.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM leagues
    WHERE series_id = v_source.series_id
      AND season_year = p_season_year
  ) THEN
    RAISE EXCEPTION 'A % season already exists for this league', p_season_year
      USING ERRCODE = 'unique_violation';
  END IF;

  -- --------------------------------------------------------------------------
  -- The new season's row: a copy of the old one, minus what must not carry.
  --
  -- Copying the whole rowtype and then clearing is deliberate, and the opposite
  -- of enumerating the settings to copy. Every column on `leagues` that is not
  -- listed below is a season-scoped *setting* -- roster sizes, budget, drop
  -- limit, bid cutoff, trade rules, counterpick slots, name, owner,
  -- invite_only, max_participants -- and settings should carry forward. Making
  -- "copy" the default means a column added next year is inherited by new
  -- seasons without anyone remembering to come back here; the failure mode of
  -- the enumerated version is a setting silently reverting to its default,
  -- which nobody notices until a league plays a season under the wrong rules.
  --
  -- The cost of that choice: a future column that must NOT be inherited has to
  -- be added to the reset list below. That is a visible, one-line obligation
  -- attached to a column that already needed thought.
  -- --------------------------------------------------------------------------
  v_new := v_source;

  v_new.id                 := gen_random_uuid();
  v_new.created_at         := now();
  v_new.updated_at         := now();

  -- Same series: this is what makes it season N+1 rather than a new league.
  v_new.season_year        := p_season_year;
  v_new.season_end         := make_date(p_season_year, 12, 31);

  -- Nothing has happened yet in the new season.
  v_new.status             := 'setup';
  v_new.completed_at       := NULL;
  v_new.winner_team_ids    := NULL;
  v_new.final_standings    := NULL;

  -- Dates belong to the season that set them. The trade deadline is left NULL
  -- rather than defaulted to season_end so the UI's "defaults to season end"
  -- affordance still reads as unset, and the commissioner makes the call.
  v_new.draft_start_date   := NULL;
  v_new.draft_end_date     := NULL;
  v_new.trade_deadline     := NULL;

  -- Join credentials are per-season and single-use by nature: a code shared
  -- last year must not admit anyone to this year's league. `generate-join-link`
  -- mints new ones on demand.
  v_new.join_code          := NULL;
  v_new.join_token         := NULL;

  -- FALSE means "no one has set an order yet", so `start-draft` randomizes.
  -- Last season's order is not this season's order.
  v_new.custom_draft_order := FALSE;

  INSERT INTO leagues VALUES (v_new.*);

  -- --------------------------------------------------------------------------
  -- The people: active participants and their teams, nothing they own.
  --
  -- Row by row rather than one INSERT ... SELECT because each team must be
  -- attached to the *new* participant row, and there is no way to carry that
  -- old-id -> new-id mapping through a single statement.
  --
  -- Only `status = 'active'`: someone who left or was removed last season is
  -- not silently re-enrolled. `role` is preserved, so co-commissioners stay
  -- co-commissioners. `draft_order` is left NULL -- see custom_draft_order.
  -- --------------------------------------------------------------------------
  FOR v_participant IN
    SELECT
      lp.user_id,
      lp.role,
      t.name       AS team_name,
      t.avatar_url AS team_avatar_url,
      pr.display_name
    FROM league_participants lp
    LEFT JOIN teams t     ON t.participant_id = lp.id
    LEFT JOIN profiles pr ON pr.user_id = lp.user_id
    WHERE lp.league_id = p_league_id
      AND lp.status = 'active'
    ORDER BY lp.draft_order NULLS LAST, lp.joined_at
  LOOP
    INSERT INTO league_participants (league_id, user_id, role, status, draft_order)
    VALUES (v_new.id, v_participant.user_id, v_participant.role, 'active', NULL)
    RETURNING id INTO v_new_part_id;

    -- A participant with no team is a broken state rather than a normal one
    -- (join-league warns when team creation fails), but it must not carry that
    -- breakage into the new season -- a participant without a team cannot
    -- draft. The fallback mirrors join-league's default name.
    INSERT INTO teams (participant_id, name, avatar_url)
    VALUES (
      v_new_part_id,
      COALESCE(
        v_participant.team_name,
        NULLIF(v_participant.display_name, '') || '''s Production Company',
        'Production Company'
      ),
      v_participant.team_avatar_url
    );
  END LOOP;

  -- team_budgets and team_scores are deliberately NOT created here: they are
  -- initialized when a league activates (_shared/activation.ts), and a season
  -- in 'setup' has neither a budget to spend nor a score to show.

  -- --------------------------------------------------------------------------
  -- Discord: the channel MOVES to the new season rather than being copied.
  --
  -- discord_channels.channel_id carries a UNIQUE constraint (uq_discord_channel),
  -- so one Discord channel maps to exactly one league and a copy is impossible.
  -- Moving is also the behaviour a guild wants: #fantasy-movies should report
  -- whatever season is being played, and the season it just stopped reporting
  -- on is finished -- completion posts its own final-standings embed before any
  -- rollover can happen.
  --
  -- Webhook, thread, role mentions and every notify_* toggle ride along
  -- untouched, so nobody has to re-run /configure each year.
  -- --------------------------------------------------------------------------
  UPDATE discord_channels
  SET league_id = v_new.id
  WHERE league_id = p_league_id;

  RETURN v_new.id;
END;
$$;

COMMENT ON FUNCTION start_next_season(UUID, INTEGER) IS
'Opens season p_season_year of the series that p_league_id belongs to: copies every league setting, the active participants and their teams, and moves the Discord channel over. Copies no rosters, bids, trades, counterpicks or scores. Raises if the source season is not completed or if that season year already exists in the series. Returns the new league id.';

-- Callable only by the service role: `start-next-season` checks that the caller
-- owns the league before it gets here, and this function checks nothing about
-- who is asking. A default-PUBLIC grant would let any authenticated client roll
-- over any completed league it could name.
REVOKE EXECUTE ON FUNCTION start_next_season(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION start_next_season(UUID, INTEGER) TO service_role;

-- Filter frozen-only movies before PostgREST applies its batch limit/count.
-- Counterpicks survive drops, so they count even without an active holding.
CREATE VIEW score_update_candidates WITH (security_invoker = true) AS
SELECT m.* FROM movies m
WHERE (
  NOT EXISTS (SELECT 1 FROM team_holdings h WHERE h.movie_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM counterpicks c WHERE c.movie_id = m.id)
) OR EXISTS (
  SELECT 1 FROM team_holdings h JOIN leagues l ON l.id = h.league_id
  WHERE h.movie_id = m.id AND l.status IS DISTINCT FROM 'completed'
) OR EXISTS (
  SELECT 1 FROM counterpicks c JOIN leagues l ON l.id = c.league_id
  WHERE c.movie_id = m.id AND l.status IS DISTINCT FROM 'completed'
);
REVOKE ALL ON score_update_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON score_update_candidates TO service_role;
