-- ============================================================================
-- Per-league trade offer expiry bounds
--
-- Phase 3 of docs/PLAN-trade-expiry-phases-2-3.md. Phases 1 and 2 hardcoded the
-- window rules in _shared/trade-expiry.ts: at least an hour, at most fourteen
-- days, forty-eight hours preselected. Those are reasonable for a season-long
-- league of friends and wrong for a fast one, where a two-week offer outlives
-- the phase it was proposed in.
--
-- All three columns are nullable and NULL means "use the app default", so the
-- rules stay in one place (trade-expiry.ts) and a league only stores what it
-- actually disagrees with. That also means no backfill: every existing league
-- keeps behaving exactly as it did.
-- ============================================================================

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS trade_offer_expiry_default_hours INTEGER,
  ADD COLUMN IF NOT EXISTS trade_offer_expiry_min_hours     INTEGER,
  ADD COLUMN IF NOT EXISTS trade_offer_expiry_max_days      INTEGER;

COMMENT ON COLUMN leagues.trade_offer_expiry_default_hours IS
  'The offer window preselected in the propose/counter picker, in hours. NULL = the app default (48). Not a floor or a ceiling -- a proposer may pick anything between the min and the max.';
COMMENT ON COLUMN leagues.trade_offer_expiry_min_hours IS
  'Shortest offer window this league allows, in hours. NULL = the app default (1). Exists to stop pressure tactics: an offer nobody has time to read is not a deadline. Also raises the "expiring soon" nudge floor -- see claim_expiry_reminders() below.';
COMMENT ON COLUMN leagues.trade_offer_expiry_max_days IS
  'Longest offer window this league allows, in days. NULL = the app default (14). A league whose season is measured in weeks wants offers that die inside it.';

-- Per-column sanity. The ceilings are generous on purpose -- these are league
-- preferences, not correctness bounds, and the interesting invariant is the
-- ordering one below. update-league refuses the same ranges with a readable
-- message; this is the backstop for anything that writes the row directly.
ALTER TABLE leagues
  ADD CONSTRAINT check_trade_offer_expiry_default_hours
    CHECK (trade_offer_expiry_default_hours IS NULL
           OR (trade_offer_expiry_default_hours >= 1
               AND trade_offer_expiry_default_hours <= 2160)),
  ADD CONSTRAINT check_trade_offer_expiry_min_hours
    CHECK (trade_offer_expiry_min_hours IS NULL
           OR (trade_offer_expiry_min_hours >= 1
               AND trade_offer_expiry_min_hours <= 168)),
  ADD CONSTRAINT check_trade_offer_expiry_max_days
    CHECK (trade_offer_expiry_max_days IS NULL
           OR (trade_offer_expiry_max_days >= 1
               AND trade_offer_expiry_max_days <= 90));

-- The one that matters: min <= default <= max, on the EFFECTIVE values.
--
-- Comparing only the columns a league happens to have set would leave the hole
-- that motivates the constraint -- set a 5-day minimum, leave the maximum NULL,
-- and nothing catches it if the app default were ever lowered under it; set a
-- 1-day maximum alone and the picker preselects a 48h window the server then
-- refuses. So the fallbacks are folded in here, which is the only way the
-- invariant is total.
--
-- The three literals mirror MIN_EXPIRY_MINUTES / DEFAULT_EXPIRY_HOURS /
-- MAX_EXPIRY_DAYS in supabase/functions/_shared/trade-expiry.ts. They are the
-- app defaults, and changing one there means changing it here: a CHECK cannot
-- read TypeScript, and a constraint that disagrees with the fallback it is
-- guarding is worse than no constraint.
--
-- Consequence worth knowing before it surprises someone: narrowing the maximum
-- below the effective default is refused rather than silently clamped, so an
-- owner setting a 1-day maximum must set a default inside it in the same call.
-- update-league says exactly that instead of leaking a constraint violation.
ALTER TABLE leagues
  ADD CONSTRAINT check_trade_offer_expiry_bounds_ordered
    CHECK (
      COALESCE(trade_offer_expiry_min_hours, 1)
        <= COALESCE(trade_offer_expiry_default_hours, 48)
      AND COALESCE(trade_offer_expiry_default_hours, 48)
        <= COALESCE(trade_offer_expiry_max_days, 14) * 24
    );

