BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- A league member cannot forge an accepted trade or execute one themselves:
-- execute_trade and offer creation belong to the service role.

INSERT INTO auth.users(id, email) VALUES
  ('85111111-1111-4111-8111-000000000001', 'trade-grants-thief@example.test'),
  ('85111111-1111-4111-8111-000000000002', 'trade-grants-victim@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('85111111-1111-4111-8111-000000000003', 'Trade grants', '85111111-1111-4111-8111-000000000002', 'active', current_date + 60);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('85111111-1111-4111-8111-000000000004', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000001', 'member'),
  ('85111111-1111-4111-8111-000000000005', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000002', 'owner');
INSERT INTO teams(id, participant_id, name) VALUES
  ('85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000004', 'Thief'),
  ('85111111-1111-4111-8111-000000000007', '85111111-1111-4111-8111-000000000005', 'Victim');
INSERT INTO movies(id, tmdb_id, title, release_date) VALUES
  ('85111111-1111-4111-8111-000000000008', 987650001, 'Victim pick', current_date + 20);
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('85111111-1111-4111-8111-000000000009', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000007', '85111111-1111-4111-8111-000000000008', 1, 1);
-- A pre-accepted offer, as if the forged insert had landed.
INSERT INTO trade_offers(id, league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status, accepted_at) VALUES
  ('85111111-1111-4111-8111-000000000010', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000007',
   '{"faab": 0, "movies": []}',
   '{"faab": 0, "movies": [{"movie_id": "85111111-1111-4111-8111-000000000008", "source": "draft_pick", "source_id": "85111111-1111-4111-8111-000000000009"}]}',
   'accepted', now());

SELECT is(has_function_privilege('anon', 'execute_trade(uuid)', 'EXECUTE'), false, 'anon cannot execute trades');
SELECT is(has_function_privilege('authenticated', 'execute_trade(uuid)', 'EXECUTE'), false, 'nor can a signed-in user');
SELECT is(has_function_privilege('service_role', 'execute_trade(uuid)', 'EXECUTE'), true, 'the service role still can');
SELECT is(has_table_privilege('authenticated', 'trade_offers', 'INSERT'), false, 'a signed-in user cannot insert offers');
SELECT is(has_table_privilege('anon', 'trade_offers', 'INSERT'), false, 'nor can anon');
SELECT is(has_table_privilege('authenticated', 'trade_offers', 'SELECT'), true, 'members can still read offers');

SELECT set_config('request.jwt.claim.sub', '85111111-1111-4111-8111-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$SELECT execute_trade('85111111-1111-4111-8111-000000000010')$$,
  '42501', NULL, 'a member calling execute_trade is refused');
SELECT throws_ok($$INSERT INTO trade_offers(league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status)
  VALUES ('85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000007',
    '{"faab": 0, "movies": []}', '{"faab": 0, "movies": [{"movie_id": "85111111-1111-4111-8111-000000000008", "source": "draft_pick", "source_id": "85111111-1111-4111-8111-000000000009"}]}',
    'accepted')$$,
  '42501', NULL, 'a member cannot insert a pre-accepted offer');
SELECT throws_ok($$INSERT INTO trade_offers(league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items)
  VALUES ('85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000007',
    '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}')$$,
  '42501', NULL, 'nor any offer, bypassing propose-trade');

RESET ROLE;
SELECT is((SELECT team_id FROM draft_picks WHERE id = '85111111-1111-4111-8111-000000000009'),
  '85111111-1111-4111-8111-000000000007'::UUID, 'the victim keeps their movie');

-- The legitimate path: the service role (process-trades) executes an agreed trade.
SET LOCAL ROLE service_role;
SELECT is((execute_trade('85111111-1111-4111-8111-000000000010')->>'success')::BOOLEAN, true,
  'the service role executes an accepted trade');
RESET ROLE;
SELECT is((SELECT team_id FROM draft_picks WHERE id = '85111111-1111-4111-8111-000000000009'),
  '85111111-1111-4111-8111-000000000006'::UUID, 'and the movie moves');

SELECT * FROM finish();
ROLLBACK;
