-- ============================================================================
-- LEAGUE SEASONS
--
-- A league used to be a single, permanent thing. It is now two things:
--
--   * `league_series` -- the durable identity people mean when they say "my
--     league": the name they picked, the person who runs it, the thread of
--     history that spans years.
--   * `leagues` -- ONE SEASON of that series. Every season-scoped setting
--     (slots, budget, counterpick rules, trade config, draft dates) stays
--     exactly where it is, on the season row, and is copied forward on
--     rollover.
--
-- Why the split rather than a self-referencing `previous_league_id` chain:
-- reading "season N of this league" is a single indexed lookup
-- (`WHERE series_id = ? ORDER BY season_year`) instead of walking a linked
-- list. And nothing else has to move -- no FK on draft_picks, pickups,
-- trades, counterpicks, team_holdings, or any RLS helper changes, because
-- every one of them is already scoped to a season and should stay that way.
-- A 2026 roster belongs to the 2026 season, not to the series.
--
-- The seasons themselves are what completes: `completed_at` and
-- `winner_team_ids` are stamped on the season row, and stay there. A series
-- has no status of its own -- it is however many seasons deep it happens to be.
-- ============================================================================

-- ============================================================================
-- PART 1: league_series
-- ============================================================================

CREATE TABLE league_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE league_series IS
  'The durable identity of a league across seasons. Each `leagues` row is one season of a series.';
COMMENT ON COLUMN league_series.name IS
  'Series display name. `leagues.name` remains the season''s own display name and is copied forward on rollover, so renaming a series does not rewrite history.';

-- Supports the owner-scoped RLS policies below.
CREATE INDEX idx_league_series_owner_id ON league_series(owner_id);

CREATE TRIGGER update_league_series_updated_at
  BEFORE UPDATE ON league_series
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 2: leagues becomes a season
-- ============================================================================

ALTER TABLE leagues
  ADD COLUMN series_id UUID REFERENCES league_series(id) ON DELETE CASCADE,
  ADD COLUMN season_year INTEGER,
  ADD COLUMN season_end DATE,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN winner_team_ids UUID[];

COMMENT ON COLUMN leagues.series_id IS 'The series this season belongs to. Every league has one, created automatically on insert when not supplied.';
COMMENT ON COLUMN leagues.season_year IS 'The season label, e.g. 2026. Drives movie eligibility (a movie released in an earlier season is not draftable) rather than the wall-clock year.';
COMMENT ON COLUMN leagues.season_end IS 'The date the season stops scoring. The complete-seasons cron ends any active season past this date.';
COMMENT ON COLUMN leagues.completed_at IS 'Stamped once, when the season is completed. NULL while the season is still running.';
COMMENT ON COLUMN leagues.winner_team_ids IS 'Every team tied at rank 1 when the season completed -- co-champions share the title. NULL until completed.';

-- ---------------------------------------------------------------------------
-- Backfill: one series per existing league, carrying its name and owner.
-- Existing leagues have no shared history to reconstruct, so each becomes a
-- one-season series.
-- ---------------------------------------------------------------------------
-- Row by row: a data-modifying CTE cannot carry the new series id back to the
-- league it came from (INSERT ... RETURNING has no handle on the source row),
-- and pairing the two sets by row number would be a guess about ordering the
-- planner never promised. The table is small enough that the loop is free.
DO $$
DECLARE
  r RECORD;
  v_series_id UUID;
BEGIN
  FOR r IN SELECT id, name, owner_id, created_at FROM leagues WHERE series_id IS NULL LOOP
    INSERT INTO league_series (name, owner_id, created_at)
    VALUES (r.name, r.owner_id, COALESCE(r.created_at, now()))
    RETURNING id INTO v_series_id;

    UPDATE leagues SET series_id = v_series_id WHERE id = r.id;
  END LOOP;
END $$;

