-- ============================================================================
-- Extending a trade offer
--
-- Phase 2 of docs/PLAN-trade-offer-expiry.md. Lets the proposer push their own
-- offer's clock out. Without it the only way to buy the recipient more time is
-- cancel-and-repropose, which destroys the thread, re-notifies everyone, and
-- drops the deal back into the contested pool as a new offer.
--
-- Version pre-assigned by docs/PLAN-trade-expiry-phases-2-3.md. Three branches
-- have already collided on a version in this repo and a duplicate is silently
-- marked applied rather than flagged -- see the header of
-- 20260824120000_trade_offer_expiry.sql.
-- ============================================================================

-- ============================================================================
-- extend_trade_offer -- forward only, under the row lock
--
-- Forward only is the product rule, not an implementation shortcut: pulling the
-- clock in would let a proposer yank the rug while the recipient is mid-decision.
--
-- Like respond_to_trade and counter_trade, business refusals come back inside
-- the JSONB with a status_code rather than being raised, so the Edge Function
-- can hand them to the proposer verbatim.
-- ============================================================================

CREATE OR REPLACE FUNCTION extend_trade_offer(
  p_trade_id UUID,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
BEGIN
  -- Lock and fetch the trade
  v_trade := get_trade_offer_for_update(p_trade_id);

  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Trade not found', 'status_code', 404);
  END IF;

  IF v_trade.status NOT IN ('proposed', 'countered') THEN
    RETURN jsonb_build_object(
      'error', format('Cannot extend a trade with status "%s"', v_trade.status),
      'status_code', 400
    );
  END IF;

  -- Same authoritative guard as respond_to_trade and counter_trade: the sweep
  -- runs every 5 minutes, so an offer can be past its clock while still sitting
  -- in 'proposed'. Reviving one by extending it would be a fresh deal the
  -- recipient never agreed to look at, not an extension.
  IF v_trade.expires_at IS NOT NULL AND v_trade.expires_at <= now() THEN
    RETURN jsonb_build_object('error', 'This offer has expired', 'status_code', 400);
  END IF;

  -- An offer with no clock already stands until it is answered. Giving it one
  -- here would shorten it, which is the thing this function exists not to do.
  IF v_trade.expires_at IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'This offer has no expiry to extend -- it stands until it is answered',
      'status_code', 400
    );
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= v_trade.expires_at THEN
    RETURN jsonb_build_object(
      'error', 'An offer can only be extended, never shortened',
      'status_code', 400
    );
  END IF;

  -- p_expires_at arrives already resolved, bounded and clamped to the league
  -- trade deadline by resolveOfferExpiry() in _shared/trade-expiry.ts, which is
  -- the single place those rules live for every write path.
  UPDATE trade_offers
  SET expires_at = p_expires_at,
      -- An extension necessarily runs past the release the offer was waiting
      -- on, so a movie_release anchor stops being true the moment it is granted.
      -- Converting to 'fixed' is also what stops reresolve_release_anchored_offers()
      -- from dragging the clock straight back to the release boundary on the
      -- next cron pass. extend-trade-offer says this is about to happen before
      -- the proposer confirms -- silently redefining the offer would be worse
      -- than refusing outright.
      expiry_anchor = 'fixed',
      expiry_anchor_movie_id = NULL,
      -- New window, so the single nudge is owed again: one already sent
      -- described a time that is no longer true.
      expiry_reminder_sent_at = NULL,
      updated_at = now()
  WHERE id = p_trade_id;

  -- Success carries nothing but the verdict: the Edge Function re-reads the row
  -- for its response, the same way counter-trade does. An earlier draft returned
  -- expires_at/previous_expires_at/anchor_converted "so the caller need not
  -- re-read" -- but the caller re-read anyway, leaving three fields that looked
  -- load-bearing and were not.
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION extend_trade_offer(UUID, TIMESTAMPTZ) IS
  'Pushes an open offer''s expires_at out, under the row lock. Forward only -- shortening would let a proposer yank the rug mid-decision -- and refuses an offer that has already lapsed or that never had a clock. Converts a movie_release anchor to fixed, since any extension outlives the release it waited on. Resets expiry_reminder_sent_at so the nudge fires again on the new window.';

REVOKE EXECUTE ON FUNCTION extend_trade_offer(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION extend_trade_offer(UUID, TIMESTAMPTZ) TO service_role;
