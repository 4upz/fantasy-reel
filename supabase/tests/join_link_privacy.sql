BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- A league's join code is readable by its owner only. Members and pending
-- invitees can read the league, but not the code. Only generate-join-link
-- (service role) writes it.

INSERT INTO auth.users(id, email) VALUES
  ('88111111-1111-4111-8111-000000000001', 'jl-owner@example.test'),
  ('88111111-1111-4111-8111-000000000002', 'jl-member@example.test'),
  ('88111111-1111-4111-8111-000000000003', 'jl-invitee@example.test');
INSERT INTO leagues(id, name, owner_id) VALUES
  ('88111111-1111-4111-8111-0000000000a1', 'Join link league', '88111111-1111-4111-8111-000000000001');
INSERT INTO league_participants(league_id, user_id, role, status) VALUES
  ('88111111-1111-4111-8111-0000000000a1', '88111111-1111-4111-8111-000000000001', 'owner', 'active'),
  ('88111111-1111-4111-8111-0000000000a1', '88111111-1111-4111-8111-000000000002', 'member', 'active');
INSERT INTO invitations(league_id, invited_by, email, status) VALUES
  ('88111111-1111-4111-8111-0000000000a1', '88111111-1111-4111-8111-000000000001', 'jl-invitee@example.test', 'pending');
INSERT INTO league_join_links(league_id, join_code, join_token) VALUES
  ('88111111-1111-4111-8111-0000000000a1', 'JKCDEF23', gen_random_uuid());

SELECT ok(NOT has_table_privilege(r, 'league_join_links', p), r || ' has no ' || p || ' on league_join_links')
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
     unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p;
SELECT ok(NOT has_table_privilege('anon', 'league_join_links', 'SELECT'), 'anon has no SELECT on league_join_links');

SELECT throws_ok(
  $$UPDATE leagues SET join_code = 'ABCDEF23' WHERE id = '88111111-1111-4111-8111-0000000000a1'$$,
  '23514', NULL, 'codes can no longer be stored on leagues, where members can read them');

-- Owner
SELECT set_config('request.jwt.claims', '{"sub":"88111111-1111-4111-8111-000000000001","email":"jl-owner@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT join_code::text FROM league_join_links WHERE league_id = '88111111-1111-4111-8111-0000000000a1'),
  'JKCDEF23', 'the owner reads their league''s join code');
SELECT throws_ok(
  $$INSERT INTO league_join_links(league_id, join_code, join_token) VALUES ('88111111-1111-4111-8111-0000000000a1', 'XXXXXX22', gen_random_uuid())$$,
  '42501', NULL, 'the owner cannot write the code directly');
RESET ROLE;

-- Member
SELECT set_config('request.jwt.claims', '{"sub":"88111111-1111-4111-8111-000000000002","email":"jl-member@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM leagues WHERE id = '88111111-1111-4111-8111-0000000000a1'), 1, 'a member still reads the league');
SELECT lives_ok($$SELECT * FROM leagues WHERE id = '88111111-1111-4111-8111-0000000000a1'$$, 'select * on leagues still works');
SELECT is((SELECT count(*)::int FROM league_join_links), 0, 'a member cannot read the join code');
RESET ROLE;

-- Pending invitee
SELECT set_config('request.jwt.claims', '{"sub":"88111111-1111-4111-8111-000000000003","email":"jl-invitee@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM league_join_links), 0, 'a pending invitee cannot read the join code');
RESET ROLE;

-- Deleting the league removes its code.
DELETE FROM leagues WHERE id = '88111111-1111-4111-8111-0000000000a1';
SELECT is((SELECT count(*)::int FROM league_join_links WHERE join_code = 'JKCDEF23'), 0, 'the code goes with its league');

SELECT * FROM finish();
ROLLBACK;
