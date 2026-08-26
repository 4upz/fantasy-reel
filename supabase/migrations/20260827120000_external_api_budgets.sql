-- Daily call budgets for third-party APIs with a hard quota.
--
-- MDBList allows ~1000 requests/day and the nightly score sync depends on
-- them. Franchise history (get-franchise-history) looks up Tomatometers for
-- films that are not on anyone's roster, driven by user browsing rather than a
-- schedule, so it needs a ceiling of its own that cannot starve scoring.
--
-- One row per (api, UTC day). reserve_external_api_calls() hands out calls
-- atomically under a row lock, so concurrent Edge Function invocations cannot
-- collectively overshoot the limit.

CREATE TABLE external_api_budgets (
  api        text NOT NULL,
  day        date NOT NULL,
  calls      integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api, day)
);

COMMENT ON TABLE external_api_budgets IS
  'Calls reserved per third-party API per UTC day; see reserve_external_api_calls()';

-- Service role only: no policies, so anon/authenticated see nothing.
ALTER TABLE external_api_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON external_api_budgets FROM PUBLIC, anon, authenticated;
GRANT ALL ON external_api_budgets TO service_role;

-- Reserves up to p_requested calls against today's budget for p_api, never
-- letting the day's total pass p_daily_limit. Returns how many were granted
-- (0 when the budget is spent). The caller decides what to do with fewer than
-- it asked for.
CREATE OR REPLACE FUNCTION reserve_external_api_calls(
  p_api text,
  p_requested integer,
  p_daily_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_before integer;
  v_after integer;
BEGIN
  IF p_requested IS NULL OR p_requested <= 0 OR p_daily_limit IS NULL OR p_daily_limit <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO external_api_budgets (api, day)
  VALUES (p_api, v_day)
  ON CONFLICT (api, day) DO NOTHING;

  SELECT calls INTO v_before
  FROM external_api_budgets
  WHERE api = p_api AND day = v_day
  FOR UPDATE;

  -- Never write a total lower than what has already been spent: a limit
  -- lowered mid-day must grant nothing, not rewrite the day's history.
  v_after := GREATEST(v_before, LEAST(p_daily_limit, v_before + p_requested));

  UPDATE external_api_budgets
  SET calls = v_after, updated_at = now()
  WHERE api = p_api AND day = v_day;

  RETURN GREATEST(v_after - v_before, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION reserve_external_api_calls(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_external_api_calls(text, integer, integer) TO service_role;
