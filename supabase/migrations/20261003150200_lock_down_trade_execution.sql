-- Close the forged-trade path to another team's roster.
--
-- A league member could insert a trade_offers row that was already
-- 'accepted', naming another team's movies and budget, and then call
-- execute_trade() over the Data API. execute_trade() is SECURITY DEFINER and
-- has no caller check: it trusts that whoever reaches it went through
-- respond-trade or approve-trade. Even without the RPC call, process-trades
-- executes any 'accepted' row on its next run.
--
-- Two gaps made that possible:
--
--   1. 20260805190000_restore_data_api_default_grants granted EXECUTE on every
--      public function to anon and authenticated, execute_trade included.
--      20260822120000_allow_trading_counterpicks says execute_trade "was
--      already revoked from every client role", but no such REVOKE existed.
--      CREATE OR REPLACE keeps a function's ACL, so every later redefinition
--      inherited the grant.
--
--   2. The 20260128 "Users can create trades for their team" policy only
--      checked is_team_owner(initiator_team_id), so the status and items of a
--      client-inserted offer were whatever the client said.
--
-- Every legitimate writer already uses the service role: propose-trade inserts
-- offers, process-trades calls execute_trade, and approve_trade (SECURITY
-- DEFINER, service-role only) calls it as its owner. So both client paths can
-- simply close. The web app and Discord bot never insert offers or call
-- execute_trade directly.

REVOKE EXECUTE ON FUNCTION execute_trade(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION execute_trade(UUID) TO service_role;

-- Offers are created only by propose-trade, which validates ownership, roster
-- space and budget before inserting with the service role. Without an INSERT
-- privilege or policy for client roles, an offer can no longer be created
-- pre-accepted (or in any other state) behind its validation.
DROP POLICY IF EXISTS "Users can create trades for their team" ON trade_offers;
REVOKE INSERT ON TABLE trade_offers FROM anon, authenticated;
