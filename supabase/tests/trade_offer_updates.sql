BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Clients cannot rewrite a trade offer; every change goes through the
-- service-role Edge Functions and their RPCs.

INSERT INTO auth.users(id, email) VALUES
  ('85111111-1111-4111-8111-000000000001', 'trade-lock-owner@example.test'),
  ('85111111-1111-4111-8111-000000000002', 'trade-lock-recipient@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('85111111-1111-4111-8111-000000000003', 'Trade lock', '85111111-1111-4111-8111-000000000001', 'active', current_date + 60);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('85111111-1111-4111-8111-000000000004', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000001', 'owner'),
  ('85111111-1111-4111-8111-000000000005', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000002', 'member');
INSERT INTO teams(id, participant_id, name) VALUES
  ('85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000004', 'Lock Initiator'),
  ('85111111-1111-4111-8111-000000000007', '85111111-1111-4111-8111-000000000005', 'Lock Recipient');
INSERT INTO trade_offers(id, league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status) VALUES
  ('85111111-1111-4111-8111-000000000008', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000007',
   '{"movies": []}', '{"movies": [], "faab": 5}', 'proposed'),
  ('85111111-1111-4111-8111-000000000009', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000007',
   '{"movies": []}', '{"movies": [], "faab": 5}', 'review');

SELECT set_config('request.jwt.claim.sub', '85111111-1111-4111-8111-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM trade_offers WHERE league_id = '85111111-1111-4111-8111-000000000003'), 2::BIGINT, 'recipient can still read the offers');
SELECT throws_ok($$UPDATE trade_offers SET initiator_items = '{"movies": [], "faab": 100}' WHERE id = '85111111-1111-4111-8111-000000000008'$$,
  '42501', NULL, 'recipient cannot rewrite the offer terms');
SELECT throws_ok($$UPDATE trade_offers SET status = 'accepted' WHERE id = '85111111-1111-4111-8111-000000000008'$$,
  '42501', NULL, 'recipient cannot accept by writing status directly');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '85111111-1111-4111-8111-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE trade_offers SET recipient_items = '{"movies": []}' WHERE id = '85111111-1111-4111-8111-000000000008'$$,
  '42501', NULL, 'initiator cannot rewrite the offer terms');
SELECT throws_ok($$UPDATE trade_offers SET recipient_items = '{"movies": []}' WHERE id = '85111111-1111-4111-8111-000000000009'$$,
  '42501', NULL, 'commissioner cannot rewrite an offer in review');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$UPDATE trade_offers SET status = 'cancelled'$$, '42501', NULL, 'anon cannot update offers');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok($$UPDATE trade_offers SET status = 'cancelled', responded_at = now() WHERE id = '85111111-1111-4111-8111-000000000008'$$,
  'service role (cancel-trade) can still update offers');
SELECT is((SELECT (veto_trade('85111111-1111-4111-8111-000000000009', 'test') ->> 'success')::BOOLEAN), true, 'veto_trade still writes the offer');
RESET ROLE;
SELECT is((SELECT array_agg(status::TEXT ORDER BY id) FROM trade_offers WHERE league_id = '85111111-1111-4111-8111-000000000003'),
  ARRAY['cancelled', 'vetoed']::TEXT[], 'service-role writes landed');

SELECT * FROM finish();
ROLLBACK;
