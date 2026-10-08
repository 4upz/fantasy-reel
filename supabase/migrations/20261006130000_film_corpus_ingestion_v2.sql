-- ============================================================================
-- Movie Projections (Beta) -- corpus ingestion, second pass
--
-- Widens what ingest-film-corpus stores and fixes how it chooses and re-polls
-- films (see CLAUDE.md "Movie Projections (Beta)"):
--   * pre-release features the model needs: US wide/limited/digital dates,
--     festival premiere, keyword flags, curated label, original language;
--   * rt_settled_at, so only settled Tomatometers become training labels;
--   * per-row MDBList error backoff;
--   * per-year resume state for the historical discover sweep;
--   * film_feature_snapshots: weekly pre-release features of league movies,
--     for an honest projected-vs-actual comparison later.
-- Everything stays service-role only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- film_corpus: new columns
-- ---------------------------------------------------------------------------
ALTER TABLE film_corpus
  ADD COLUMN us_wide_date        date,
  ADD COLUMN us_limited_date     date,
  ADD COLUMN us_digital_date     date,
  ADD COLUMN festival_premiere   text,
  ADD COLUMN keyword_flags       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN label_id            text,
  ADD COLUMN original_language   text,
  ADD COLUMN rt_settled_at       timestamptz,
  ADD COLUMN ratings_error_count smallint NOT NULL DEFAULT 0;

-- The date a film is judged by everywhere (release month, backtest year,
-- "earlier films only" windows, when to poll MDBList). TMDb's release_date is
-- often a festival or overseas date, so the US dates come first.
ALTER TABLE film_corpus
  ADD COLUMN effective_release_date date
  GENERATED ALWAYS AS (COALESCE(us_wide_date, us_limited_date, us_digital_date, release_date)) STORED;

ALTER TABLE film_corpus
  ADD CONSTRAINT film_corpus_keyword_flags_check
  CHECK (keyword_flags <@ ARRAY['adaptation', 'remake', 'sequel', 'true_story']::text[]);
ALTER TABLE film_corpus
  ADD CONSTRAINT film_corpus_festival_premiere_check
  CHECK (festival_premiere IN ('cannes', 'venice', 'tiff', 'sundance', 'berlin', 'telluride', 'sxsw'));

-- League movies are now seeded from rosters and wishlists, not the movies
-- table: name the two sources instead of 'upcoming'.
ALTER TABLE film_corpus DROP CONSTRAINT film_corpus_seed_source_check;
UPDATE film_corpus SET seed_source = 'league' WHERE seed_source = 'upcoming';
ALTER TABLE film_corpus
  ADD CONSTRAINT film_corpus_seed_source_check
  CHECK (seed_source IN ('discover', 'person', 'collection', 'league', 'wishlist'));

COMMENT ON COLUMN film_corpus.release_date IS 'TMDb primary release date. Often a festival or overseas date: use effective_release_date for anything time-based.';
COMMENT ON COLUMN film_corpus.us_wide_date IS 'Earliest US wide theatrical (TMDb release type 3) date.';
COMMENT ON COLUMN film_corpus.us_limited_date IS 'Earliest US limited theatrical (type 2) date.';
COMMENT ON COLUMN film_corpus.us_digital_date IS 'Earliest US digital (type 4) date: the release date of a streaming premiere.';
COMMENT ON COLUMN film_corpus.effective_release_date IS 'us_wide_date, else us_limited_date, else us_digital_date, else release_date. The date release month, backtest years, and earlier-films-only windows use.';
COMMENT ON COLUMN film_corpus.festival_premiere IS 'Festival the film screened at before its US release (cannes, venice, tiff, sundance, berlin, telluride, sxsw), from TMDb release-date notes. NULL = none known.';
COMMENT ON COLUMN film_corpus.keyword_flags IS 'Subset of adaptation, remake, sequel, true_story, from TMDb keywords.';
COMMENT ON COLUMN film_corpus.label_id IS 'Curated distributor/label key (_shared/film-labels.ts), ''other'' for unlisted companies, NULL when TMDb lists none.';
COMMENT ON COLUMN film_corpus.original_language IS 'TMDb original_language (ISO 639-1).';
COMMENT ON COLUMN film_corpus.rt_settled_at IS 'Set when the Tomatometer stopped being an early score: at least 20 reviews and 60+ days past effective_release_date. Training labels use only settled rows.';
COMMENT ON COLUMN film_corpus.ratings_error_count IS 'Consecutive transient MDBList failures; a failing row is retried every few days, up to a cap, instead of every run.';
COMMENT ON COLUMN film_corpus.vote_count IS 'TMDb vote count, captured after release for historical films. Seeding only: never a model feature.';
COMMENT ON COLUMN film_corpus.vote_average IS 'TMDb vote average, captured after release for historical films. Never a model feature.';
COMMENT ON COLUMN film_corpus.seed_source IS 'How the row entered: discover (historical sweep), person (a credited person''s prior film), collection (a franchise entry), league (on a roster), wishlist (on an active player''s wishlist).';
COMMENT ON COLUMN film_corpus.priority IS 'Fetch order, higher first. 100 = on a roster or active wishlist (expanded one level, metadata refreshed weekly until release), 50 = predecessor of one (never expanded), 0 = historical sweep.';

