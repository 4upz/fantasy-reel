-- Per-subject fixed-window rate limits for Edge Functions.
--
-- Edge Functions call consume_rate_limit() (service role) right before doing
-- something costly on a user's behalf, e.g. sending an invitation email. The
-- first use is send-invite / resend-invitation: unlimited invites could burn
-- the Resend quota that Supabase Auth's confirmation and reset emails share.
-- See supabase/functions/_shared/rate-limit.ts.

CREATE TABLE public.rate_limit_counters (
  bucket text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  PRIMARY KEY (bucket, subject, window_start)
);

CREATE INDEX idx_rate_limit_counters_expires_at ON public.rate_limit_counters (expires_at);

-- Service role only. Data API default privileges would otherwise hand clients
-- full DML here (20260805190000_restore_data_api_default_grants).
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_counters TO service_role;

-- Counts one use of (bucket, subject) in the current window and reports
-- whether it was within p_max. A refused call is not counted, so a caller who
-- keeps retrying past the limit does not push the reset further out. Windows
-- are aligned to the epoch (a 1-day window resets at 00:00 UTC).
CREATE FUNCTION public.consume_rate_limit(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window_seconds integer
)
RETURNS TABLE (allowed boolean, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_count integer;
BEGIN
  IF p_max IS NULL OR p_max < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'consume_rate_limit: p_max and p_window_seconds must be positive';
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  -- Expired windows are never read again; dropping them keeps the table small.
  DELETE FROM rate_limit_counters WHERE expires_at < now();

  INSERT INTO rate_limit_counters AS c (bucket, subject, window_start, expires_at, count)
  VALUES (p_bucket, p_subject, v_window_start, v_window_end, 1)
  ON CONFLICT (bucket, subject, window_start)
    DO UPDATE SET count = c.count + 1
    WHERE c.count < p_max
  RETURNING c.count INTO v_count;

  IF v_count IS NULL THEN
    RETURN QUERY SELECT
      false,
      0,
      GREATEST(1, ceil(extract(epoch FROM (v_window_end - now())))::integer);
  ELSE
    RETURN QUERY SELECT true, p_max - v_count, 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, text, integer, integer) TO service_role;
