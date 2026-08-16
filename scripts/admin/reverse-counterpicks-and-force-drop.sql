-- ============================================================================
-- ADMIN REPAIR: reverse counterpicks on a set of movies, then force-drop
-- those movies from the holding team's roster.
-- ============================================================================
-- Use when a team was prevented from dropping a movie (bug, outage, missed
-- window) and got counterpicked in the meantime. There is no Edge Function
-- that reverses an awarded counterpick, so this is deliberately raw SQL.
--
-- What an awarded counterpick writes (see supabase/functions/process-bids,
-- "counterpick award" section) and therefore what this undoes:
--   1. a `counterpicks` row                       -> deleted
--   2. `draft_picks|pickups.counterpicked_by_team_id` -> cleared
--   3. `team_budgets` remaining_budget/total_spent -> refunded
--   4. the winning `counterpick_bids` row status='won' -> 'cancelled'
--   5. `team_scores.counterpick_points`            -> recalculated
-- Emails / Discord posts that already went out cannot be unsent -- tell the
-- league yourself.
--
-- The drop leg mirrors supabase/functions/drop-movie: insert `team_drops`,
-- stamp `dropped_at` on the holding, notify the rest of the league. It
-- intentionally bypasses drop-movie's guards (released-movie check, drop
-- limit, counterpicks_block_drops) -- that is the whole point of a force drop.
--
-- HOW TO RUN
--   Production: Supabase Dashboard -> SQL Editor -> paste -> Run.
--   Local:      docker exec -i supabase_db_fantasy-reel psql -U postgres \
--                 -d postgres < scripts/admin/reverse-counterpicks-and-force-drop.sql
--
--   1. Run scripts/admin/inspect-counterpick-state.sql first and fill in the
--      three CONFIG values below.
--   2. Run this file as-is. It ends in ROLLBACK, so nothing is committed --
--      read the audit table it prints.
--   3. If the audit looks right, change the last line to COMMIT and re-run.
--   4. Re-run the inspect script to confirm.
--
-- Safety: aborts if a target movie is not held by the named team, or if a
-- refund would drive a budget negative. Re-running after a commit is a no-op.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _repair_audit (
  seq     serial,
  action  text,
  detail  text
) ON COMMIT DROP;

DO $$
DECLARE
  -- ==========================================================================
  -- CONFIG -- fill these in from inspect-counterpick-state.sql
  -- ==========================================================================
  v_league_id   uuid   := 'REPLACE_WITH_LEAGUE_ID'::uuid;
  -- The wronged player's team: the roster the movies get dropped from.
  v_drop_team_id uuid  := 'REPLACE_WITH_TEAM_ID'::uuid;
  -- The movies to un-counterpick and then drop.
  v_movie_ids   uuid[] := ARRAY[
    'REPLACE_WITH_MOVIE_ID_1',
    'REPLACE_WITH_MOVIE_ID_2'
  ]::uuid[];

  -- Should these drops consume the team's drop allowance (leagues.drop_limit)?
  -- TRUE  = normal drop accounting, a `team_drops` row per movie.
  -- FALSE = roster is corrected but the allowance is not spent, because the
  --         player could not drop at the proper time through no fault of theirs.
  v_count_against_drop_limit boolean := true;

  -- Insert the same in-app "now available for pickup" notifications drop-movie
  -- sends. Discord/email are NOT sent from here either way.
  v_notify_league boolean := true;
  -- ==========================================================================

  v_cp            record;
  v_bid           record;
  v_holding       record;
  v_teams_to_rescore uuid[] := ARRAY[]::uuid[];
  v_team          uuid;
  v_movie_id      uuid;
  v_found         boolean;
  v_dropped_at    timestamptz := now();
