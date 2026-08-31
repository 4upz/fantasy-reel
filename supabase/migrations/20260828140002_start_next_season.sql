-- ============================================================================
-- ROLLOVER: OPEN THE NEXT SEASON OF A SERIES
-- ============================================================================
--
-- A league is a series (`league_series`); a season is one `leagues` row in it.
-- Rollover copies the *settings* and the *people* forward, and nothing else:
-- rosters, bids, trades, scores and counterpicks all belong to the season that
-- just ended and stay there, which is what keeps last year browsable.
--
-- Manager-initiated, never automatic -- matching Fantasy Critic. A completed
-- season that nobody rolls over simply stays completed.
-- ============================================================================

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
