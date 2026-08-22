-- ============================================================================
-- TMDb Response Cache
--
-- Keyed store of already-transformed TMDb responses (movie details, discover
-- browse pages, trending pages, search pages). The three read-only TMDb Edge
-- Functions -- get-movie-details, browse-movies, search-movies -- serve from
-- here whenever a row is still fresh, so repeated draft-board browsing and
-- typeahead searching cost one TMDb call per key per TTL instead of one per
-- request. An expired row is also kept as a fallback: when TMDb itself fails
-- (rate limit, outage), the stale payload is served rather than an error.
--
-- Service-role-only: RLS is enabled with no policies, so only Edge Functions
-- using the service role client can read or write this table. Nothing here is
-- user data -- it is public TMDb content -- but it is written on behalf of
-- every user and must never be client-writable.
--
-- RETENTION: TMDb's API terms permit caching but forbid retaining their data
-- beyond 6 months. Rows are purged well inside that: the nightly
-- sync-release-dates cron deletes anything with fetched_at older than 90
-- days (see purgeStaleTmdbCache in supabase/functions/_shared/tmdb-cache.ts).
-- Do not raise that retention past 6 months.
-- ============================================================================

CREATE TABLE tmdb_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

COMMENT ON TABLE tmdb_cache IS 'Cached TMDb API responses (already transformed into the shape the Edge Functions return). Service-role only. TMDb terms forbid retaining their data beyond 6 months; the sync-release-dates nightly cron purges rows with fetched_at older than 90 days.';
COMMENT ON COLUMN tmdb_cache.cache_key IS 'Canonical key: a namespace prefix, a colon, then k=v pairs joined by & and sorted by key. For browse and search the pairs are derived from the TMDb request URL''s own query string (with normalized overrides, e.g. a lowercased search query), so every param that reaches TMDb is in the key by construction. Real examples: movie_details:tmdb_id=1234, search:include_adult=false&language=en-US&page=2&query=dune, browse:page=1&today=2026-08-18&trending=true.';
COMMENT ON COLUMN tmdb_cache.payload IS 'The transformed response body served to clients verbatim on a cache hit.';
COMMENT ON COLUMN tmdb_cache.fetched_at IS 'When TMDb was last called for this key. Drives the 90-day retention purge, NOT freshness -- use expires_at for that.';
COMMENT ON COLUMN tmdb_cache.expires_at IS 'Freshness deadline. Past this the row is stale: refetched on the next request, but still served as a fallback if that refetch fails.';

-- Supports the retention purge (`WHERE fetched_at < cutoff`); the freshness
-- check is a PK lookup, so expires_at needs no index of its own.
CREATE INDEX idx_tmdb_cache_fetched_at ON tmdb_cache(fetched_at);

ALTER TABLE tmdb_cache ENABLE ROW LEVEL SECURITY;
-- No policies defined: only the service role (which bypasses RLS) may access this table.
