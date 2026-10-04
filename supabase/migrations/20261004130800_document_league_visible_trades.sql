-- Trade offers, their assets and their messages are visible to every member of
-- the league, not only the two teams on the trade.
--
-- 20260131_trading_rls_restrictions.sql commented these policies as
-- "initiator, recipient, and league owner only", but
-- 20260204_fix_rls_authenticated_constraint.sql recreated both with
-- is_league_member(league_id), and get-trades returns every league trade to
-- every member. League-wide visibility is intended (members can see trades
-- happening in their league), and the trade form tells proposers that their
-- message is visible to the whole league. Recreating the policies dropped the
-- old comments; this records the actual rule so nobody reads the old migration
-- and assumes trade messages are private. No access changes.

COMMENT ON POLICY "Trade participants can view their trades" ON trade_offers IS
  'Every league member can read every trade offer in the league, including initiator_message and response_message. Intentional: trades are public within a league.';

COMMENT ON POLICY "Trade participants can view their trade assets" ON trade_assets IS
  'Every league member can read the assets of every trade offer in the league. Intentional: trades are public within a league.';
