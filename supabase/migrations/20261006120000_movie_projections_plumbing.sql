-- ============================================================================
-- Movie Projections (Beta) -- plumbing
--
-- Spec: docs/superpowers/specs/2026-08-26-movie-projections-design.md
-- (historical; CLAUDE.md "Movie Projections" describes the current design).
--
-- Adds: feature_flags (operator switches, edited in Supabase Studio's Table
-- Editor), the historical film corpus (film_corpus, film_people,
-- film_credits, film_collections), and the projection tables
-- (projection_models, movie_projections) that the model fills later.
--
-- The MDBList ledger (external_api_budgets + reserve_external_api_calls) is
-- reused from 20260827130000_external_api_budgets.sql; projections reserve
-- under their own 'mdblist:projections' key.
--
-- Access model: every table here is service-role only (RLS on, no policies).
-- The frontend never reads feature_flags or movie_projections directly;
-- projections reach clients only through an Edge Function that applies the
-- projections_display gate.
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

COMMENT ON TABLE feature_flags IS 'Operator switches. Edit in Supabase Studio -> Table Editor -> feature_flags (toggle enabled, edit config JSON). Read only by Edge Functions (service role) via _shared/feature-flags.ts; the frontend never reads it. Changes apply within ~60s, no deploy.';
COMMENT ON COLUMN feature_flags.config IS 'Free-form JSON the flag''s consumers read (e.g. daily budgets). See description per row.';

CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Service role only: no policies, so anon/authenticated see nothing.
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

INSERT INTO feature_flags (key, enabled, config, description) VALUES
  ('projections_ingestion', false,
   '{"mdblist_daily_budget": 500, "per_run_cap": 300}'::jsonb,
   'Corpus backfill (ingest-film-corpus) may spend MDBList quota under the mdblist:projections budget key. Turn ON in Supabase Studio after the first supervised run; the ingest cron is a no-op while off. Turn OFF to hand that slice back to nightly scoring. mdblist_daily_budget = MDBList calls/day ingestion may use (franchise history has its own 300; scoring is unreserved); per_run_cap = max ratings fetched per ingest run.'),
  ('projections_display', false,
   '{"series_ids": ["86de1055-23a7-4cf3-be5c-5806d029dabe"]}'::jsonb,
   'Show projected scores (Beta) to leagues. A league sees them only when enabled is true AND its series is listed in config.series_ids (omit series_ids to show every league). Turning it OFF hides projections everywhere immediately (within ~60s). Keep OFF until the backtest ship gate passes: the model must beat the genre-year baseline by 15% on held-out future years with calibrated probabilities.');

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
COMMENT ON TABLE movie_projections IS 'Cached projection per TMDb movie (Beta). Service-role only: clients read projections through get-movie-projections, which applies the projections_display gate. frozen_at/actual_rt are set by update-scores when the real Tomatometer first lands.';
COMMENT ON COLUMN movie_projections.expected_points IS 'Fantasy points integrated over the projected RT distribution -- NOT the curve applied to projected_rt.';
COMMENT ON COLUMN movie_projections.partial IS 'True while some factor''s prior films are still queued for ingestion.';

-- Service role only. The crowd-signal columns (draft_position_avg, bid_total,
-- counterpick_count) aggregate across leagues, so they must never become
-- readable by league members directly.
ALTER TABLE movie_projections ENABLE ROW LEVEL SECURITY;

-- Belt and braces on top of RLS: revoke the default table grants so a policy
-- added by mistake later still cannot expose these tables to clients.
REVOKE ALL ON feature_flags, film_corpus, film_people, film_credits, film_collections,
  projection_models, movie_projections FROM PUBLIC, anon, authenticated;
GRANT ALL ON feature_flags, film_corpus, film_people, film_credits, film_collections,
  projection_models, movie_projections TO service_role;
