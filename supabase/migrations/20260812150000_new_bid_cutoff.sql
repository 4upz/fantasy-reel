-- ============================================================================
-- New-Bid Cutoff
--
-- Splits the weekly bidding cycle into an open phase and a counter-bid phase.
-- After the cutoff, teams may only raise or counter bids on movies that are
-- already contested -- no opening a bid on a movie nobody is bidding on, and no
-- cancelling. See docs/superpowers/specs/2026-08-12-new-bid-cutoff-design.md.
-- ============================================================================

ALTER TABLE leagues
ADD COLUMN new_bid_cutoff_hours INTEGER NOT NULL DEFAULT 48;

-- 0 disables the cutoff entirely (pre-cutoff behavior: new bids allowed right up
-- to processing). The upper bound leaves at least 24h of open bidding in the
-- 168-hour cycle, so the window can never be configured shut.
ALTER TABLE leagues
ADD CONSTRAINT check_new_bid_cutoff_hours_bounds
CHECK (new_bid_cutoff_hours >= 0 AND new_bid_cutoff_hours <= 144);

COMMENT ON COLUMN leagues.new_bid_cutoff_hours IS
  'Hours before the weekly processing deadline after which no new bids may be opened -- only counters and raises on already-contested movies. 48 puts the cutoff at Thursday 8pm UTC. 0 disables the cutoff.';

-- ============================================================================
-- get_new_bid_cutoff
--
-- The instant this league stops accepting new bids for the current cycle, or
-- NULL when the league has the cutoff disabled (or does not exist).
--
-- Derived from get_next_processing_deadline() at call time rather than stored.
-- That function is monotone within a cycle and rolls forward the moment one
-- ends, so "now minus the offset" is correct at every point in the week:
--   Wednesday        -> next deadline Sat 8pm, cutoff Thu 8pm (future) -> open
--   Friday           -> next deadline Sat 8pm, cutoff Thu 8pm (past)   -> closed
--   Saturday 9pm     -> next deadline is *next* Sat, cutoff *next* Thu -> open
-- Nothing has to be migrated forward each week, and a mid-season config change
-- takes effect immediately.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_new_bid_cutoff(p_league_id UUID)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_hours INTEGER;
BEGIN
  SELECT new_bid_cutoff_hours INTO v_hours
  FROM leagues
  WHERE id = p_league_id;

  IF v_hours IS NULL OR v_hours = 0 THEN
    RETURN NULL;
  END IF;

  RETURN get_next_processing_deadline() - make_interval(hours => v_hours);
END;
-- Left VOLATILE (the default) to match get_next_processing_deadline(), which is
-- itself undeclared: marking this STABLE while it calls a VOLATILE function
-- would be a lie the planner is entitled to act on.
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp;

COMMENT ON FUNCTION get_new_bid_cutoff(UUID) IS
  'When this league stops accepting new bids this cycle (processing deadline minus new_bid_cutoff_hours), or NULL when the cutoff is disabled.';

-- Read-only and league-scoped: any authenticated member may ask when their
-- league's window closes. Revoke the implicit PUBLIC grant first -- granting to
-- a role on its own restricts nothing.
REVOKE ALL ON FUNCTION get_new_bid_cutoff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_new_bid_cutoff(UUID) TO authenticated, service_role;

-- ============================================================================
-- bid_cutoff_announcements
--
-- Idempotency for the hourly Discord cutoff announcement. Keyed on the cycle
-- (league + the processing deadline the cutoff belongs to) rather than on a
-- movie, because the announcement is one per league per week. A rerun inside
-- the same cycle is a no-op; the next cycle carries a new processing_deadline
-- and announces again.
--
-- Service-role only: no RLS policies are defined, so only Edge Functions using
-- the service role client can read or write it.
-- ============================================================================
CREATE TABLE bid_cutoff_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  processing_deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_bid_cutoff_announcements UNIQUE (league_id, processing_deadline)
);

COMMENT ON TABLE bid_cutoff_announcements IS
  'Idempotency log for the hourly new-bid-cutoff Discord announcement -- one row per league per bidding cycle.';

ALTER TABLE bid_cutoff_announcements ENABLE ROW LEVEL SECURITY;
-- No policies defined: only the service role (which bypasses RLS) may access this table.
