-- Counterpick bid priority (issue #24)
--
-- A team may hold at most `leagues.bidding_counterpick_slots` bidding-phase
-- counterpicks, but it is allowed (and expected) to have more pending bids than
-- that -- it bids on several movies hoping to win some. When more of those bids
-- win than the team has slots for, something has to decide which ones it keeps.
--
-- `priority` is that decision, made by the team up front: 1 is the bid it most
-- wants, 2 the next, and so on. process-bids fills a team's slots in priority
-- order and lets the movies it cannot take fall through to the runner-up.
--
-- Priorities are per team per league and only meaningful among pending
-- ('active'/'outbid') bids. They are NOT enforced unique: gaps and duplicates
-- are tolerated and normalized at processing time, which keeps cancels and
-- reorders from needing a transaction just to avoid transient collisions.

ALTER TABLE counterpick_bids
ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN counterpick_bids.priority IS
  'Team-chosen rank among its own pending counterpick bids (1 = wanted most). Ties/gaps are normalized during bid processing.';

-- Backfill: existing pending bids have no explicit ranking, so seed it from the
-- ordering process-bids used to apply implicitly -- highest amount first, then
-- earliest placed.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY league_id, team_id
      ORDER BY amount DESC, created_at ASC
    ) AS new_priority
  FROM counterpick_bids
  WHERE status IN ('active', 'outbid')
)
UPDATE counterpick_bids AS cb
SET priority = ranked.new_priority
FROM ranked
WHERE cb.id = ranked.id;

-- Supports "fetch this team's pending bids in priority order", which both the
-- reorder endpoint and the bidding page do on every load.
CREATE INDEX IF NOT EXISTS idx_counterpick_bids_team_priority
  ON counterpick_bids (league_id, team_id, priority)
  WHERE status IN ('active', 'outbid');