-- season_year: the year the draft was scheduled for, falling back to when the
-- league was created. season_end: the end of that calendar year, matching the
-- default a newly created season gets.
UPDATE leagues
SET season_year = EXTRACT(YEAR FROM COALESCE(draft_start_date, created_at, now()))::INTEGER
WHERE season_year IS NULL;

UPDATE leagues
SET season_end = make_date(season_year, 12, 31)
WHERE season_end IS NULL;

-- A completed league predating this migration has no recorded finish time;
-- its created_at is the only honest lower bound, so leave completed_at NULL
-- rather than inventing one. winner_team_ids stays NULL for the same reason --
-- final standings for those leagues are still derivable from team_scores.

ALTER TABLE leagues
  ALTER COLUMN series_id SET NOT NULL,
  ALTER COLUMN season_year SET NOT NULL,
  ALTER COLUMN season_end SET NOT NULL;

-- One season per year per series. This is what makes "next season" a
-- well-defined operation and what stops a double rollover.
CREATE UNIQUE INDEX leagues_series_season_uidx ON leagues(series_id, season_year);

-- The complete-seasons cron's only query: active seasons past their end date.
CREATE INDEX idx_leagues_active_season_end ON leagues(season_end)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Auto-create a series for any league inserted without one.
--
-- SECURITY DEFINER because league_series has no INSERT policy: series are
-- created here or by the service role, never by a client writing the table
-- directly. The row it creates is derived entirely from the league being
-- inserted, which RLS has already authorized.
--
-- Also fills season_year / season_end when absent, so `create-league` keeps
-- working untouched. COALESCE throughout: `start_next_season` supplies all
-- three explicitly and must win.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_league_series()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_series_id UUID;
BEGIN
  IF NEW.series_id IS NULL THEN
    INSERT INTO league_series (name, owner_id)
    VALUES (NEW.name, NEW.owner_id)
    RETURNING id INTO v_series_id;

    NEW.series_id := v_series_id;
  END IF;

  IF NEW.season_year IS NULL THEN
    NEW.season_year := EXTRACT(YEAR FROM COALESCE(NEW.draft_start_date, now()))::INTEGER;
  END IF;

  IF NEW.season_end IS NULL THEN
    NEW.season_end := make_date(NEW.season_year, 12, 31);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION ensure_league_series() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ensure_league_series_trigger
  BEFORE INSERT ON leagues
  FOR EACH ROW
  EXECUTE FUNCTION ensure_league_series();

-- ============================================================================
-- PART 3: RLS for league_series
-- ============================================================================

-- Membership of ANY season of the series grants read access to the series --
-- that is what makes browsing a league's history work for someone who joined
-- in year two. Mirrors is_league_member: SECURITY DEFINER to break the
-- policy recursion (league_series -> leagues -> league_participants), STABLE,
-- and auth.uid() wrapped in a subselect so it is evaluated once per query.
CREATE OR REPLACE FUNCTION is_series_member(check_series_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM league_participants lp
    JOIN leagues l ON l.id = lp.league_id
    WHERE l.series_id = check_series_id
      AND lp.user_id = (SELECT auth.uid())
      AND lp.status = 'active'
  )
$$;

ALTER TABLE league_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view series they participate in"
  ON league_series FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR is_series_member(id));

CREATE POLICY "Series owners can update their series"
  ON league_series FOR UPDATE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- No INSERT or DELETE policy: series are created by ensure_league_series()
-- and removed by the ON DELETE CASCADE from auth.users, never by a client.

-- ============================================================================
-- PART 4: league_standings -- one ranking, every consumer
-- ============================================================================
--
-- Standings were computed independently in at least three places (the
-- standings page, the Discord bot, the final-standings embed), each with its
-- own tie handling. Champions have to be decided exactly once, so this is now
-- the only ranking.
--
-- Competition ranking (1, 2, 2, 4): tied teams share a rank and the next rank
-- skips. `is_tied` says whether a row shares its rank with another, which is
-- what tells a caller to say "co-champions" instead of "champion".
--
-- SECURITY INVOKER (the default): base-table RLS on league_participants /
-- teams / team_scores applies, so a non-member gets an empty set rather than
-- another league's standings.
-- ============================================================================

