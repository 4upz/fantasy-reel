-- ============================================================================
-- Commissioner: approve a trade immediately
--
-- Until now the only commissioner action on a trade in review was veto_trade().
-- A trade both teams agreed to sat in 'review' until review_ends_at (default
-- trade_veto_hours = 24) and was only then picked up by the process-trades
-- cron. A commissioner who had finished reviewing and WANTED the trade to go
-- through had no way to say so -- their only options were to veto it or wait
-- out the clock.
--
-- approve_trade() is the missing half of veto_trade(): it ends the review
-- window early and executes the trade in the same transaction, so approval is
-- immediate rather than "wait for the next cron sweep after the deadline".
--
-- Also adds trade_offers.approved_by so the record distinguishes "commissioner
-- signed off early" from "review clock ran out", the same way veto_reason
-- explains a veto.
--
-- No behaviour change for trades nobody approves early: they still complete
-- when review_ends_at passes, via process-trades.
-- ============================================================================

ALTER TABLE trade_offers
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN trade_offers.approved_by IS
  'Commissioner who approved this trade before its review window expired (approve_trade). NULL when the trade completed on the review clock instead.';

-- ============================================================================
-- approve_trade
--
-- Mirrors veto_trade's shape: lock the row, check the status, act, and report
-- refusals in the JSONB return value (with status_code) rather than by raising,
-- so the Edge Function can map them onto HTTP responses.
--
-- Accepts 'review' AND 'accepted' -- the same set execute_trade considers
-- executable. 'accepted' is what a league with trade_review_enabled = false
-- produces; those normally execute within one cron interval, but letting the
-- commissioner push them through covers a stalled cron without a second code
-- path.
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_trade(
  p_trade_id UUID,
  p_approved_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
  v_result JSONB;
BEGIN
  -- Lock the trade for the rest of this transaction. execute_trade() below
  -- re-takes the same lock, which is a no-op inside one transaction, but taking
  -- it here means the status check and the execution cannot be interleaved with
  -- a concurrent veto or a cron sweep of the same trade.
  v_trade := get_trade_offer_for_update(p_trade_id);

  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Trade not found', 'status_code', 404);
  END IF;

  IF v_trade.status NOT IN ('review', 'accepted') THEN
    RETURN jsonb_build_object(
      'error', format(
        'Cannot approve a trade with status "%s". Only a trade both teams have agreed to can be approved.',
        v_trade.status
      ),
      'status_code', 400
    );
  END IF;

  -- execute_trade re-validates ownership under the lock and reports refusals in
  -- its payload rather than raising, so its result must be inspected -- see the
  -- same handling in process-trades.
  v_result := execute_trade(p_trade_id);

  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    -- Nothing has been written on this path (execute_trade's refusals all
    -- return before it mutates anything, and we have not touched the row yet),
    -- so returning the error leaves the trade exactly as it was: still in
    -- review, still vetoable, still due to be swept by process-trades.
    RETURN jsonb_build_object(
      'error', COALESCE(v_result->>'error', 'execute_trade returned no result'),
      'status_code', 409
    );
  END IF;

  -- Stamp the approval only now that the trade actually went through. Ending
  -- review_ends_at at approval time keeps the record self-consistent: a
  -- completed trade should not still be advertising a future review deadline.
  UPDATE trade_offers
  SET approved_by = p_approved_by,
      -- Leave NULL alone: a league with trade_review_enabled = false never had
      -- a review window, and inventing one would misreport what happened.
      review_ends_at = CASE
        WHEN review_ends_at IS NULL THEN NULL
        ELSE LEAST(review_ends_at, now())
      END
  WHERE id = p_trade_id;

  RETURN v_result || jsonb_build_object('success', true, 'approved_early', true);
END;
$$;

COMMENT ON FUNCTION approve_trade(UUID, UUID) IS
  'Commissioner counterpart to veto_trade: ends a trade''s review window early and executes it immediately, under the same row lock. Returns execute_trade''s payload (including invalidated_trades) on success, or {error, status_code} if the trade is not in an approvable state or execution is refused.';

-- Service-role only: the Edge Function does the commissioner authorization
-- check before calling this, and a bare GRANT to service_role restricts nothing
-- on its own (see 20260805200000).
REVOKE EXECUTE ON FUNCTION approve_trade(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_trade(UUID, UUID) TO service_role;
