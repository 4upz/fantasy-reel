-- Per-user UI state: guided tours seen, and the switch that turns them off.
--
-- One small key/value row per thing the interface needs to remember about a
-- user across devices. Keys are namespaced so later features (one-off tips,
-- announcements) reuse the table instead of adding their own:
--
--   tour:<tour-id>   {"v": 2, "status": "completed"|"dismissed"|"snoozed",
--                     "snoozes": 1, "until": "<timestamptz>"}
--                    Written only through record_tour_outcome() below, which
--                    keeps the rules in one place. Tours are defined in
--                    apps/frontend/tours/ (see docs/TOURS.md).
--   prefs:tours      {"enabled": false} -- the user turned automatic tours off.
--   hint:<id>, announce:<id>
--                    Reserved for later; nothing writes them yet.
--
-- The table holds nothing anyone else may see, so it is own-rows only, and it
-- goes with the account (ON DELETE CASCADE). Size is bounded by the key and
-- value checks plus a per-user row cap, so it needs no retention window.

CREATE TABLE public.user_ui_state (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^(tour|prefs|hint|announce):[a-z0-9][a-z0-9-]{0,63}$'),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object' AND pg_column_size(value) <= 1024),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

COMMENT ON TABLE public.user_ui_state IS
  'Per-user interface state (tours seen, tour preference). Namespaced keys; see the migration header.';

CREATE TRIGGER update_user_ui_state_updated_at
  BEFORE UPDATE ON public.user_ui_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS keeps a user to their own rows, but not to a sane number of them.
CREATE FUNCTION public.enforce_user_ui_state_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- An upsert of an existing key fires this too; that adds no row.
  IF NOT EXISTS (SELECT 1 FROM user_ui_state WHERE user_id = NEW.user_id AND key = NEW.key)
    AND (SELECT count(*) FROM user_ui_state WHERE user_id = NEW.user_id) >= 200 THEN
    RAISE EXCEPTION 'Too many saved interface settings' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_user_ui_state_limit
  BEFORE INSERT ON public.user_ui_state
  FOR EACH ROW
  EXECUTE FUNCTION enforce_user_ui_state_limit();

ALTER TABLE public.user_ui_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_ui_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ui_state TO authenticated;
GRANT ALL ON TABLE public.user_ui_state TO service_role;

CREATE POLICY "Users can view their own UI state"
  ON public.user_ui_state FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can create their own UI state"
  ON public.user_ui_state FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own UI state"
  ON public.user_ui_state FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can reset their own UI state"
  ON public.user_ui_state FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Records how a tour ended for the calling user and returns what was stored.
--
-- Two tabs, two devices, or a tab still running last week's bundle can all
-- report on the same tour, so the merge is monotonic:
--   * a report for an older version than the stored one changes nothing, so a
--     stale tab can't undo a version bump;
--   * at the same version, completed beats dismissed beats snoozed;
--   * "Not now" (snoozed) hides the tour for 3 days; the second snooze of the
--     same version counts as dismissed, so a tour asks at most twice.
-- SECURITY INVOKER: RLS still applies, and auth.uid() is the only user it can
-- write for.
CREATE FUNCTION public.record_tour_outcome(p_tour_id text, p_version integer, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_key text := 'tour:' || p_tour_id;
  v_old jsonb;
  v_old_version integer;
  v_old_status text;
  v_snoozes integer;
  v_new jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to save tour progress' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('completed', 'dismissed', 'snoozed') THEN
    RAISE EXCEPTION 'Unknown tour outcome' USING ERRCODE = '22023';
  END IF;
  IF p_version IS NULL OR p_version NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Tour version out of range' USING ERRCODE = '22023';
  END IF;

  -- Make sure a row exists, then lock it, so concurrent reports serialize
  -- even on a user's first one. The key check rejects a malformed tour id.
  INSERT INTO user_ui_state (user_id, key, value)
  VALUES (v_user, v_key, '{"v": 0}')
  ON CONFLICT (user_id, key) DO NOTHING;

  SELECT value INTO v_old FROM user_ui_state
  WHERE user_id = v_user AND key = v_key
  FOR UPDATE;

  v_old_version := COALESCE((v_old->>'v')::integer, 0);
  v_old_status := v_old->>'status';

  IF v_old_version > p_version THEN
    RETURN v_old;
  END IF;
  IF v_old_version = p_version AND (
    v_old_status = 'completed'
    OR (v_old_status = 'dismissed' AND p_status <> 'completed')
  ) THEN
    RETURN v_old;
  END IF;

  IF p_status = 'snoozed' THEN
    v_snoozes := 1 + CASE
      WHEN v_old_version = p_version AND v_old_status = 'snoozed' THEN COALESCE((v_old->>'snoozes')::integer, 0)
      ELSE 0
    END;
    IF v_snoozes >= 2 THEN
      v_new := jsonb_build_object('v', p_version, 'status', 'dismissed');
    ELSE
      v_new := jsonb_build_object('v', p_version, 'status', 'snoozed', 'snoozes', v_snoozes, 'until', now() + interval '3 days');
    END IF;
  ELSE
    v_new := jsonb_build_object('v', p_version, 'status', p_status);
  END IF;

  UPDATE user_ui_state SET value = v_new WHERE user_id = v_user AND key = v_key;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.record_tour_outcome(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_tour_outcome(text, integer, text) TO authenticated, service_role;
