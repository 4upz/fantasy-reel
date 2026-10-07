-- Data retention (review finding D6) and a season-recap email opt-out (D14).
--
-- 1. purge_expired_data(): deletes rows that hold personal data once nothing
--    reads them any more. Called daily by the purge-expired-data Edge Function
--    (Vercel Cron -> /api/cron/purge-expired-data). Windows:
--      notification_log            90 days (delivery records, recipient emails)
--      invitations                 30 days after they die (declined, cancelled,
--                                  expired, or pending past expires_at); accepted
--                                  ones 30 days after their season completes
--      notifications (in-app)      90 days once read, 180 days if never read
--      draft_notification_outbox   7 days after delivery (30 if it failed), only
--                                  once the league's draft is over
--      discord_notification_log    90 days, only once the season is completed
--    job_runs is already bounded at 90 days by sync-release-dates
--    (purgeOldJobRuns), and rate_limit_counters prunes itself on every use.
--
--    What is never deleted: open invitations (the invite limit counts them),
--    undelivered outbox rows, and the Discord idempotency rows of a season
--    still running -- deleting one of those would re-post an announcement.
--
-- 2. email_preferences: one row per user who has a preference or has been
--    sent a season recap email. The unsubscribe token in it backs the
--    List-Unsubscribe header and the footer link; it is never readable by
--    clients.

-- ============================================================================
-- 1. Retention purge
-- ============================================================================

-- Deletes at most p_batch_size rows per table per call, so one run stays well
-- inside the statement timeout even on the first pass over a large backlog.
-- Anything left over goes on the next daily run; `more_remaining` says so.
CREATE FUNCTION public.purge_expired_data(p_batch_size integer DEFAULT 5000)
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

  RETURN jsonb_build_object(
    'notification_log', v_notification_log,
    'invitations', v_invitations,
    'notifications', v_notifications,
    'draft_notification_outbox', v_outbox,
    'discord_notification_log', v_discord_log,
    'more_remaining', GREATEST(v_notification_log, v_invitations, v_notifications, v_outbox, v_discord_log) >= p_batch_size
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_data(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_data(integer) TO service_role;

COMMENT ON FUNCTION public.purge_expired_data(integer) IS
  'Daily retention purge (finding D6). Service role only; run by the purge-expired-data cron. Never deletes open invitations, undelivered outbox rows, or Discord dedupe rows of a season that can still post.';

-- Supports the notifications purge; the existing indexes are all per user.
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications (created_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_created_at ON public.notification_log (created_at);

-- ============================================================================
-- 2. Email preferences
-- ============================================================================

CREATE TABLE public.email_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The end-of-season final standings email. Every other email the app sends
  -- is a direct response to something the user or their league did.
  season_recap_emails boolean NOT NULL DEFAULT true,
  unsubscribe_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_email_preferences_updated_at
  BEFORE UPDATE ON public.email_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;

-- Clients may read and set their own preference, never the token: possession
-- of the token is what lets an unsigned-in request unsubscribe someone.
REVOKE ALL ON TABLE public.email_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT (user_id, season_recap_emails, updated_at) ON public.email_preferences TO authenticated;
GRANT INSERT (user_id, season_recap_emails) ON public.email_preferences TO authenticated;
GRANT UPDATE (user_id, season_recap_emails) ON public.email_preferences TO authenticated;
GRANT ALL ON TABLE public.email_preferences TO service_role;

CREATE POLICY "Users can view their own email preferences"
  ON public.email_preferences FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can create their own email preferences"
  ON public.email_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own email preferences"
  ON public.email_preferences FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Preferences and unsubscribe tokens for a set of recipients, creating the
-- default row (opted in, fresh token) for anyone who has none yet. Used by the
-- season recap sender, which needs a token for every email it sends.
CREATE FUNCTION public.ensure_email_preferences(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, season_recap_emails boolean, unsubscribe_token uuid)
LANGUAGE sql
-- Definer so the insert can filter on auth.users itself, which service_role
-- can't read: an id whose account is gone (a profile can outlive its user) is
-- skipped instead of failing the FK and dropping every recipient's email.
-- Execute is service_role only.
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH inserted AS (
    INSERT INTO public.email_preferences (user_id)
    SELECT DISTINCT u.id
    FROM unnest(p_user_ids) AS ids(id)
    JOIN auth.users u ON u.id = ids.id
    ON CONFLICT (user_id) DO NOTHING
    RETURNING email_preferences.user_id, email_preferences.season_recap_emails, email_preferences.unsubscribe_token
  )
  SELECT * FROM inserted
  UNION ALL
  SELECT p.user_id, p.season_recap_emails, p.unsubscribe_token
  FROM public.email_preferences p
  WHERE p.user_id = ANY (p_user_ids);
$$;

REVOKE ALL ON FUNCTION public.ensure_email_preferences(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_email_preferences(uuid[]) TO service_role;