-- ============================================================================
-- The nudge floor follows the league's minimum
--
-- 20260825120000 left p_min_window a parameter and said why: it is a relative
-- of the minimum offer window, "and burying it here would let the two disagree
-- silently the moment league configuration makes the minimum per-league". This
-- is that moment.
--
-- The caller still passes the app-level floor (2h) -- process-trades claims
-- every league's offers in one statement, so it has no single league's minimum
-- to pass. The per-league part has to happen where the league row is in scope,
-- which is here.
--
-- GREATEST, not replacement: the floor exists so a recipient is not pinged
-- twice about an offer they were just emailed, and lowering it under 2h for a
-- league with a 1h minimum would reintroduce exactly that. Raising it keeps the
-- invariant the comment above asks for -- the floor is never below the shortest
-- window the league permits.
--
-- Be clear about what that costs, because the direction is easy to misread: for
-- any league whose minimum is under 2h -- which is every league that has not
-- configured one, since the app minimum is 1h -- the floor stays at 2h and
-- windows between the league minimum and 2h get NO nudge, even though the
-- league permits them. Raising a league's minimum above 2h likewise suppresses
-- the nudge for shorter offers that are already open and were legal when made.
-- That is the accepted trade: a second ping about an offer the recipient was
-- just emailed is worse than no ping on a window measured in an hour or two.
--
-- Everything else about the function is unchanged; it is repeated in full
-- because CREATE OR REPLACE has no way to patch a predicate.
-- ============================================================================

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
  FROM leagues l
  WHERE l.id = t.league_id
    -- Kept in step with idx_trade_offers_pending_expiry,
    -- expire_lapsed_trade_offers() and reresolve_release_anchored_offers(): only
    -- an unanswered offer has a clock of its own. Once both parties agree,
    -- review_ends_at owns the trade.
    AND t.status IN ('proposed', 'countered')
    AND t.expires_at IS NOT NULL
    AND t.expiry_reminder_sent_at IS NULL
    -- Already lapsed: the sweep in the same cron pass is about to expire it,
    -- and "expires soon" about something already dead is just wrong.
    AND t.expires_at > now()
    -- Redundant against the LEAST() below, which can never exceed p_lead, but
    -- the planner cannot infer a bound from a row-dependent expression. Stating
    -- it turns the index scan from "every open offer with a future clock" into
    -- a bounded range over the next p_lead.
    --
    -- The "verified with EXPLAIN" note this comment carried was inherited from
    -- 20260825120000, whose query had no leagues join. The bound is still
    -- sargable and the partial index predicate still matches this WHERE exactly,
    -- but the plan for THIS statement has not been measured -- do not read the
    -- claim as covering it.
    AND t.expires_at <= now() + p_lead
    AND (t.expires_at - COALESCE(t.responded_at, t.proposed_at))
        >= GREATEST(
             p_min_window,
             COALESCE(l.trade_offer_expiry_min_hours, 0) * INTERVAL '1 hour'
           )
    AND (t.expires_at - now())
        <= LEAST(p_lead, (t.expires_at - COALESCE(t.responded_at, t.proposed_at)) * p_fraction)
  RETURNING t.*;
$$;

COMMENT ON FUNCTION claim_expiry_reminders(INTERVAL, INTERVAL, NUMERIC) IS
  'Claims open trade offers due an "expiring soon" nudge and stamps expiry_reminder_sent_at in the same statement, so overlapping cron runs cannot double-send; the caller notifies exactly the returned rows. Fires at min(p_lead, 25% of the offer window) remaining, and never for windows shorter than the greater of p_min_window and the league''s own trade_offer_expiry_min_hours.';

-- A bare GRANT to service_role would restrict nothing: EXECUTE defaults to
-- PUBLIC, so the REVOKE is the part that does the work. Repeated because
-- CREATE OR REPLACE keeps the old ACL only as long as nobody has changed it --
-- restating is cheap and being wrong here is not.
REVOKE EXECUTE ON FUNCTION claim_expiry_reminders(INTERVAL, INTERVAL, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_expiry_reminders(INTERVAL, INTERVAL, NUMERIC) TO service_role;
