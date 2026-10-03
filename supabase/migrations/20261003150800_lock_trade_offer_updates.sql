-- Clients can no longer UPDATE trade_offers.
--
-- Two policies from 20260128_create_trading_system.sql let clients write the
-- table directly, and neither had a WITH CHECK:
--
--   * "Involved teams can update pending trades" -- either team on a
--     proposed/countered offer could rewrite any column. A recipient could set
--     initiator_items to the initiator's whole roster and budget, then accept.
--   * "League owners can veto trades" -- the commissioner could do the same to
--     an offer in review.
--
-- Every legitimate change to an offer already goes through an Edge Function
-- using the service role: respond-trade (respond_to_trade), counter-trade
-- (counter_trade), cancel-trade, veto-trade (veto_trade), approve-trade
-- (approve_trade), extend-trade-offer (extend_trade_offer) and the
-- process-trades cron. Each validates the caller and the items before writing.
-- The web app only reads trade_offers (get-trades and a Realtime
-- subscription, which needs SELECT alone) and the Discord bot never touches it.
-- So the client UPDATE path has no legitimate user and is removed outright,
-- rather than narrowed to "status only": letting a client set status directly
-- would still skip the review window and the validation those functions run.
--
-- The SELECT and INSERT policies, and the service-role policy, are unchanged.
-- The blanket grant in 20260805190000_restore_data_api_default_grants is
-- revoked for this one privilege here instead of being edited.

DROP POLICY IF EXISTS "Involved teams can update pending trades" ON public.trade_offers;
DROP POLICY IF EXISTS "League owners can veto trades" ON public.trade_offers;

REVOKE UPDATE ON public.trade_offers FROM PUBLIC, anon, authenticated;