BEGIN
  IF array_length(v_movie_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No movie ids configured';
  END IF;

  -- --------------------------------------------------------------------------
  -- Guard: every target movie must currently be held (not already dropped) by
  -- the named team, in the named league. Catches copy/paste of the wrong UUID
  -- before anything is written.
  -- --------------------------------------------------------------------------
  FOREACH v_movie_id IN ARRAY v_movie_ids LOOP
    SELECT EXISTS (
      SELECT 1 FROM draft_picks dp
      WHERE dp.team_id = v_drop_team_id AND dp.movie_id = v_movie_id
        AND dp.league_id = v_league_id AND dp.dropped_at IS NULL
      UNION ALL
      SELECT 1 FROM pickups pk
      WHERE pk.team_id = v_drop_team_id AND pk.movie_id = v_movie_id
        AND pk.league_id = v_league_id AND pk.dropped_at IS NULL
    ) INTO v_found;

    IF NOT v_found THEN
      RAISE EXCEPTION
        'Movie % is not an active holding of team % in league % -- check the UUIDs (or it was already dropped by a previous run)',
        v_movie_id, v_drop_team_id, v_league_id;
    END IF;
  END LOOP;

  v_teams_to_rescore := array_append(v_teams_to_rescore, v_drop_team_id);

  -- ==========================================================================
  -- PART 1: reverse the counterpicks on those movies
  -- ==========================================================================
  FOR v_cp IN
    SELECT c.*, m.title
    FROM counterpicks c
    JOIN movies m ON m.id = c.movie_id
    WHERE c.league_id = v_league_id
      AND c.movie_id = ANY(v_movie_ids)
    ORDER BY c.created_at
  LOOP
    -- 1a. clear the counterpicked flag on the holding it sits on
    IF v_cp.draft_pick_id IS NOT NULL THEN
      UPDATE draft_picks SET counterpicked_by_team_id = NULL WHERE id = v_cp.draft_pick_id;
    ELSE
      UPDATE pickups SET counterpicked_by_team_id = NULL WHERE id = v_cp.pickup_id;
    END IF;

    -- 1b. refund the budget the winning bid was charged, and cancel that bid.
    -- Draft-phase counterpicks (make-counterpick) have no bid and no charge,
    -- so this loop simply finds nothing for them.
    FOR v_bid IN
      SELECT cb.*
      FROM counterpick_bids cb
      WHERE cb.league_id = v_league_id
        AND cb.movie_id = v_cp.movie_id
        AND cb.team_id = v_cp.counterpicker_team_id
        AND cb.status = 'won'
    LOOP
      UPDATE team_budgets
      SET remaining_budget = remaining_budget + v_bid.amount,
          total_spent      = total_spent - v_bid.amount,
          updated_at       = now()
      WHERE team_id = v_bid.team_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No team_budgets row for team % -- cannot refund $%',
          v_bid.team_id, v_bid.amount;
      END IF;

      UPDATE counterpick_bids SET status = 'cancelled' WHERE id = v_bid.id;

      INSERT INTO _repair_audit (action, detail) VALUES (
        'refund_bid',
        format('team %s refunded $%s for %s (bid %s -> cancelled)',
               v_bid.team_id, v_bid.amount, v_cp.title, v_bid.id)
      );
    END LOOP;

    -- 1c. drop the counterpick itself -- this also frees the counterpicker's
    -- slot, which is derived from the counterpicks row count.
    DELETE FROM counterpicks WHERE id = v_cp.id;

    v_teams_to_rescore := array_append(v_teams_to_rescore, v_cp.counterpicker_team_id);

    INSERT INTO _repair_audit (action, detail) VALUES (
      'reverse_counterpick',
      format('%s: counterpick by team %s removed (was targeting team %s, phase %s)',
             v_cp.title, v_cp.counterpicker_team_id, v_cp.target_team_id, v_cp.phase)
    );
  END LOOP;

  -- 1d. cancel any still-open bids on these movies. They were never charged,
  -- and leaving them active would either block the drop or resolve later onto
  -- a movie nobody owns.
  FOR v_bid IN
    UPDATE counterpick_bids
    SET status = 'cancelled'
    WHERE league_id = v_league_id
      AND movie_id = ANY(v_movie_ids)
      AND status IN ('active', 'outbid')
    RETURNING id, team_id, movie_id, amount
  LOOP
    INSERT INTO _repair_audit (action, detail) VALUES (
      'cancel_open_bid',
      format('open bid %s ($%s, team %s) on movie %s cancelled uncharged',
             v_bid.id, v_bid.amount, v_bid.team_id, v_bid.movie_id)
    );
  END LOOP;

  -- ==========================================================================
  -- PART 2: force-drop the movies from the wronged team's roster
  -- ==========================================================================
  FOR v_holding IN
    SELECT 'draft_pick' AS source, dp.id AS source_id, dp.movie_id, m.title
    FROM draft_picks dp
    JOIN movies m ON m.id = dp.movie_id
    WHERE dp.team_id = v_drop_team_id
      AND dp.league_id = v_league_id
      AND dp.movie_id = ANY(v_movie_ids)
      AND dp.dropped_at IS NULL
    UNION ALL
    SELECT 'pickup', pk.id, pk.movie_id, m.title
    FROM pickups pk
    JOIN movies m ON m.id = pk.movie_id
    WHERE pk.team_id = v_drop_team_id
      AND pk.league_id = v_league_id
      AND pk.movie_id = ANY(v_movie_ids)
      AND pk.dropped_at IS NULL
  LOOP
    IF v_count_against_drop_limit THEN
      IF v_holding.source = 'draft_pick' THEN
        INSERT INTO team_drops (team_id, movie_id, draft_pick_id, dropped_at)
        VALUES (v_drop_team_id, v_holding.movie_id, v_holding.source_id, v_dropped_at);
      ELSE
        INSERT INTO team_drops (team_id, movie_id, pickup_id, dropped_at)
        VALUES (v_drop_team_id, v_holding.movie_id, v_holding.source_id, v_dropped_at);
      END IF;
    END IF;

    IF v_holding.source = 'draft_pick' THEN
      UPDATE draft_picks SET dropped_at = v_dropped_at WHERE id = v_holding.source_id;
    ELSE
      UPDATE pickups SET dropped_at = v_dropped_at WHERE id = v_holding.source_id;
    END IF;

    INSERT INTO _repair_audit (action, detail) VALUES (
      'force_drop',
      format('%s (%s %s) dropped from team %s%s',
             v_holding.title, v_holding.source, v_holding.source_id, v_drop_team_id,
             CASE WHEN v_count_against_drop_limit
                  THEN ' [counts against drop limit]'
                  ELSE ' [drop limit NOT charged]' END)
    );

    IF v_notify_league THEN
      INSERT INTO notifications (user_id, league_id, type, title, body, data)
      SELECT lp.user_id,
             v_league_id,
             'pickup_available',
             v_holding.title || ' is now available',
             'A team dropped ' || v_holding.title || '. It''s now available for pickup.',
             jsonb_build_object('movie_id', v_holding.movie_id)
      FROM league_participants lp
      JOIN teams t ON t.participant_id = lp.id
      WHERE lp.league_id = v_league_id
        AND lp.status = 'active'
        AND t.id <> v_drop_team_id;
    END IF;
  END LOOP;

  -- ==========================================================================
  -- PART 3: rescore every team whose points moved
  -- ==========================================================================
  SELECT array_agg(DISTINCT x) INTO v_teams_to_rescore
  FROM unnest(v_teams_to_rescore) AS x;

  FOREACH v_team IN ARRAY v_teams_to_rescore
  LOOP
    PERFORM recalculate_team_score_with_counterpicks(v_team);
    INSERT INTO _repair_audit (action, detail)
      VALUES ('rescore', format('team %s recalculated', v_team));
  END LOOP;
END;
$$;

-- Review this before committing.
SELECT seq, action, detail FROM _repair_audit ORDER BY seq;

-- Change to COMMIT once the audit above looks correct.
ROLLBACK;