CREATE OR REPLACE FUNCTION league_standings(p_league_id UUID)
RETURNS TABLE (
  team_id UUID,
  team_name TEXT,
  participant_id UUID,
  user_id UUID,
  total_points NUMERIC,
  rank INTEGER,
  is_tied BOOLEAN
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      t.id AS team_id,
      t.name::TEXT AS team_name,
      lp.id AS participant_id,
      lp.user_id,
      -- A team with no team_scores row has simply not scored yet, which is
      -- zero, not unknown. LEFT JOIN + COALESCE keeps it in the standings.
      COALESCE(ts.total_points, 0)::NUMERIC AS total_points,
      RANK() OVER (ORDER BY COALESCE(ts.total_points, 0) DESC)::INTEGER AS rank
    FROM league_participants lp
    JOIN teams t ON t.participant_id = lp.id
    LEFT JOIN team_scores ts ON ts.team_id = t.id
    WHERE lp.league_id = p_league_id
      AND lp.status = 'active'
  )
  SELECT
    r.team_id,
    r.team_name,
    r.participant_id,
    r.user_id,
    r.total_points,
    r.rank,
    COUNT(*) OVER (PARTITION BY r.rank) > 1 AS is_tied
  FROM ranked r
  ORDER BY r.rank, r.team_name;
$$;

COMMENT ON FUNCTION league_standings(UUID) IS
  'Final/current standings for one season, competition-ranked (1,2,2,4). The single source of truth for rank and for who the champion is.';

REVOKE EXECUTE ON FUNCTION league_standings(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION league_standings(UUID) TO authenticated, service_role;

-- ============================================================================
-- PART 5: series_seasons -- the season list for a series
-- ============================================================================
--
-- A view rather than the `series_seasons(p_series_id)` function the design
-- sketched: PostgREST can filter and order a view directly
-- (`?series_id=eq.<id>&order=season_year.desc`), which is what both the
-- season switcher and get-leagues want, and a view composes with other
-- filters an RPC would have to grow parameters for.
--
-- security_invoker: it exposes exactly the `leagues` rows the caller can
-- already select, so someone who joined in season two sees season two
-- onwards, not the seasons they were never part of.
-- ============================================================================

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
    l.winner_team_ids
  FROM leagues l;

COMMENT ON VIEW series_seasons IS
  'One row per season of a series, for season switchers and history views. Filter by series_id and order by season_year DESC. RLS: inherits the leagues SELECT policy via security_invoker.';

GRANT SELECT ON series_seasons TO authenticated, service_role;

-- ============================================================================
-- PART 6: movie-independent Discord notifications
-- ============================================================================
--
-- discord_notification_log was built for per-movie announcements, so movie_id
-- was NOT NULL and the unique key was (league_id, movie_id, notification_type).
-- Season events (the 7-day season-end reminder) are about the season, not a
-- movie. Making movie_id nullable lets them share the same idempotency log --
-- but NULLs are distinct in a unique constraint, so the existing constraint
-- would happily allow the same reminder twice. The partial unique index below
-- is what actually makes movie-independent events idempotent.
-- ============================================================================

ALTER TABLE discord_notification_log
  ALTER COLUMN movie_id DROP NOT NULL;

CREATE UNIQUE INDEX uq_discord_notification_log_no_movie
  ON discord_notification_log(league_id, notification_type)
  WHERE movie_id IS NULL;

COMMENT ON COLUMN discord_notification_log.movie_id IS
  'The movie the notification is about, or NULL for season-scoped events (e.g. season_end_reminder), whose uniqueness is enforced by uq_discord_notification_log_no_movie.';
