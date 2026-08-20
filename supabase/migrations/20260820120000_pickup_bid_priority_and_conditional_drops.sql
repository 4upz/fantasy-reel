-- Pickup bid priority and conditional drops
--
-- A team may now bid past a full roster. Two mechanisms make that safe, both
-- mirroring what counterpick_bids already does (20260805150000):
--
-- `priority` is the team's own ranking among its pending bids -- 1 is the one
-- it wants most. It never decides who WINS a contest; the highest bid does
-- that. It decides which of a team's own winning bids it keeps when it wins
-- more than it has room for. Priorities are NOT unique: gaps and duplicates
-- are tolerated and normalized at processing time, which keeps cancels and
-- reorders from needing a transaction just to avoid transient collisions.
--
-- The conditional drop columns name a holding released only if this bid wins.
-- Two nullable FKs rather than (source, id) because a holding lives in one of
-- two tables and both deserve real referential integrity -- the same shape
-- team_drops and counterpick_bids use. ON DELETE SET NULL degrades a bid whose
-- target row was deleted into a bid with no conditional drop, which is exactly
-- the fallback process-bids applies when a target has merely become
-- undroppable.

ALTER TABLE pickup_bids
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conditional_drop_draft_pick_id UUID
    REFERENCES draft_picks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conditional_drop_pickup_id UUID
    REFERENCES pickups(id) ON DELETE SET NULL;

ALTER TABLE pickup_bids
  DROP CONSTRAINT IF EXISTS check_at_most_one_conditional_drop;

ALTER TABLE pickup_bids
  ADD CONSTRAINT check_at_most_one_conditional_drop CHECK (
    conditional_drop_draft_pick_id IS NULL
    OR conditional_drop_pickup_id IS NULL
  );

COMMENT ON COLUMN pickup_bids.priority IS
  'Team-chosen rank among its own pending pickup bids (1 = wanted most). Ties/gaps are normalized during bid processing.';
COMMENT ON COLUMN pickup_bids.conditional_drop_draft_pick_id IS
  'Draft pick released only if this bid wins. Mutually exclusive with conditional_drop_pickup_id.';
COMMENT ON COLUMN pickup_bids.conditional_drop_pickup_id IS
  'Pickup released only if this bid wins. Mutually exclusive with conditional_drop_draft_pick_id.';

-- Backfill from the ordering process-bids applied implicitly (highest amount,
-- then earliest placed), so no bid pending at deploy time changes outcome.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY league_id, team_id
      ORDER BY amount DESC, created_at ASC
    ) AS new_priority
  FROM pickup_bids
  WHERE status IN ('active', 'outbid')
)
UPDATE pickup_bids AS pb
SET priority = ranked.new_priority
FROM ranked
WHERE pb.id = ranked.id;

-- Supports "fetch this team's pending bids in priority order", which both the
-- reorder endpoint and the bidding page do on every load.
CREATE INDEX IF NOT EXISTS idx_pickup_bids_team_priority
  ON pickup_bids (league_id, team_id, priority)
  WHERE status IN ('active', 'outbid');
