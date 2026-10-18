-- Push notifications for the iOS app (requirements O-01, D-10).
--
-- Every in-app notification can also go to the person's iPhones:
--
--   1. The app registers its APNs device token through register_push_device()
--      (push_devices). A token belongs to one account at a time: signing in as
--      someone else on the same phone moves it.
--   2. push_preferences holds one switch per category (Draft, Bids, Trades,
--      Your movies, League activity, Season). No row means everything is on.
--      These switches govern push only; the inbox and emails are unchanged.
--   3. An AFTER INSERT trigger on notifications queues one push_outbox row per
--      device whose owner has that category on. Every existing sender (Edge
--      Functions and SQL) is covered without touching it.
--   4. The send-push-notifications cron (Vercel Cron -> /api/cron/...) leases
--      rows with claim_push_notifications(), sends them to APNs and reports
--      back with finish_push_notifications(). A token APNs says is dead is
--      deleted. Pushes older than three hours are expired rather than sent.
--
-- It also adds the `draft_turn` notification (draft and counterpick turns),
-- which only Discord announced until now.

-- ============================================================================
-- 1. Devices
-- ============================================================================

CREATE TABLE public.push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- APNs tokens are hex, 32 bytes today; Apple says not to rely on the length.
  token TEXT NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{64,200}$'),
  -- Debug builds get sandbox tokens, TestFlight and App Store builds production.
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  bundle_id TEXT NOT NULL CHECK (bundle_id ~ '^[A-Za-z0-9.-]{1,155}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The app re-registers on every launch; purge_expired_data drops tokens of
  -- phones that haven't opened the app in 180 days.
  last_registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_devices_user ON public.push_devices(user_id);
CREATE INDEX idx_push_devices_last_registered ON public.push_devices(last_registered_at);

-- Clients never read or write the table directly: tokens are only registered
-- and removed through the functions below.
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO service_role;

COMMENT ON TABLE public.push_devices IS
  'APNs device tokens of signed-in iPhones. One account per token. Service role only; clients use register_push_device / unregister_push_device.';

-- Registers (or moves) this phone's token to the signed-in account. One
-- account keeps its 10 most recently registered phones.
CREATE FUNCTION public.register_push_device(p_token TEXT, p_environment TEXT, p_bundle_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := (SELECT auth.uid());
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to turn on notifications' USING ERRCODE = 'PT401';
  END IF;

  INSERT INTO public.push_devices (user_id, token, environment, bundle_id)
  VALUES (v_user, lower(p_token), p_environment, p_bundle_id)
  ON CONFLICT (token) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      environment = EXCLUDED.environment,
      bundle_id = EXCLUDED.bundle_id,
      last_registered_at = now();

  DELETE FROM public.push_devices
  WHERE user_id = v_user
    AND id NOT IN (
      SELECT id FROM public.push_devices
      WHERE user_id = v_user
      ORDER BY last_registered_at DESC
      LIMIT 10
    );
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_device(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(TEXT, TEXT, TEXT) TO authenticated;

-- Sign-out removes the phone's token while the session is still valid.
CREATE FUNCTION public.unregister_push_device(p_token TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  DELETE FROM public.push_devices
  WHERE token = lower(p_token) AND user_id = (SELECT auth.uid());
$$;
REVOKE ALL ON FUNCTION public.unregister_push_device(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(TEXT) TO authenticated;

-- ============================================================================
-- 2. Preferences
-- ============================================================================

CREATE TABLE public.push_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  draft BOOLEAN NOT NULL DEFAULT TRUE,
  bids BOOLEAN NOT NULL DEFAULT TRUE,
  trades BOOLEAN NOT NULL DEFAULT TRUE,
  my_movies BOOLEAN NOT NULL DEFAULT TRUE,
  league_activity BOOLEAN NOT NULL DEFAULT TRUE,
  season BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_preferences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.push_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_preferences TO service_role;

CREATE POLICY "Users read their own push preferences"
  ON public.push_preferences FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users create their own push preferences"
  ON public.push_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users update their own push preferences"
  ON public.push_preferences FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE FUNCTION public.touch_push_preferences()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER touch_push_preferences
  BEFORE UPDATE ON public.push_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_push_preferences();

-- The push category of a notification type: the Settings switch that governs
-- it. NULL means the type is never pushed. Keep in step with
-- `_shared/push-notifications.ts` (interruption levels) and the iOS
-- `PushCategory`.
CREATE FUNCTION public.push_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_type = 'draft_turn' THEN 'draft'
    WHEN p_type IN ('outbid', 'bid_won', 'bid_lost', 'pickup_available') THEN 'bids'
    WHEN p_type LIKE 'trade\_%' THEN 'trades'
    WHEN p_type IN ('movie_scored', 'movie_released') THEN 'my_movies'
    WHEN p_type = 'league_movie_scored' THEN 'league_activity'
    WHEN p_type IN ('season_started', 'season_completed', 'league_ownership_transferred') THEN 'season'
  END;
$$;

-- Whether `p_user` has `p_category` on. No preferences row: everything on.
CREATE FUNCTION public.push_category_enabled(p_user UUID, p_category TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT CASE p_category
      WHEN 'draft' THEN p.draft
      WHEN 'bids' THEN p.bids
      WHEN 'trades' THEN p.trades
      WHEN 'my_movies' THEN p.my_movies
      WHEN 'league_activity' THEN p.league_activity
      WHEN 'season' THEN p.season
    END
    FROM public.push_preferences p
    WHERE p.user_id = p_user
  ), p_category IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.push_category_enabled(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. Outbox
-- ============================================================================

CREATE TABLE public.push_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.push_devices(id) ON DELETE CASCADE,
  -- Who the push was for. A token that has since moved to another account is
  -- skipped at send time rather than shown to the wrong person.
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'skipped', 'expired', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (notification_id, device_id)
);
CREATE INDEX idx_push_outbox_pending ON public.push_outbox(available_at) WHERE status = 'pending';
CREATE INDEX idx_push_outbox_device ON public.push_outbox(device_id);
CREATE INDEX idx_push_outbox_created ON public.push_outbox(created_at);

ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_outbox TO service_role;

-- Queues a push per device. A failure here must never stop the in-app
-- notification itself, so it is logged and swallowed.
CREATE FUNCTION public.enqueue_push_for_notification()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.push_outbox (notification_id, device_id, user_id)
  SELECT NEW.id, d.id, NEW.user_id
  FROM public.push_devices d
  WHERE d.user_id = NEW.user_id
    AND public.push_category_enabled(NEW.user_id, public.push_category(NEW.type::TEXT))
  ON CONFLICT (notification_id, device_id) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_push_for_notification failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_push_for_notification() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enqueue_push_for_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_push_for_notification();

-- Leases up to p_limit pushes for the sender, with everything it needs to
-- build each one. Before leasing it settles rows that must not be sent:
-- older than three hours (expired), or whose token now belongs to someone
-- else or whose category was switched off since it was queued (skipped).
CREATE FUNCTION public.claim_push_notifications(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  id UUID,
  lease_token UUID,
  attempts INTEGER,
  notification_id UUID,
  type TEXT,
  title TEXT,
  body TEXT,
  league_id UUID,
  data JSONB,
  created_at TIMESTAMPTZ,
  token TEXT,
  environment TEXT,
  bundle_id TEXT,
  badge INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.push_outbox o
  SET status = 'expired', finished_at = now(), lease_token = NULL, leased_until = NULL
  WHERE o.status = 'pending' AND o.created_at < now() - interval '3 hours';

  UPDATE public.push_outbox o
  SET status = 'skipped', finished_at = now(), lease_token = NULL, leased_until = NULL
  FROM public.push_devices d, public.notifications n
  WHERE o.status = 'pending'
    AND d.id = o.device_id
    AND n.id = o.notification_id
    AND (
      d.user_id <> o.user_id
      OR NOT public.push_category_enabled(o.user_id, public.push_category(n.type::TEXT))
    );

  RETURN QUERY
  WITH ready AS (
    SELECT c.id FROM public.push_outbox c
    WHERE c.status = 'pending'
      AND c.available_at <= now()
      AND (c.leased_until IS NULL OR c.leased_until < now())
    ORDER BY c.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(p_limit, 500))
  ), leased AS (
    UPDATE public.push_outbox o
    SET attempts = o.attempts + 1,
        lease_token = gen_random_uuid(),
        leased_until = now() + interval '2 minutes'
    FROM ready
    WHERE o.id = ready.id
    RETURNING o.*
  )
  SELECT l.id, l.lease_token, l.attempts, n.id, n.type::TEXT, n.title, n.body, n.league_id, n.data,
         n.created_at, d.token, d.environment, d.bundle_id,
         (SELECT count(*)::INTEGER FROM public.notifications u
          WHERE u.user_id = l.user_id AND u.read_at IS NULL)
  FROM leased l
  JOIN public.notifications n ON n.id = l.notification_id
  JOIN public.push_devices d ON d.id = l.device_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_push_notifications(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_notifications(INTEGER) TO service_role;

-- Records a batch of delivery results: [{id, lease_token, outcome, error?}].
--   sent           delivered to APNs
--   retry          a temporary failure; backs off, and fails after 5 attempts
--   failed         a permanent failure for this push (bad payload, wrong topic)
--   unregistered   APNs says the token is dead: the device is deleted, which
--                  also clears its other queued pushes
-- Results whose lease has lapsed are ignored, so a slow run can't overwrite
-- the run that took the row over.
CREATE FUNCTION public.finish_push_notifications(p_results JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
  v_outcome TEXT;
  v_device UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_result IN SELECT * FROM jsonb_array_elements(COALESCE(p_results, '[]'::JSONB)) LOOP
    v_outcome := v_result->>'outcome';
    IF v_outcome NOT IN ('sent', 'retry', 'failed', 'unregistered') THEN
      RAISE EXCEPTION 'Invalid push outcome: %', v_outcome;
    END IF;

    UPDATE public.push_outbox o
    SET status = CASE
          WHEN v_outcome = 'sent' THEN 'sent'
          WHEN v_outcome = 'retry' AND o.attempts < 5 THEN 'pending'
          ELSE 'failed'
        END,
        available_at = CASE
          WHEN v_outcome = 'retry' THEN now() + make_interval(secs => least(600, 30 * power(2, least(o.attempts, 5))::INTEGER))
          ELSE o.available_at
        END,
        finished_at = CASE WHEN v_outcome = 'retry' AND o.attempts < 5 THEN NULL ELSE now() END,
        lease_token = NULL,
        leased_until = NULL,
        last_error = left(v_result->>'error', 500)
    WHERE o.id = (v_result->>'id')::UUID
      AND o.lease_token = (v_result->>'lease_token')::UUID
      AND o.status = 'pending'
    RETURNING o.device_id INTO v_device;

    IF FOUND THEN
      v_count := v_count + 1;
      IF v_outcome = 'unregistered' THEN
        DELETE FROM public.push_devices WHERE id = v_device;
      END IF;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_push_notifications(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_push_notifications(JSONB) TO service_role;

-- ============================================================================
-- 4. "It's your pick"
-- ============================================================================

-- Tells whoever is on the clock now. Runs after a pick, a counterpick, or the
-- league entering its draft or counterpick round, inside that transaction.
-- A failure is logged and swallowed: a notification must never undo a pick.
CREATE FUNCTION public.notify_draft_turn(p_league_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
  v_user UUID;
  v_round INTEGER;
  v_pick INTEGER;
BEGIN
  SELECT * INTO v_league FROM public.leagues WHERE id = p_league_id;
  IF v_league.status = 'drafting' THEN
    SELECT n.user_id, n.round, n.pick_number INTO v_user, v_round, v_pick
    FROM public.get_next_draft_pick(p_league_id) n;
    IF v_user IS NULL THEN RETURN; END IF;
    INSERT INTO public.notifications (user_id, league_id, type, title, body, data)
    VALUES (v_user, p_league_id, 'draft_turn', 'You''re on the clock',
      format('It''s your pick in %s: round %s, pick %s.', v_league.name, v_round, v_pick),
      jsonb_build_object('phase', 'draft', 'round', v_round, 'pick_number', v_pick));
  ELSIF v_league.status = 'counterpicking' THEN
    SELECT n.user_id, n.round, n.pick_number INTO v_user, v_round, v_pick
    FROM public.get_next_counterpick_turn(p_league_id) n;
    IF v_user IS NULL THEN RETURN; END IF;
    INSERT INTO public.notifications (user_id, league_id, type, title, body, data)
    VALUES (v_user, p_league_id, 'draft_turn', 'Your counterpick',
      format('It''s your turn to counterpick in %s.', v_league.name),
      jsonb_build_object('phase', 'counterpick', 'round', v_round, 'pick_number', v_pick));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_draft_turn failed for league %: %', p_league_id, SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_draft_turn(UUID) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.notify_draft_turn_after_pick()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.notify_draft_turn(NEW.league_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_draft_turn_after_pick() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notify_draft_turn_after_pick
  AFTER INSERT ON public.draft_picks
  FOR EACH ROW EXECUTE FUNCTION public.notify_draft_turn_after_pick();

-- Bid-won counterpicks (phase 'bidding') happen in an active season, which
-- notify_draft_turn ignores; the WHEN keeps them from calling it at all.
CREATE TRIGGER notify_draft_turn_after_counterpick
  AFTER INSERT ON public.counterpicks
  FOR EACH ROW WHEN (NEW.phase = 'draft')
  EXECUTE FUNCTION public.notify_draft_turn_after_pick();

CREATE FUNCTION public.notify_draft_turn_on_phase()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.notify_draft_turn(NEW.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_draft_turn_on_phase() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notify_draft_turn_on_phase
  AFTER UPDATE OF status ON public.leagues
  FOR EACH ROW
  WHEN (NEW.status IN ('drafting', 'counterpicking') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_draft_turn_on_phase();

-- ============================================================================
-- 5. Retention
-- ============================================================================

-- Adds two windows to the daily purge (see 20261004130700): settled pushes
-- 7 days after they were queued, pushes never claimed after a day (the
-- sender expires them after three hours, but only while it runs with an APNs
-- key), and tokens of phones that haven't opened the app in 180 days.
-- Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.purge_expired_data(p_batch_size integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_notification_log integer;
  v_invitations integer;
  v_notifications integer;
  v_outbox integer;
  v_discord_log integer;
  v_push_outbox integer;
  v_push_devices integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'purge_expired_data: p_batch_size must be positive';
  END IF;

  DELETE FROM notification_log
  WHERE id IN (
    SELECT id FROM notification_log
    WHERE created_at < now() - interval '90 days'
    LIMIT p_batch_size
  );
  GET DIAGNOSTICS v_notification_log = ROW_COUNT;

  DELETE FROM invitations
  WHERE id IN (
    SELECT i.id
    FROM invitations i
    LEFT JOIN leagues l ON l.id = i.league_id
    WHERE (
        i.status IN ('declined', 'cancelled', 'expired')
        AND COALESCE(i.responded_at, i.updated_at, i.sent_at, i.created_at) < now() - interval '30 days'
      )
      OR (
        i.status = 'pending'
        AND i.expires_at < now() - interval '30 days'
      )
      OR (
        i.status = 'accepted'
        AND l.status = 'completed'
        AND l.completed_at < now() - interval '30 days'
      )
    LIMIT p_batch_size
  );
  GET DIAGNOSTICS v_invitations = ROW_COUNT;

  DELETE FROM notifications
  WHERE id IN (
    SELECT id FROM notifications
    WHERE (read_at IS NOT NULL AND created_at < now() - interval '90 days')
       OR created_at < now() - interval '180 days'
    LIMIT p_batch_size
  );
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  -- The outbox's UNIQUE (channel_id, event_key) is also its dedupe: a row is
  -- only safe to drop once its league can no longer enqueue draft events.
  DELETE FROM draft_notification_outbox
  WHERE id IN (
    SELECT o.id
    FROM draft_notification_outbox o
    JOIN leagues l ON l.id = o.league_id
    WHERE l.status IN ('active', 'completed')
      AND (
        (o.status IN ('sent', 'skipped') AND COALESCE(o.delivered_at, o.created_at) < now() - interval '7 days')
        OR (o.status = 'failed' AND o.created_at < now() - interval '30 days')
      )
    LIMIT p_batch_size
  );
  GET DIAGNOSTICS v_outbox = ROW_COUNT;

  -- These rows stop release-day, notable-miss and season-end posts from being
  -- sent twice, so they stay for as long as their season can still post.
  DELETE FROM discord_notification_log
  WHERE id IN (
    SELECT d.id
    FROM discord_notification_log d
    JOIN leagues l ON l.id = d.league_id
    WHERE l.status = 'completed'
      AND l.completed_at < now() - interval '90 days'
      AND d.created_at < now() - interval '90 days'
    LIMIT p_batch_size
  );
  GET DIAGNOSTICS v_discord_log = ROW_COUNT;

  DELETE FROM push_outbox
  WHERE id IN (
    SELECT id FROM push_outbox
    WHERE (status <> 'pending' AND created_at < now() - interval '7 days')
       -- Never claimed (the sender has no APNs key yet): long past sending.
       OR (status = 'pending' AND created_at < now() - interval '1 day')
    LIMIT p_batch_size
  );
  GET DIAGNOSTICS v_push_outbox = ROW_COUNT;

  DELETE FROM push_devices
  WHERE id IN (
    SELECT id FROM push_devices
    WHERE last_registered_at < now() - interval '180 days'
    LIMIT p_batch_size
  );
  GET DIAGNOSTICS v_push_devices = ROW_COUNT;

  RETURN jsonb_build_object(
    'notification_log', v_notification_log,
    'invitations', v_invitations,
    'notifications', v_notifications,
    'draft_notification_outbox', v_outbox,
    'discord_notification_log', v_discord_log,
    'push_outbox', v_push_outbox,
    'push_devices', v_push_devices,
    'more_remaining', GREATEST(
      v_notification_log, v_invitations, v_notifications, v_outbox, v_discord_log, v_push_outbox, v_push_devices
    ) >= p_batch_size
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_data(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_data(integer) TO service_role;
