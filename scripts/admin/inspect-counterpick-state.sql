-- ============================================================================
-- INSPECT: counterpick + roster state for one league (READ ONLY)
-- ============================================================================
-- Run this BEFORE scripts/admin/reverse-counterpicks-and-force-drop.sql to
-- collect the UUIDs that script needs and to confirm the state you are about
-- to change. Nothing here writes.
--
-- Fill in the league name below, then run each block.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Find the league
-- ---------------------------------------------------------------------------
SELECT id, name, status, counterpicks_block_drops, drop_limit,
       draft_counterpick_slots, bidding_counterpick_slots
FROM leagues
WHERE name ILIKE '%REPLACE_WITH_LEAGUE_NAME%';

-- ---------------------------------------------------------------------------
-- 2. Teams in that league (get the wronged player's team_id here)
-- ---------------------------------------------------------------------------
SELECT t.id AS team_id, t.name AS team_name, p.display_name, p.discord_username,
       tb.remaining_budget, tb.total_spent,
       (SELECT count(*) FROM team_drops td WHERE td.team_id = t.id) AS drops_used
FROM teams t
JOIN league_participants lp ON lp.id = t.participant_id
LEFT JOIN profiles p ON p.user_id = lp.user_id
LEFT JOIN team_budgets tb ON tb.team_id = t.id
WHERE lp.league_id = 'REPLACE_WITH_LEAGUE_ID'::uuid
ORDER BY t.name;

-- ---------------------------------------------------------------------------
-- 3. Every counterpick in the league, with the holding it sits on
-- ---------------------------------------------------------------------------
SELECT c.id AS counterpick_id,
       m.id AS movie_id,
       m.title,
       m.release_date,
       m.fantasy_points,
       cp_team.name AS counterpicker,
       tgt_team.name AS target_team,
       c.phase,
       CASE WHEN c.draft_pick_id IS NOT NULL THEN 'draft_pick' ELSE 'pickup' END AS source,
       COALESCE(c.draft_pick_id, c.pickup_id) AS source_id,
       c.created_at
FROM counterpicks c
JOIN movies m ON m.id = c.movie_id
JOIN teams cp_team ON cp_team.id = c.counterpicker_team_id
JOIN teams tgt_team ON tgt_team.id = c.target_team_id
WHERE c.league_id = 'REPLACE_WITH_LEAGUE_ID'::uuid
ORDER BY c.created_at;

-- ---------------------------------------------------------------------------
-- 4. Counterpick bids behind those counterpicks (who paid what)
-- ---------------------------------------------------------------------------
SELECT cb.id AS bid_id,
       m.title,
       bidder.name AS bidder_team,
       target.name AS target_team,
       cb.amount,
       cb.status,
       cb.created_at,
       cb.processing_deadline
FROM counterpick_bids cb
JOIN movies m ON m.id = cb.movie_id
JOIN teams bidder ON bidder.id = cb.team_id
JOIN teams target ON target.id = cb.target_team_id
WHERE cb.league_id = 'REPLACE_WITH_LEAGUE_ID'::uuid
ORDER BY m.title, cb.status, cb.amount DESC;

-- ---------------------------------------------------------------------------
-- 5. The wronged player's current roster (pick the movie_ids to drop here)
-- ---------------------------------------------------------------------------
SELECT 'draft_pick' AS source,
       dp.id AS source_id,
       m.id AS movie_id,
       m.title,
       m.release_date,
       m.fantasy_points,
       dp.counterpicked_by_team_id,
       dp.dropped_at
FROM draft_picks dp
JOIN movies m ON m.id = dp.movie_id
WHERE dp.team_id = 'REPLACE_WITH_TEAM_ID'::uuid
UNION ALL
SELECT 'pickup',
       pk.id,
       m.id,
       m.title,
       m.release_date,
       m.fantasy_points,
       pk.counterpicked_by_team_id,
       pk.dropped_at
FROM pickups pk
JOIN movies m ON m.id = pk.movie_id
WHERE pk.team_id = 'REPLACE_WITH_TEAM_ID'::uuid
ORDER BY 4;

-- ---------------------------------------------------------------------------
-- 6. Current standings snapshot (compare against after the reversal)
-- ---------------------------------------------------------------------------
SELECT t.name AS team_name,
       ts.total_points, ts.draft_points, ts.pickup_points, ts.counterpick_points,
       ts.counterpicks_made, ts.last_calculated_at
FROM team_scores ts
JOIN teams t ON t.id = ts.team_id
JOIN league_participants lp ON lp.id = t.participant_id
WHERE lp.league_id = 'REPLACE_WITH_LEAGUE_ID'::uuid
ORDER BY ts.total_points DESC;
