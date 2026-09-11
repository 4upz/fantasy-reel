-- A submission key names one logical action, including its original turn slot.
-- Only authenticated Edge handlers using the service role can commit selections.
CREATE TABLE public.draft_submissions (
  request_id UUID PRIMARY KEY,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  movie_id UUID NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('draft', 'counterpick')),
  expected_pick INTEGER NOT NULL CHECK (expected_pick > 0),
  result_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX draft_submissions_league ON public.draft_submissions(league_id);
CREATE INDEX draft_submissions_user ON public.draft_submissions(user_id);
CREATE INDEX draft_submissions_movie ON public.draft_submissions(movie_id);
ALTER TABLE public.draft_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.draft_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.draft_submissions TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.draft_picks, public.counterpicks FROM anon, authenticated;

-- Legacy score helpers use unqualified public names. Pin their resolution when
-- called from the empty-search-path transaction helpers below.
ALTER FUNCTION public.recalculate_team_score_with_counterpicks(UUID) SET search_path = public, pg_temp;

CREATE FUNCTION public.lock_draft_league(p_league_id UUID, p_user_id UUID, p_owner_only BOOLEAN DEFAULT FALSE)
RETURNS public.leagues LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league public.leagues;
BEGIN
  SELECT * INTO v_league FROM public.leagues WHERE id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'League not found' USING ERRCODE = 'PT404'; END IF;
  IF p_user_id IS NULL OR (p_owner_only AND p_user_id IS DISTINCT FROM v_league.owner_id) THEN
    RAISE EXCEPTION 'Only the league owner can change the draft phase' USING ERRCODE = 'PT403';
  END IF;
  IF NOT p_owner_only AND NOT EXISTS (
    SELECT 1 FROM public.league_participants WHERE league_id = p_league_id AND user_id = p_user_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'You are not a member of this league' USING ERRCODE = 'PT403'; END IF;
  RETURN v_league;
END;
$$;

CREATE FUNCTION public.require_draft_complete(p_league_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_expected INTEGER; v_picks INTEGER;
BEGIN
  SELECT count(*)::INTEGER * l.draft_slots INTO v_expected
  FROM public.leagues l JOIN public.league_participants p ON p.league_id = l.id AND p.status = 'active'
  WHERE l.id = p_league_id GROUP BY l.draft_slots;
  SELECT count(*) INTO v_picks FROM public.draft_picks WHERE league_id = p_league_id;
  IF v_expected IS NULL OR v_expected = 0 OR v_picks <> v_expected THEN
    RAISE EXCEPTION 'All draft picks must be completed first' USING ERRCODE = 'PT409';
  END IF;
END;
$$;

CREATE FUNCTION public.activate_drafted_league(p_league_id UUID)
RETURNS public.leagues LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league public.leagues; v_team RECORD;
BEGIN
  SELECT * INTO v_league FROM public.leagues WHERE id = p_league_id FOR UPDATE;
  IF v_league.status NOT IN ('drafting', 'counterpicking') OR v_league.status IS NULL THEN
    RAISE EXCEPTION 'League status has changed, please refresh' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.require_draft_complete(p_league_id);
  FOR v_team IN SELECT t.id FROM public.teams t JOIN public.league_participants p ON p.id = t.participant_id
    WHERE p.league_id = p_league_id AND p.status = 'active' ORDER BY t.id
  LOOP
    INSERT INTO public.team_budgets(team_id, remaining_budget) VALUES(v_team.id, v_league.faab_budget)
      ON CONFLICT (team_id) DO NOTHING;
    PERFORM public.recalculate_team_score_with_counterpicks(v_team.id);
  END LOOP;
  UPDATE public.leagues SET status = 'active' WHERE id = p_league_id RETURNING * INTO v_league;
  PERFORM public.enqueue_draft_notification(p_league_id, 'active:' || p_league_id, 'league_activated');
  RETURN v_league;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_next_counterpick_turn(p_league_id UUID)
RETURNS TABLE(round INTEGER, pick_number INTEGER, team_id UUID, participant_id UUID, user_id UUID, counterpicks_remaining INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER; v_slots INTEGER; v_picks INTEGER; v_round INTEGER; v_pick INTEGER; v_order INTEGER;
BEGIN
  IF current_setting('role', TRUE) IS DISTINCT FROM 'service_role' AND NOT EXISTS (
    SELECT 1 FROM public.leagues l WHERE l.id = p_league_id AND (l.owner_id = (SELECT auth.uid()) OR EXISTS (
      SELECT 1 FROM public.league_participants p WHERE p.league_id = l.id AND p.user_id = (SELECT auth.uid()) AND p.status = 'active'
    ))
  ) THEN RAISE EXCEPTION 'Only league members can view the next counterpick' USING ERRCODE = 'PT403'; END IF;
  SELECT count(*) INTO v_count FROM public.league_participants WHERE league_id = p_league_id AND status = 'active';
  SELECT draft_counterpick_slots INTO v_slots FROM public.leagues WHERE id = p_league_id;
  IF v_count = 0 OR coalesce(v_slots, 0) = 0 THEN RETURN; END IF;
  SELECT count(*) INTO v_picks FROM public.counterpicks WHERE league_id = p_league_id AND phase = 'draft';
  IF v_picks >= v_count * v_slots THEN RETURN; END IF;
  v_round := v_picks / v_count + 1;
  v_pick := v_picks % v_count + 1;
  v_order := CASE WHEN v_round % 2 = 1 THEN v_count - v_pick + 1 ELSE v_pick END;
  RETURN QUERY SELECT v_round, v_pick, t.id, p.id, p.user_id,
    v_slots - (SELECT count(*)::INTEGER FROM public.counterpicks c WHERE c.counterpicker_team_id = t.id AND c.phase = 'draft')
  FROM public.league_participants p JOIN public.teams t ON t.participant_id = p.id
  WHERE p.league_id = p_league_id AND p.status = 'active' AND p.draft_order = v_order;
END;
$$;
REVOKE ALL ON FUNCTION public.get_next_counterpick_turn(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_counterpick_turn(UUID) TO authenticated, service_role;

-- Responses always include current phase/turn, even when replaying an older
-- successful request. A retry must never send the UI back to an earlier phase.
CREATE FUNCTION public.draft_submission_response(p_request_id UUID, p_replayed BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.draft_submissions; v_league public.leagues; v_result JSONB; v_next JSONB; v_movie JSONB; v_team JSONB;
BEGIN
  SELECT * INTO STRICT v_request FROM public.draft_submissions WHERE request_id = p_request_id;
  SELECT * INTO STRICT v_league FROM public.leagues WHERE id = v_request.league_id;
  SELECT jsonb_build_object('id', id, 'tmdb_id', tmdb_id, 'title', title, 'poster_url', poster_url, 'release_date', release_date, 'fantasy_points', fantasy_points)
    INTO v_movie FROM public.movies WHERE id = v_request.movie_id;
  IF v_request.kind = 'draft' THEN
    SELECT to_jsonb(p) INTO v_result FROM public.draft_picks p WHERE id = v_request.result_id;
    IF v_league.status = 'drafting' THEN
      SELECT to_jsonb(n) INTO v_next FROM public.get_next_draft_pick(v_request.league_id) n;
    END IF;
    RETURN jsonb_build_object('pick', v_result, 'movie', v_movie, 'league', to_jsonb(v_league),
      'next_pick', v_next, 'draft_complete', v_next IS NULL, 'replayed', p_replayed);
  END IF;
  SELECT to_jsonb(c), jsonb_build_object('id', t.id, 'name', t.name) INTO v_result, v_team
    FROM public.counterpicks c JOIN public.teams t ON t.id = c.target_team_id WHERE c.id = v_request.result_id;
  IF v_league.status = 'counterpicking' THEN
    SELECT to_jsonb(n) INTO v_next FROM public.get_next_counterpick_turn(v_request.league_id) n;
  END IF;
  RETURN jsonb_build_object('counterpick', v_result, 'movie', v_movie, 'target_team', v_team, 'league', to_jsonb(v_league),
    'next_turn', v_next, 'round_complete', v_league.status <> 'counterpicking', 'replayed', p_replayed);
END;
$$;

CREATE FUNCTION public.reserve_draft_submission(p_league_id UUID, p_user_id UUID, p_movie_id UUID,
  p_expected_pick INTEGER, p_request_id UUID, p_kind TEXT)
RETURNS public.draft_submissions LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.draft_submissions;
BEGIN
  IF p_request_id IS NULL OR p_expected_pick IS NULL OR p_expected_pick < 1 THEN
    RAISE EXCEPTION 'A request ID and expected pick are required' USING ERRCODE = 'PT400';
  END IF;
  INSERT INTO public.draft_submissions(request_id, league_id, user_id, movie_id, expected_pick, kind)
    VALUES(p_request_id, p_league_id, p_user_id, p_movie_id, p_expected_pick, p_kind)
    ON CONFLICT(request_id) DO NOTHING;
  SELECT * INTO STRICT v_request FROM public.draft_submissions WHERE request_id = p_request_id FOR UPDATE;
  IF (v_request.league_id, v_request.user_id, v_request.movie_id, v_request.expected_pick, v_request.kind)
    IS DISTINCT FROM (p_league_id, p_user_id, p_movie_id, p_expected_pick, p_kind) THEN
    RAISE EXCEPTION 'This request ID was already used for a different selection' USING ERRCODE = 'PT409';
  END IF;
  RETURN v_request;
END;
$$;

CREATE FUNCTION public.commit_draft_pick(p_league_id UUID, p_user_id UUID, p_movie_id UUID, p_expected_pick INTEGER, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league public.leagues; v_request public.draft_submissions; v_turn RECORD; v_count INTEGER;
  v_pick public.draft_picks; v_movie public.movies; v_next UUID; v_complete BOOLEAN;
BEGIN
  v_league := public.lock_draft_league(p_league_id, p_user_id);
  SELECT * INTO v_movie FROM public.movies WHERE id = p_movie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movie not found' USING ERRCODE = 'PT404'; END IF;
  v_request := public.reserve_draft_submission(p_league_id, p_user_id, p_movie_id, p_expected_pick, p_request_id, 'draft');
  IF v_request.result_id IS NOT NULL THEN RETURN public.draft_submission_response(p_request_id, TRUE); END IF;
  IF v_league.status IS DISTINCT FROM 'drafting' THEN
    RAISE EXCEPTION 'Draft is not accepting picks' USING ERRCODE = 'PT409';
  END IF;
  SELECT count(*) INTO v_count FROM public.draft_picks WHERE league_id = p_league_id;
  IF v_count + 1 <> p_expected_pick THEN RAISE EXCEPTION 'The draft has advanced. Review the latest turn.' USING ERRCODE = 'PT409'; END IF;
  SELECT * INTO v_turn FROM public.get_next_draft_pick(p_league_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft is complete' USING ERRCODE = 'PT409'; END IF;
  IF v_turn.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'It is not your turn to pick' USING ERRCODE = 'PT403'; END IF;
  IF v_movie.release_date IS NULL OR v_movie.release_date < (now() AT TIME ZONE 'UTC')::DATE
    OR extract(YEAR FROM v_movie.release_date) < v_league.season_year THEN
    RAISE EXCEPTION 'Movie is no longer eligible for this draft' USING ERRCODE = 'PT400';
  END IF;
  IF EXISTS (SELECT 1 FROM public.draft_picks WHERE league_id = p_league_id AND movie_id = p_movie_id) THEN
    RAISE EXCEPTION 'This movie has already been drafted' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.draft_picks(league_id, team_id, movie_id, round, pick_number)
    VALUES(p_league_id, v_turn.team_id, p_movie_id, v_turn.round, v_turn.pick_number) RETURNING * INTO v_pick;
  UPDATE public.draft_submissions SET result_id = v_pick.id WHERE request_id = p_request_id;
  SELECT team_id INTO v_next FROM public.get_next_draft_pick(p_league_id);
  v_complete := NOT FOUND;
  -- Queue selection before activation so channel delivery follows transaction order.
  PERFORM public.enqueue_draft_notification(p_league_id, 'pick:' || v_pick.id, 'draft_pick',
    jsonb_build_object('pick_id', v_pick.id, 'next_team_id', v_next, 'draft_complete', v_complete));
  IF v_complete AND coalesce(v_league.draft_counterpick_slots, 0) = 0 THEN
    PERFORM public.activate_drafted_league(p_league_id);
  END IF;
  RETURN public.draft_submission_response(p_request_id, FALSE);
END;
$$;

CREATE FUNCTION public.commit_counterpick(p_league_id UUID, p_user_id UUID, p_movie_id UUID, p_expected_pick INTEGER, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league public.leagues; v_request public.draft_submissions; v_turn RECORD; v_count INTEGER;
  v_target public.team_holdings; v_pick public.counterpicks;
BEGIN
  v_league := public.lock_draft_league(p_league_id, p_user_id);
  IF NOT EXISTS(SELECT 1 FROM public.movies WHERE id = p_movie_id) THEN RAISE EXCEPTION 'Movie not found' USING ERRCODE = 'PT404'; END IF;
  v_request := public.reserve_draft_submission(p_league_id, p_user_id, p_movie_id, p_expected_pick, p_request_id, 'counterpick');
  IF v_request.result_id IS NOT NULL THEN RETURN public.draft_submission_response(p_request_id, TRUE); END IF;
  IF v_league.status IS DISTINCT FROM 'counterpicking' THEN
    RAISE EXCEPTION 'Counterpick round is not accepting picks' USING ERRCODE = 'PT409';
  END IF;
  SELECT count(*) INTO v_count FROM public.counterpicks WHERE league_id = p_league_id AND phase = 'draft';
  IF v_count + 1 <> p_expected_pick THEN RAISE EXCEPTION 'The counterpick round has advanced. Review the latest turn.' USING ERRCODE = 'PT409'; END IF;
  SELECT * INTO v_turn FROM public.get_next_counterpick_turn(p_league_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Counterpick round is complete' USING ERRCODE = 'PT409'; END IF;
  IF v_turn.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'It is not your turn to counterpick' USING ERRCODE = 'PT403'; END IF;
  SELECT * INTO v_target FROM public.team_holdings WHERE league_id = p_league_id AND movie_id = p_movie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movie not found in this league draft' USING ERRCODE = 'PT404'; END IF;
  IF v_target.team_id = v_turn.team_id THEN RAISE EXCEPTION 'Cannot counterpick your own movie' USING ERRCODE = 'PT400'; END IF;
  IF v_target.counterpicked_by_team_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.counterpicks WHERE league_id = p_league_id AND movie_id = p_movie_id
  ) THEN RAISE EXCEPTION 'This movie has already been counterpicked' USING ERRCODE = 'PT409'; END IF;
  IF v_target.release_date IS NULL OR v_target.release_date < (now() AT TIME ZONE 'UTC')::DATE
    OR extract(YEAR FROM v_target.release_date) < v_league.season_year THEN
    RAISE EXCEPTION 'Cannot counterpick this movie: movie is no longer eligible' USING ERRCODE = 'PT400';
  END IF;
  INSERT INTO public.counterpicks(league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pickup_id, pick_order, phase, fantasy_points)
    VALUES(p_league_id, v_turn.team_id, v_target.team_id, p_movie_id,
      CASE WHEN v_target.source = 'draft' THEN v_target.holding_id END,
      CASE WHEN v_target.source = 'pickup' THEN v_target.holding_id END, p_expected_pick, 'draft', -v_target.fantasy_points)
    RETURNING * INTO v_pick;
  IF v_target.source = 'draft' THEN
    UPDATE public.draft_picks SET counterpicked_by_team_id = v_turn.team_id WHERE id = v_target.holding_id;
  ELSE
    UPDATE public.pickups SET counterpicked_by_team_id = v_turn.team_id WHERE id = v_target.holding_id;
  END IF;
  UPDATE public.draft_submissions SET result_id = v_pick.id WHERE request_id = p_request_id;
  PERFORM 1 FROM public.get_next_counterpick_turn(p_league_id);
  IF NOT FOUND THEN PERFORM public.activate_drafted_league(p_league_id); END IF;
  RETURN public.draft_submission_response(p_request_id, FALSE);
END;
$$;

CREATE FUNCTION public.transition_draft_phase(p_league_id UUID, p_user_id UUID, p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league public.leagues; v_next JSONB;
BEGIN
  v_league := public.lock_draft_league(p_league_id, p_user_id, TRUE);
  IF p_action NOT IN ('start_counterpicks', 'skip_counterpicks', 'end_counterpicks') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Invalid draft phase action' USING ERRCODE = 'PT400';
  END IF;
  -- Idempotent explicit owner actions also survive a lost response.
  IF p_action = 'start_counterpicks' AND v_league.status = 'counterpicking' THEN
    SELECT to_jsonb(n) INTO v_next FROM public.get_next_counterpick_turn(p_league_id) n;
  ELSIF p_action IN ('skip_counterpicks', 'end_counterpicks') AND v_league.status = 'active' THEN
    NULL;
  ELSE
    IF v_league.status IS DISTINCT FROM (CASE WHEN p_action = 'end_counterpicks' THEN 'counterpicking' ELSE 'drafting' END) THEN
      RAISE EXCEPTION 'League status has changed, please refresh' USING ERRCODE = 'PT409';
    END IF;
    IF coalesce(v_league.draft_counterpick_slots, 0) = 0 THEN
      RAISE EXCEPTION 'League has no counterpick slots configured' USING ERRCODE = 'PT400';
    END IF;
    PERFORM public.require_draft_complete(p_league_id);
    IF p_action = 'start_counterpicks' THEN
      UPDATE public.leagues SET status = 'counterpicking' WHERE id = p_league_id RETURNING * INTO v_league;
      SELECT to_jsonb(n) INTO v_next FROM public.get_next_counterpick_turn(p_league_id) n;
      IF v_next IS NULL THEN RAISE EXCEPTION 'Counterpick round is complete' USING ERRCODE = 'PT409'; END IF;
    ELSE
      v_league := public.activate_drafted_league(p_league_id);
    END IF;
  END IF;
  RETURN jsonb_build_object('league', to_jsonb(v_league), 'first_pick', v_next, 'round_complete', v_league.status = 'active');
END;
$$;

REVOKE ALL ON FUNCTION public.lock_draft_league(UUID, UUID, BOOLEAN), public.require_draft_complete(UUID),
 public.activate_drafted_league(UUID), public.draft_submission_response(UUID, BOOLEAN),
 public.reserve_draft_submission(UUID, UUID, UUID, INTEGER, UUID, TEXT)
 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_draft_pick(UUID, UUID, UUID, INTEGER, UUID),
 public.commit_counterpick(UUID, UUID, UUID, INTEGER, UUID), public.transition_draft_phase(UUID, UUID, TEXT)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_draft_pick(UUID, UUID, UUID, INTEGER, UUID),
 public.commit_counterpick(UUID, UUID, UUID, INTEGER, UUID), public.transition_draft_phase(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_direct_draft_start()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    -- Completed-season transitions retain the existing season guard's errors.
    IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status IS DISTINCT FROM 'completed'
      AND NEW.status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'Use the draft action to change the league phase' USING ERRCODE = '42501';
    END IF;
    IF OLD.status IS DISTINCT FROM 'setup' AND
      (NEW.draft_slots, NEW.draft_counterpick_slots, NEW.max_participants, NEW.season_year, NEW.faab_budget, NEW.owner_id, NEW.custom_draft_order)
      IS DISTINCT FROM (OLD.draft_slots, OLD.draft_counterpick_slots, OLD.max_participants, OLD.season_year, OLD.faab_budget, OLD.owner_id, OLD.custom_draft_order) THEN
      RAISE EXCEPTION 'Draft configuration cannot change after the draft starts' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Removing or relocating a team would cascade picks and silently change turns.
CREATE FUNCTION public.guard_draft_team_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league_id UUID; v_status TEXT;
BEGIN
  IF current_setting('role', TRUE) NOT IN ('anon', 'authenticated', 'service_role') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.participant_id IS DISTINCT FROM OLD.participant_id THEN
      RAISE EXCEPTION 'Team identity and participant cannot be changed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  SELECT p.league_id INTO v_league_id FROM public.league_participants p JOIN auth.users u ON u.id = p.user_id WHERE p.id = OLD.participant_id;
  IF NOT FOUND THEN RETURN OLD; END IF;
  SELECT status INTO v_status FROM public.leagues WHERE id = v_league_id FOR UPDATE;
  IF FOUND AND v_status IS DISTINCT FROM 'setup' THEN
    RAISE EXCEPTION 'Teams cannot be removed after the draft starts' USING ERRCODE = 'PT409';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_draft_team_identity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_draft_team_identity_trigger BEFORE UPDATE OR DELETE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.guard_draft_team_identity();

-- Starting the draft now enqueues delivery in the same database transaction.
CREATE OR REPLACE FUNCTION public.start_draft(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
  v_count INTEGER;
  v_valid_order BOOLEAN;
BEGIN
  v_league := public.lock_draft_setup(p_league_id);
  SELECT count(*) INTO v_count FROM public.league_participants
  WHERE league_id = p_league_id AND status = 'active';
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Need at least 2 participants to start the draft' USING ERRCODE = 'PT400';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.league_participants p
    WHERE p.league_id = p_league_id AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.participant_id = p.id)
  ) THEN
    RAISE EXCEPTION 'Every participant needs a team before the draft starts' USING ERRCODE = 'PT400';
  END IF;
  PERFORM public.randomize_draft_order_if_needed(p_league_id);
  SELECT count(DISTINCT draft_order) = v_count AND min(draft_order) = 1 AND max(draft_order) = v_count
    INTO v_valid_order
  FROM public.league_participants WHERE league_id = p_league_id AND status = 'active';
  IF NOT coalesce(v_valid_order, FALSE) THEN
    RAISE EXCEPTION 'Draft order is incomplete. Set the order again before starting.' USING ERRCODE = 'PT400';
  END IF;
  UPDATE public.leagues SET status = 'drafting' WHERE id = p_league_id RETURNING * INTO v_league;
  PERFORM public.enqueue_draft_notification(p_league_id, 'start:' || p_league_id, 'draft_started',
    jsonb_build_object('participant_count', v_count, 'next_team_id',
      (SELECT t.id FROM public.teams t JOIN public.league_participants p ON p.id = t.participant_id
       WHERE p.league_id = p_league_id AND p.status = 'active' AND p.draft_order = 1)));
  RETURN jsonb_build_object('league', to_jsonb(v_league), 'participant_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_counterpick_options(p_league_id UUID, p_team_id UUID)
RETURNS TABLE(draft_pick_id UUID, movie_id UUID, movie_title VARCHAR(500), poster_url TEXT, release_date DATE,
  owner_team_id UUID, owner_team_name VARCHAR(100), fantasy_points DECIMAL(6,2), source TEXT, pickup_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams t JOIN public.league_participants p ON p.id = t.participant_id
    WHERE t.id = p_team_id AND p.league_id = p_league_id AND p.status = 'active'
      AND (current_setting('role', TRUE) = 'service_role' OR p.user_id = (SELECT auth.uid()))
  ) THEN RAISE EXCEPTION 'Only league members can view counterpick options for their own team' USING ERRCODE = 'PT403'; END IF;
  RETURN QUERY SELECT
    CASE WHEN h.source = 'draft' THEN h.holding_id END, h.movie_id, h.title, h.poster_url, h.release_date,
    h.team_id, h.team_name, h.fantasy_points, h.source, CASE WHEN h.source = 'pickup' THEN h.holding_id END
  FROM public.team_holdings h JOIN public.leagues l ON l.id = h.league_id
  WHERE h.league_id = p_league_id AND h.team_id <> p_team_id
    AND h.counterpicked_by_team_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.counterpicks c WHERE c.league_id = p_league_id AND c.movie_id = h.movie_id)
    AND h.release_date >= (now() AT TIME ZONE 'UTC')::DATE AND extract(YEAR FROM h.release_date) >= l.season_year
  ORDER BY h.release_date, h.title;
END;
$$;
REVOKE ALL ON FUNCTION public.get_counterpick_options(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_counterpick_options(UUID, UUID) TO authenticated, service_role;
