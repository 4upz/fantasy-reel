-- ============================================================================
-- "Expiring soon" nudge for trade offers
--
-- Phase 2A of docs/PLAN-trade-offer-expiry.md. Phase 1
-- (20260824120000_trade_offer_expiry.sql) already added
-- trade_offers.expiry_reminder_sent_at and already resets it to NULL wherever
-- the clock is reset -- counter_trade() and reresolve_release_anchored_offers().
-- Nothing read it until now, which is why this migration adds a function and
-- touches no columns.
--
-- One nudge per offer WINDOW. The whole point of the feature is that a
-- recipient learns the offer is running out without anyone typing it in
-- Discord; a second copy of that message is worse than none.
-- ============================================================================

-- ============================================================================
-- The claim
--
-- Which offers are due a nudge is a set operation over open offers, and the
-- claim has to be part of the same statement that answers it: split the two
-- (fetch candidates, compute in TypeScript, then UPDATE the ones chosen) and
-- two overlapping cron runs both read expiry_reminder_sent_at IS NULL before
-- either writes, and both send. Keeping the predicate and the flip in one
-- UPDATE ... RETURNING is the entire idempotency guarantee -- the same shape
-- expire_lapsed_trade_offers() uses, and for the same reason.
--
-- The lead time is min(p_lead, 25% of the window):
--   * p_lead is the ceiling the caller sets (6h today). Past a day or two of
--     window, six hours' warning is as much as anyone acts on.
--   * 25% of the window is the floor-scaling half. A 4h offer nudged 6h early
--     would be nudged before it existed; on a short fuse the warning has to be
--     proportional, not absolute.
-- Windows under 2 hours get no nudge at all: 30 minutes' notice on a 2h offer
-- is a second ping about something the recipient was just emailed about.
--
-- The window is measured from when THIS clock started, not from proposed_at:
-- counter_trade() reuses the row and stamps responded_at, so for a countered
-- offer proposed_at belongs to a deal that no longer exists. For the open
-- statuses this function looks at, COALESCE(responded_at, proposed_at) is
-- the moment the current offer's clock started for the paths that reset it --
-- respond_to_trade and counter_trade both write responded_at on their way out
-- of 'proposed'/'countered'.
--
-- extend_trade_offer (20260826120000) is the exception: it moves expires_at
-- forward and clears the reminder stamp without touching responded_at, so after
-- an extension this measures the whole span since the offer was made rather
-- than the current window. Benign in this predicate -- a longer span only makes
-- the 25% fraction more generous, and the p_lead ceiling dominates -- but it is
-- not the exact equivalence the rest of this comment describes.
--
--
-- No new index. The predicate is a strict subset of
-- idx_trade_offers_pending_expiry (20260824120000), which already narrows to
-- open offers carrying a clock -- a small set. An index carrying
-- expiry_reminder_sent_at would churn on exactly the rows this function writes.
-- ============================================================================

-- Every number is a parameter, not a literal. The policy lives with the other
-- expiry rules in _shared/trade-expiry.ts (EXPIRY_REMINDER), which is also where
-- the minimum offer window lives -- p_min_window is a relative of that minimum,
-- and burying it here would let the two disagree silently the moment league
-- configuration makes the minimum per-league.
CREATE OR REPLACE FUNCTION claim_expiry_reminders(
  p_lead INTERVAL DEFAULT INTERVAL '6 hours',
  p_min_window INTERVAL DEFAULT INTERVAL '2 hours',
  p_fraction NUMERIC DEFAULT 0.25
)
RETURNS SETOF trade_offers
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE trade_offers t
  SET expiry_reminder_sent_at = now()
  -- Kept in step with idx_trade_offers_pending_expiry,
  -- expire_lapsed_trade_offers() and reresolve_release_anchored_offers(): only
  -- an unanswered offer has a clock of its own. Once both parties agree,
  -- review_ends_at owns the trade.
  WHERE t.status IN ('proposed', 'countered')
    AND t.expires_at IS NOT NULL
    AND t.expiry_reminder_sent_at IS NULL
    -- Already lapsed: the sweep in the same cron pass is about to expire it,
    -- and "expires soon" about something already dead is just wrong.
    AND t.expires_at > now()
    -- Redundant against the LEAST() below, which can never exceed p_lead, but
    -- the planner cannot infer a bound from a row-dependent expression. Stating
    -- it turns the index scan from "every open offer with a future clock" into
    -- a bounded range over the next p_lead. Verified with EXPLAIN.
    AND t.expires_at <= now() + p_lead
    AND (t.expires_at - COALESCE(t.responded_at, t.proposed_at)) >= p_min_window
    AND (t.expires_at - now())
        <= LEAST(p_lead, (t.expires_at - COALESCE(t.responded_at, t.proposed_at)) * p_fraction)
  RETURNING t.*;
$$;

COMMENT ON FUNCTION claim_expiry_reminders(INTERVAL, INTERVAL, NUMERIC) IS
  'Claims open trade offers due an "expiring soon" nudge (one per window, not one per offer for all time -- counter_trade, extend_trade_offer and reresolve_release_anchored_offers each clear the stamp when the clock changes) and stamps expiry_reminder_sent_at in the same statement, so overlapping cron runs cannot double-send; the caller notifies exactly the returned rows. Fires at min(p_lead, 25% of the offer window) remaining, and never for windows under 2 hours.';

-- A bare GRANT to service_role would restrict nothing: EXECUTE defaults to
-- PUBLIC, so the REVOKE is the part that does the work.
REVOKE EXECUTE ON FUNCTION claim_expiry_reminders(INTERVAL, INTERVAL, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_expiry_reminders(INTERVAL, INTERVAL, NUMERIC) TO service_role;