-- Queue indexes on the date the handler orders by.
DROP INDEX idx_film_corpus_needs_metadata;
DROP INDEX idx_film_corpus_needs_ratings;
DROP INDEX idx_film_corpus_release_date;
CREATE INDEX idx_film_corpus_needs_metadata ON film_corpus (priority DESC, effective_release_date DESC NULLS LAST)
  WHERE metadata_fetched_at IS NULL;
CREATE INDEX idx_film_corpus_needs_ratings ON film_corpus (priority DESC, effective_release_date DESC NULLS LAST)
  WHERE ratings_fetched_at IS NULL AND metadata_fetched_at IS NOT NULL;
CREATE INDEX idx_film_corpus_unsettled ON film_corpus (effective_release_date)
  WHERE rt_settled_at IS NULL AND ratings_fetched_at IS NOT NULL;
CREATE INDEX idx_film_corpus_effective_release_date ON film_corpus (effective_release_date);
CREATE INDEX idx_film_corpus_league ON film_corpus (metadata_fetched_at) WHERE priority >= 100;

-- ---------------------------------------------------------------------------
-- Historical sweep resume state, one row per discover year
-- ---------------------------------------------------------------------------
CREATE TABLE film_corpus_seed_progress (
  year          smallint PRIMARY KEY,
  next_page     integer NOT NULL DEFAULT 1 CHECK (next_page >= 1),
  total_pages   integer,
  total_results integer,
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE film_corpus_seed_progress IS 'ingest-film-corpus discover sweep: the next page to fetch per year, and when the year last finished. Recent years are re-swept weekly. Service-role only.';
CREATE TRIGGER update_film_corpus_seed_progress_updated_at
  BEFORE UPDATE ON film_corpus_seed_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE film_corpus_seed_progress ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Weekly pre-release feature snapshots of league movies
-- ---------------------------------------------------------------------------
CREATE TABLE film_feature_snapshots (
  tmdb_id                integer NOT NULL REFERENCES film_corpus(tmdb_id) ON DELETE CASCADE,
  week                   date NOT NULL,
  effective_release_date date,
  features               jsonb NOT NULL,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tmdb_id, week)
);
COMMENT ON TABLE film_feature_snapshots IS 'What ingest-film-corpus knew about a league movie each week (week = Monday, UTC) before release: dates, label, festival, keywords, credits. Lets projections be scored by lead time against what was knowable then. Service-role only.';
COMMENT ON COLUMN film_feature_snapshots.features IS 'film_corpus pre-release columns plus credits [{tmdb_person_id, role, billing}] at capture time.';
ALTER TABLE film_feature_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON film_corpus_seed_progress, film_feature_snapshots FROM PUBLIC, anon, authenticated;
GRANT ALL ON film_corpus_seed_progress, film_feature_snapshots TO service_role;

-- ---------------------------------------------------------------------------
-- Quota plan: ~460 MDBList calls/day across three runs, 150 always spare
-- ---------------------------------------------------------------------------
UPDATE feature_flags
SET config = '{"mdblist_daily_budget": 460, "per_run_cap": 160}'::jsonb,
    description = 'Corpus backfill (ingest-film-corpus, three runs a day) may spend MDBList quota under the mdblist:projections budget key. Turn ON in Supabase Studio after the first supervised run; the ingest cron is a no-op while off. Turn OFF to hand that slice back to scoring and franchise history. mdblist_daily_budget = MDBList calls/day ingestion may use; per_run_cap = max ratings fetched per run. Ingestion always leaves 150 calls of the account''s daily cap unspent, and spends nothing when MDBList''s usage counter cannot be read.'
WHERE key = 'projections_ingestion';
