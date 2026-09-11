-- ============================================================================
-- series_seasons carries the final standings
--
-- The season history and profile trophy-case UIs read `series_seasons` to list
-- a series' seasons, and then need the finishing order for each completed one.
-- Without `final_standings` on the view they would have to follow up with a
-- per-season query against `leagues` -- an N+1 over exactly the rows the view
-- just returned.
--
-- A separate migration from 20260828140003 (which added the column) because
-- that one is already applied; editing it would leave the file and the
-- database silently out of step.
--
-- Dropped and recreated rather than CREATE OR REPLACE: replace can only append
-- columns to the end, and `final_standings` belongs next to `winner_team_ids`,
-- with which it is always read.
-- ============================================================================

DROP VIEW IF EXISTS series_seasons;

CREATE VIEW series_seasons
WITH (security_invoker = true) AS
  SELECT
    l.id AS league_id,
    l.series_id,
    l.season_year,
    l.name,
    l.status,
    l.season_end,
    l.completed_at,
    l.winner_team_ids,
    l.final_standings
  FROM leagues l;

COMMENT ON VIEW series_seasons IS
  'One row per season of a series, for season switchers and history views. Filter by series_id and order by season_year DESC. `final_standings` is the frozen finishing order for a completed season -- read it rather than recomputing, so a champion who later left the league still appears. RLS: inherits the leagues SELECT policy via security_invoker.';

GRANT SELECT ON series_seasons TO authenticated, service_role;
