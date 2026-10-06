-- ============================================================================
-- Movie Projections (Beta) -- model activation
--
-- fit-projection-model stores each monthly fit as a new projection_models
-- version and makes it the active one. Both happen in one function so there
-- is never a moment with zero or two active models: the partial unique index
-- idx_projection_models_active already forbids two, and a separate
-- "deactivate, then insert" from the Edge Function could leave none if the
-- second request failed.
--
-- The version number is taken under a table lock, so two overlapping fits
-- (a manual run during the cron, say) serialize instead of colliding on the
-- primary key.
-- ============================================================================

CREATE OR REPLACE FUNCTION activate_projection_model(p_coefficients jsonb, p_metrics jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_version integer;
BEGIN
  IF p_coefficients IS NULL OR jsonb_typeof(p_coefficients) <> 'object' THEN
    RAISE EXCEPTION 'activate_projection_model: coefficients must be a JSON object';
  END IF;

  LOCK TABLE projection_models IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version FROM projection_models;

  UPDATE projection_models SET is_active = false WHERE is_active;

  INSERT INTO projection_models (version, coefficients, metrics, is_active)
  VALUES (v_version, p_coefficients, COALESCE(p_metrics, '{}'::jsonb), true);

  RETURN v_version;
END;
$$;

COMMENT ON FUNCTION activate_projection_model(jsonb, jsonb) IS 'Inserts a fitted projection model as the next version and makes it the only active one, atomically. Called by fit-projection-model (service role only).';

REVOKE ALL ON FUNCTION activate_projection_model(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION activate_projection_model(jsonb, jsonb) TO service_role;
