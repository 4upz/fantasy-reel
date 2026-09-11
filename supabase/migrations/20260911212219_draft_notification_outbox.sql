-- Delivery is durable and outside the request that commits a pick. Each channel
-- is tracked separately so retrying a failed webhook does not resend successes.
CREATE TABLE public.draft_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.discord_channels(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('draft_started', 'draft_pick', 'league_activated')),
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (channel_id, event_key)
);
CREATE INDEX draft_notification_pending ON public.draft_notification_outbox(available_at, created_at)
  WHERE status = 'pending';
CREATE INDEX draft_notification_league ON public.draft_notification_outbox(league_id);
CREATE INDEX draft_notification_channel_order ON public.draft_notification_outbox(channel_id, sequence)
  WHERE status = 'pending';
ALTER TABLE public.draft_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.draft_notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.draft_notification_outbox TO service_role;

CREATE FUNCTION public.enqueue_draft_notification(
  p_league_id UUID, p_event_key TEXT, p_kind TEXT, p_payload JSONB DEFAULT '{}'
) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.draft_notification_outbox (league_id, channel_id, event_key, kind, payload)
  SELECT p_league_id, id, p_event_key, p_kind, p_payload FROM public.discord_channels
  WHERE league_id = p_league_id AND enabled = TRUE AND notify_drafts = TRUE
  ON CONFLICT (channel_id, event_key) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.enqueue_draft_notification(UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.claim_draft_notifications(p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.draft_notification_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH ready AS (
    SELECT candidate.id FROM public.draft_notification_outbox candidate
    WHERE candidate.status = 'pending' AND candidate.available_at <= now()
      AND (candidate.leased_until IS NULL OR candidate.leased_until < now())
      AND NOT EXISTS (
        SELECT 1 FROM public.draft_notification_outbox earlier
        WHERE earlier.channel_id = candidate.channel_id AND earlier.status = 'pending'
          AND earlier.sequence < candidate.sequence
      )
    ORDER BY candidate.sequence FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(p_limit, 20))
  )
  UPDATE public.draft_notification_outbox o
  SET attempts = attempts + 1, lease_token = gen_random_uuid(), leased_until = now() + interval '2 minutes'
  FROM ready WHERE o.id = ready.id RETURNING o.*;
$$;
REVOKE ALL ON FUNCTION public.claim_draft_notifications(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_draft_notifications(INTEGER) TO service_role;

CREATE FUNCTION public.finish_draft_notification(p_id UUID, p_lease_token UUID, p_outcome TEXT, p_error TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_outcome NOT IN ('sent', 'skipped', 'retry') THEN
    RAISE EXCEPTION 'Invalid delivery outcome';
  END IF;
  UPDATE public.draft_notification_outbox
  SET status = CASE WHEN p_outcome = 'retry' THEN CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END ELSE p_outcome END,
      delivered_at = CASE WHEN p_outcome IN ('sent', 'skipped') THEN now() ELSE NULL END,
      available_at = now() + make_interval(secs => least(900, 30 * power(2, least(attempts, 5))::INTEGER)),
      lease_token = NULL, leased_until = NULL, last_error = left(p_error, 500)
  WHERE id = p_id AND lease_token = p_lease_token AND status = 'pending';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_draft_notification(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_draft_notification(UUID, UUID, TEXT, TEXT) TO service_role;
