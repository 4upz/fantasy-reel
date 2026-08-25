-- ============================================================================
-- Rescore a team the moment a holding is dropped
-- ============================================================================
--
-- Until now a drop could never change a team's score: `drop-movie` refused any
-- movie whose release date had passed, so everything droppable was still
-- unscored (`movies.fantasy_points IS NULL`). Nothing needed to recalculate.
--
-- Released movies are now droppable (Fantasy Critic allows it, and it is what
-- makes a drop allowance a real decision: spending one can retire a flop's
-- penalty). That breaks the old assumption -- a drop can now remove points that
-- are already banked, and `team_scores` would keep showing them.
--
-- `recalculate_teams_for_movie()` cannot cover this. It fans out from a movie
-- whose *score* changed, to that movie's current holders; a drop changes who
-- holds the movie while its score stands still, so that path never fires.
--
-- The recalculation therefore hangs off the `dropped_at` transition itself
-- rather than off any one caller. Three code paths release a holding today --
-- `drop-movie`, `process-bids` cashing a conditional drop, and the occasional
-- admin script -- and a fourth would otherwise be one more place to forget.
--
-- Counterpicks are deliberately untouched: a counterpick keeps scoring its
-- inverted points after the underlying movie is dropped (see
-- `recalculate_team_score_with_counterpicks`), so only the dropping team's
-- total moves.
--
-- No backfill: no released movie has ever been droppable, so no stored score
-- can be stale from a past drop.
-- ============================================================================

CREATE OR REPLACE FUNCTION rescore_team_on_holding_drop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Symmetric on purpose: an admin restoring a holding (`dropped_at` back to
    -- NULL) has to put the points back too.
    PERFORM recalculate_team_score_with_counterpicks(NEW.team_id);
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION rescore_team_on_holding_drop() IS
'AFTER UPDATE trigger: recalculates the holder''s score whenever a draft pick or pickup is dropped or restored. Dropping a released movie removes points that are already banked, and no score-driven recalculation would otherwise notice.';

-- A trigger function is not callable in a useful way, but PUBLIC EXECUTE is the
-- default for every function and this one is SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION rescore_team_on_holding_drop() FROM PUBLIC;

DROP TRIGGER IF EXISTS trigger_rescore_on_draft_pick_drop ON draft_picks;
CREATE TRIGGER trigger_rescore_on_draft_pick_drop
AFTER UPDATE OF dropped_at ON draft_picks
FOR EACH ROW
WHEN (OLD.dropped_at IS DISTINCT FROM NEW.dropped_at)
EXECUTE FUNCTION rescore_team_on_holding_drop();

DROP TRIGGER IF EXISTS trigger_rescore_on_pickup_drop ON pickups;
CREATE TRIGGER trigger_rescore_on_pickup_drop
AFTER UPDATE OF dropped_at ON pickups
FOR EACH ROW
WHEN (OLD.dropped_at IS DISTINCT FROM NEW.dropped_at)
EXECUTE FUNCTION rescore_team_on_holding_drop();
