-- ============================================================================
-- Movie Projections (Beta) -- plumbing
--
-- Spec: docs/superpowers/specs/2026-08-26-movie-projections-design.md
--
-- Adds: feature_flags (operator switches, edited in Supabase Studio's Table
-- Editor), the historical film corpus (film_corpus, film_people,
-- film_credits, film_collections), the projection tables
-- (projection_models, movie_projections) that Phase 2 fills, and an
-- IDEMPOTENT copy of external_api_budgets + reserve_external_api_calls()
-- from PR #72 (20260827130000_external_api_budgets.sql) so this migration
-- works whether it lands before or after that one.
--
-- Access model: feature_flags and movie_projections are readable by any
-- signed-in user (nothing league-specific in them); everything else is
-- service-role only (RLS on, no policies).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- feature_flags
-- ---------------------------------------------------------------------------
CREATE TABLE feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE feature_flags IS 'Operator switches. Edit in Supabase Studio -> Table Editor -> feature_flags (toggle enabled, edit config JSON). Read by Edge Functions via _shared/feature-flags.ts and by the frontend via hooks/useFeatureFlag.ts. Changes apply within ~60s, no deploy.';
COMMENT ON COLUMN feature_flags.config IS 'Free-form JSON the flag''s consumers read (e.g. daily budgets). See description per row.';

CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feature flags"
  ON feature_flags FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage feature flags"
  ON feature_flags FOR ALL USING (auth.role() = 'service_role');

INSERT INTO feature_flags (key, enabled, config, description) VALUES
  ('projections_ingestion', false,
   '{"mdblist_daily_budget": 500, "per_run_cap": 300}'::jsonb,
   'Corpus backfill (ingest-film-corpus) and pre-release score polling (update-scores) may spend MDBList quota under the mdblist:projections budget key. Turn ON in Supabase Studio after the first supervised run; the ingest cron is a no-op while off. Turn OFF to hand that slice back to nightly scoring. mdblist_daily_budget = MDBList calls/day these two jobs may use (franchise history has its own 300; scoring is unreserved); per_run_cap = max ratings fetched per ingest run.'),
  ('projections_display', false,
   '{}'::jsonb,
   'Show projected scores (Beta) in the app. Keep OFF until the backtest gate in the projections spec (Spearman >= 0.40, MAE <= 16) has passed.');

-- ---------------------------------------------------------------------------
-- external_api_budgets + reserve_external_api_calls -- IDEMPOTENT COPY of
-- PR #72's 20260827130000_external_api_budgets.sql. Keep byte-identical to
-- that file's definitions; whichever migration runs second is a no-op.
-- Projections reserve under the key 'mdblist:projections'; franchise history
-- under 'mdblist:franchise-history'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_api_budgets (
  api        text NOT NULL,
  day        date NOT NULL,
  calls      integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api, day)
);

COMMENT ON TABLE external_api_budgets IS
  'Calls reserved per third-party API per UTC day; see reserve_external_api_calls()';

ALTER TABLE external_api_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON external_api_budgets FROM PUBLIC, anon, authenticated;
GRANT ALL ON external_api_budgets TO service_role;

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

