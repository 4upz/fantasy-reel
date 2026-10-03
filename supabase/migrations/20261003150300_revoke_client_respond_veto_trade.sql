-- Make respond_to_trade() and veto_trade() service-role only.
--
-- Both are SECURITY DEFINER and check nothing about the caller: they lock the
-- row, check its status, and act. The authorization lives in the Edge Functions
-- that call them with the service role -- respond-trade checks the caller owns
-- the recipient team, veto-trade checks the caller owns the league. Nothing else
-- calls them (no frontend RPC, no Discord bot path).
--
-- The blanket EXECUTE grant in 20260805190000 re-exposed them to anon and
-- authenticated, so any signed-in user could POST /rest/v1/rpc/respond_to_trade
-- or /rpc/veto_trade and accept, reject or veto any trade in any league,
-- skipping those checks. Same fix approve_trade() got in 20260812120000.

REVOKE EXECUTE ON FUNCTION respond_to_trade(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION respond_to_trade(UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION veto_trade(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION veto_trade(UUID, TEXT) TO service_role;
