-- ============================================================================
-- SEASON HISTORY, SERIES NAMING, AND SEASON-END TRADE EXPIRY
--
-- Three follow-ons to 20260828140000_league_seasons.sql, from the UX review:
--
--   1. A season's final standings are snapshotted onto the season row, so
--      history survives the people in it leaving.
--   2. The SERIES owns the name. `leagues.name` becomes a denormalized copy,
--      kept in step by a trigger.
--   3. Trade offers can expire because the season ended.
-- ============================================================================

-- ============================================================================
-- PART 1: final_standings -- history that outlives its participants
-- ============================================================================
--
-- `winner_team_ids` answers "who won"; it does not answer "what did the table
-- look like". Recomputing that later is not equivalent, because
-- `league_standings()` reads live `league_participants`/`teams`/`team_scores`:
-- a champion who leaves the league, or has their participant row deactivated,
-- silently drops out of their own history. The season's result is a fact about
-- a moment, so it is stored as one.
--
-- `display_name` is denormalized in for the same reason -- the profile can be
-- renamed or the account deleted, and the trophy case still has to say who won
-- the 2026 season.
-- ============================================================================

ALTER TABLE leagues ADD COLUMN final_standings JSONB;

COMMENT ON COLUMN leagues.final_standings IS
  'Snapshot of the standings at completion: array of {team_id, team_name, participant_id, user_id, display_name, total_points, rank, is_tied}, rank-ordered. Written once by completeLeague() alongside winner_team_ids. Read by history and profile UIs instead of recomputing, so a champion who later leaves the league still appears.';

-- ============================================================================
-- PART 2: the series owns the name
-- ============================================================================
--
-- "League" is the series; a season is one row under it. Renaming the league
-- therefore means renaming the SERIES, and every season has to follow --
-- otherwise the 2026 season keeps the old name forever and the history list
-- reads like two different leagues.
--
-- `leagues.name` stays as a denormalized copy rather than being dropped: it is
-- read by dozens of queries, Discord embeds, and emails that have a league_id
-- and no reason to join a second table, and dropping it would touch nearly
-- every function in the codebase for no user-visible gain. This trigger is the
-- price of that copy.
--
-- SECURITY DEFINER: the trigger is only reachable through an UPDATE on
-- league_series, which RLS already restricts to the series owner. Running as
-- definer means the sync cannot half-apply if a season's owner_id has drifted
-- from the series owner's.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_series_name_to_seasons()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE leagues
  SET name = NEW.name
  WHERE series_id = NEW.id
    AND name IS DISTINCT FROM NEW.name;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_series_name_to_seasons() FROM PUBLIC, anon, authenticated;

-- `OF name` and the WHEN clause keep this off the hot path: an updated_at
-- touch, or a rename to the same string, does not rewrite every season.
CREATE TRIGGER sync_series_name_to_seasons_trigger
  AFTER UPDATE OF name ON league_series
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION sync_series_name_to_seasons();

-- Supports the trigger's own UPDATE and every "seasons of this series" read.
-- leagues_series_season_uidx already leads with series_id, so this is only
-- documentation of intent -- no second index is created.

-- ============================================================================
-- PART 3: a trade offer can expire because the season ended
-- ============================================================================
--
-- completeLeague() expires every open offer when it closes a season: an
-- accepted-but-unprocessed trade would otherwise be executed by the next
-- process-trades run and move rosters *after* the final standings were
-- announced.
--
-- A new reason rather than reusing 'league_deadline'. They are different
-- events -- the trade deadline is a date the commissioner sets mid-season,
-- while this is the season itself ending -- and the card tells the two parties
-- which one happened.
-- ============================================================================

ALTER TABLE trade_offers DROP CONSTRAINT IF EXISTS check_expired_reason_value;

ALTER TABLE trade_offers ADD CONSTRAINT check_expired_reason_value
  CHECK (
    expired_reason IS NULL
    OR expired_reason IN ('offer_window', 'movie_released', 'league_deadline', 'season_completed')
  );