-- ---------------------------------------------------------------------------
-- Historical film corpus
-- ---------------------------------------------------------------------------
CREATE TABLE film_corpus (
  tmdb_id             integer PRIMARY KEY,
  title               text NOT NULL,
  release_date        date,
  collection_id       integer,
  genre_ids           integer[] NOT NULL DEFAULT '{}',
  company_ids         integer[] NOT NULL DEFAULT '{}',
  budget              bigint,
  runtime             integer,
  certification       text,
  us_release_type     smallint,
  vote_average        numeric(3,1),
  vote_count          integer,
  rt_critic           smallint,
  rt_critic_votes     integer,
  metacritic          smallint,
  imdb                numeric(3,1),
  metadata_fetched_at timestamptz,
  ratings_fetched_at  timestamptz,
  ratings_absent      boolean NOT NULL DEFAULT false,
  seed_source         text NOT NULL CHECK (seed_source IN ('discover', 'person', 'collection', 'upcoming')),
  priority            smallint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE film_corpus IS 'Historical films (TMDb metadata + MDBList ratings) the projection model learns from. Separate from movies on purpose: most rows are never in any league. Service-role only.';
COMMENT ON COLUMN film_corpus.us_release_type IS 'TMDb US release type: 3 = wide theatrical, 2 = limited, others as TMDb defines.';
COMMENT ON COLUMN film_corpus.rt_critic IS 'Tomatometer 0-100 from MDBList source "tomatoes". NULL until ratings_fetched_at is set; stays NULL with ratings_absent = true when MDBList has none.';
COMMENT ON COLUMN film_corpus.ratings_absent IS 'MDBList returned 404 or no Tomatometer. Stamped so the row is never re-fetched.';
COMMENT ON COLUMN film_corpus.seed_source IS 'How the row entered: discover (historical wide-release sweep), person (a credited person''s prior film), collection (a franchise entry), upcoming (a movie in a league).';
COMMENT ON COLUMN film_corpus.priority IS 'Fetch order, higher first. 100 = in a league now, 50 = predecessor of one, 0 = historical sweep.';

CREATE INDEX idx_film_corpus_needs_metadata ON film_corpus (priority DESC, release_date DESC NULLS LAST)
  WHERE metadata_fetched_at IS NULL;
CREATE INDEX idx_film_corpus_needs_ratings ON film_corpus (priority DESC, release_date DESC NULLS LAST)
  WHERE ratings_fetched_at IS NULL AND metadata_fetched_at IS NOT NULL;
CREATE INDEX idx_film_corpus_collection ON film_corpus (collection_id) WHERE collection_id IS NOT NULL;
CREATE INDEX idx_film_corpus_release_date ON film_corpus (release_date);

ALTER TABLE film_corpus ENABLE ROW LEVEL SECURITY;
-- No policies defined: only the service role (which bypasses RLS) may access this table.

CREATE TABLE film_people (
  tmdb_person_id     integer PRIMARY KEY,
  name               text NOT NULL,
  credits_fetched_at timestamptz
);
COMMENT ON TABLE film_people IS 'Directors, writers, and top-billed cast referenced by film_credits. credits_fetched_at marks that /person/{id}/movie_credits has seeded their prior films. Service-role only.';
ALTER TABLE film_people ENABLE ROW LEVEL SECURITY;

CREATE TABLE film_credits (
  tmdb_id        integer NOT NULL REFERENCES film_corpus(tmdb_id) ON DELETE CASCADE,
  tmdb_person_id integer NOT NULL REFERENCES film_people(tmdb_person_id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('director', 'writer', 'cast')),
  billing        smallint,
  PRIMARY KEY (tmdb_id, tmdb_person_id, role)
);
COMMENT ON COLUMN film_credits.billing IS 'Cast order from TMDb (0 = top billing). NULL for director/writer.';
CREATE INDEX idx_film_credits_person ON film_credits (tmdb_person_id, role);
ALTER TABLE film_credits ENABLE ROW LEVEL SECURITY;

CREATE TABLE film_collections (
  collection_id    integer PRIMARY KEY,
  name             text NOT NULL,
  parts_fetched_at timestamptz
);
COMMENT ON TABLE film_collections IS 'TMDb collections (franchises). parts_fetched_at marks that every part has been seeded into film_corpus. Service-role only.';
ALTER TABLE film_collections ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Projections (filled by Phase 2; created now so the schema ships once)
-- ---------------------------------------------------------------------------
CREATE TABLE projection_models (
  version      integer PRIMARY KEY,
  fitted_at    timestamptz NOT NULL DEFAULT now(),
  coefficients jsonb NOT NULL,
  metrics      jsonb NOT NULL,
  is_active    boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE projection_models IS 'Fitted projection coefficients + backtest metrics per version. Exactly one row is_active. Service-role only.';
CREATE UNIQUE INDEX idx_projection_models_active ON projection_models (is_active) WHERE is_active;
ALTER TABLE projection_models ENABLE ROW LEVEL SECURITY;

CREATE TABLE movie_projections (
  tmdb_id            integer PRIMARY KEY,
  model_version      integer NOT NULL REFERENCES projection_models(version),
  projected_rt       numeric(4,1) NOT NULL,
  sigma              numeric(4,1) NOT NULL,
  p_rotten           numeric(4,3) NOT NULL,
  p_fresh            numeric(4,3) NOT NULL,
  p_club90           numeric(4,3) NOT NULL,
  expected_points    numeric(6,2) NOT NULL,
  factors            jsonb NOT NULL,
  coverage           numeric(3,2) NOT NULL,
  partial            boolean NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  frozen_at          timestamptz,
  actual_rt          smallint,
  draft_position_avg numeric(5,2),
  bid_total          integer,
  counterpick_count  integer,
  signals_updated_at timestamptz
);
COMMENT ON TABLE movie_projections IS 'Cached projection per TMDb movie (Beta). Readable by any signed-in user; written by Edge Functions only. frozen_at/actual_rt are set by update-scores when the real Tomatometer first lands.';
COMMENT ON COLUMN movie_projections.expected_points IS 'Fantasy points integrated over the projected RT distribution -- NOT the curve applied to projected_rt.';
COMMENT ON COLUMN movie_projections.partial IS 'True while some factor''s prior films are still queued for ingestion.';

ALTER TABLE movie_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read projections"
  ON movie_projections FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage projections"
  ON movie_projections FOR ALL USING (auth.role() = 'service_role');
