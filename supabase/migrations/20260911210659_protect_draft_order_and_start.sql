-- Draft order and the transition out of setup share the league-row lock.
-- The helper is not an API: only the owner-checked definer RPCs below use it.
CREATE FUNCTION public.lock_draft_setup(p_league_id UUID)
RETURNS public.leagues
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
BEGIN
  SELECT * INTO v_league FROM public.leagues WHERE id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League not found' USING ERRCODE = 'PT404';
  END IF;
  IF (SELECT auth.uid()) IS DISTINCT FROM v_league.owner_id THEN
    RAISE EXCEPTION 'Only the league owner can change the draft' USING ERRCODE = 'PT403';
  END IF;
  IF v_league.status IS DISTINCT FROM 'setup' THEN
    RAISE EXCEPTION 'Draft configuration can only be changed before the draft starts' USING ERRCODE = 'PT409';
  END IF;
  RETURN v_league;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_draft_setup(UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.randomize_draft_order(p_league_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.lock_draft_setup(p_league_id);
  UPDATE public.league_participants AS participant
  SET draft_order = shuffled.position
  FROM (
    SELECT id, row_number() OVER (ORDER BY random())::INTEGER AS position
    FROM public.league_participants WHERE league_id = p_league_id AND status = 'active'
  ) AS shuffled
  WHERE participant.id = shuffled.id;
  UPDATE public.leagues SET custom_draft_order = TRUE WHERE id = p_league_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_draft_order(p_league_id UUID, p_participant_order UUID[])
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  PERFORM public.lock_draft_setup(p_league_id);
  SELECT count(*) INTO v_count FROM public.league_participants
  WHERE league_id = p_league_id AND status = 'active';
  IF coalesce(cardinality(p_participant_order), 0) <> v_count OR v_count = 0 THEN
    RAISE EXCEPTION 'participant_order length must match active participant count' USING ERRCODE = 'PT400';
  END IF;
  IF (SELECT count(*) FROM public.league_participants
      WHERE id = ANY(p_participant_order) AND league_id = p_league_id AND status = 'active') <> v_count THEN
    RAISE EXCEPTION 'Invalid participant IDs provided' USING ERRCODE = 'PT400';
  END IF;
  UPDATE public.league_participants AS participant
  SET draft_order = requested.position::INTEGER
  FROM unnest(p_participant_order) WITH ORDINALITY AS requested(id, position)
  WHERE participant.id = requested.id;
  UPDATE public.leagues SET custom_draft_order = TRUE WHERE id = p_league_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.randomize_draft_order_if_needed(p_league_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
BEGIN
  v_league := public.lock_draft_setup(p_league_id);
  IF NOT coalesce(v_league.custom_draft_order, FALSE) THEN
    PERFORM public.randomize_draft_order(p_league_id);
  END IF;
END;
$$;

CREATE FUNCTION public.start_draft(p_league_id UUID)
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
  RETURN jsonb_build_object('league', to_jsonb(v_league), 'participant_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.randomize_draft_order(UUID), public.reorder_draft_order(UUID, UUID[]),
  public.randomize_draft_order_if_needed(UUID), public.start_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.randomize_draft_order(UUID), public.reorder_draft_order(UUID, UUID[]),
  public.randomize_draft_order_if_needed(UUID), public.start_draft(UUID) TO authenticated;

-- The normal kick action acquires the parent lock before the participant row,
-- matching start/reorder and avoiding a lock-order inversion during setup.
CREATE FUNCTION public.kick_draft_participant(p_league_id UUID, p_participant_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
  v_participant public.league_participants;
BEGIN
  v_league := public.lock_draft_setup(p_league_id);
  SELECT * INTO v_participant FROM public.league_participants
  WHERE id = p_participant_id AND league_id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found' USING ERRCODE = 'PT404'; END IF;
  IF v_participant.user_id = v_league.owner_id THEN
    RAISE EXCEPTION 'Cannot remove yourself from the league' USING ERRCODE = 'PT400';
  END IF;
  IF v_participant.status <> 'active' THEN
    RAISE EXCEPTION 'Participant is not active' USING ERRCODE = 'PT400';
  END IF;
  UPDATE public.league_participants SET status = 'kicked' WHERE id = p_participant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.kick_draft_participant(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.kick_draft_participant(UUID, UUID) TO authenticated;

-- Keep the existing turn response shape for clients and authenticated Edge calls.
CREATE OR REPLACE FUNCTION public.get_next_draft_pick(p_league_id UUID)
RETURNS TABLE (round INTEGER, pick_number INTEGER, team_id UUID, participant_id UUID, user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
  v_picks INTEGER;
  v_rounds INTEGER;
  v_round INTEGER;
  v_pick INTEGER;
  v_order INTEGER;
BEGIN
  IF current_setting('role', TRUE) IS DISTINCT FROM 'service_role' AND NOT EXISTS (
    SELECT 1 FROM public.leagues l WHERE l.id = p_league_id AND (
      l.owner_id = (SELECT auth.uid()) OR EXISTS (
        SELECT 1 FROM public.league_participants p WHERE p.league_id = l.id
          AND p.user_id = (SELECT auth.uid()) AND p.status = 'active'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Only league members can view the next draft pick' USING ERRCODE = 'PT403';
  END IF;
  SELECT count(*) INTO v_count FROM public.league_participants
  WHERE league_id = p_league_id AND status = 'active';
  SELECT draft_slots INTO v_rounds FROM public.leagues WHERE id = p_league_id;
  IF v_count = 0 OR v_rounds IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_picks FROM public.draft_picks WHERE league_id = p_league_id;
  v_round := v_picks / v_count + 1;
  v_pick := v_picks % v_count + 1;
  IF v_round > v_rounds THEN RETURN; END IF;
  v_order := CASE WHEN v_round % 2 = 1 THEN v_pick ELSE v_count - v_pick + 1 END;
  RETURN QUERY SELECT v_round, v_pick, t.id, p.id, p.user_id
  FROM public.league_participants p JOIN public.teams t ON t.participant_id = p.id
  WHERE p.league_id = p_league_id AND p.status = 'active' AND p.draft_order = v_order;
END;
$$;
REVOKE ALL ON FUNCTION public.get_next_draft_pick(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_draft_pick(UUID) TO authenticated, service_role;

-- Client table writes must not bypass the RPCs. Invoker security is intentional:
-- inside an owner-checked definer RPC current_user is the trusted function owner.
CREATE FUNCTION public.guard_direct_draft_order()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND NEW.draft_order IS DISTINCT FROM OLD.draft_order THEN
    RAISE EXCEPTION 'Use the draft-order action to change participant order' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_direct_draft_order() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_direct_draft_order_trigger BEFORE UPDATE ON public.league_participants
FOR EACH ROW EXECUTE FUNCTION public.guard_direct_draft_order();

-- Join, kick, and delete must share the start lock too. This trigger is a
-- definer so a member's RLS cannot hide the parent during a self-delete check.
-- SQL administrators remain able to repair fixtures/data explicitly; API roles
-- (including service-role join-league) always honor the phase check.
CREATE FUNCTION public.guard_draft_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
  v_league_id UUID;
  v_membership_changed BOOLEAN;
BEGIN
  IF current_setting('role', TRUE) NOT IN ('anon', 'authenticated', 'service_role') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.league_id IS DISTINCT FROM OLD.league_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Participant identity and league cannot be changed' USING ERRCODE = '42501';
    END IF;
    v_membership_changed := NEW.status IS DISTINCT FROM OLD.status;
    IF NOT v_membership_changed AND NEW.draft_order IS NOT DISTINCT FROM OLD.draft_order THEN RETURN NEW; END IF;
  ELSE
    v_membership_changed := TRUE;
  END IF;
  v_league_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.league_id ELSE NEW.league_id END;
  SELECT * INTO v_league FROM public.leagues WHERE id = v_league_id FOR UPDATE;
  -- Parent/account deletion still cascades; a direct API delete sees both rows.
  IF TG_OP = 'DELETE' AND (NOT FOUND OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id)) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' AND current_setting('role', TRUE) IN ('anon', 'authenticated')
    AND (v_league.owner_id IS DISTINCT FROM (SELECT auth.uid())
      OR NEW.user_id IS DISTINCT FROM v_league.owner_id OR NEW.role IS DISTINCT FROM 'owner') THEN
    RAISE EXCEPTION 'Use the join-league action to become a participant' USING ERRCODE = '42501';
  END IF;
  IF v_league.status IS DISTINCT FROM 'setup' THEN
    RAISE EXCEPTION 'Participants cannot be changed after the draft starts' USING ERRCODE = 'PT409';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    IF (SELECT count(*) FROM public.league_participants WHERE league_id = v_league_id AND status = 'active') >= v_league.max_participants THEN
      RAISE EXCEPTION 'League is full' USING ERRCODE = 'PT409';
    END IF;
    -- Two joins may have computed the same draft order before reaching the DB.
    IF NEW.draft_order IS NOT NULL THEN
      SELECT coalesce(max(draft_order), 0) + 1 INTO NEW.draft_order
      FROM public.league_participants WHERE league_id = v_league_id AND status = 'active';
    END IF;
  END IF;
  IF v_membership_changed THEN
    UPDATE public.leagues SET custom_draft_order = FALSE WHERE id = v_league_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_draft_membership() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_draft_membership_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.league_participants
FOR EACH ROW EXECUTE FUNCTION public.guard_draft_membership();

CREATE FUNCTION public.guard_direct_draft_start()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND NEW.status IS DISTINCT FROM OLD.status
    AND (OLD.status = 'setup' OR NEW.status IN ('setup', 'drafting')) THEN
    RAISE EXCEPTION 'Use the draft action to change the league phase' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_direct_draft_start() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_direct_draft_start_trigger BEFORE UPDATE ON public.leagues
FOR EACH ROW EXECUTE FUNCTION public.guard_direct_draft_start();
