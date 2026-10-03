BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Profiles are visible to yourself, your leaguemates, and whoever invited
-- you to a league. Signed-out visitors can't read them at all.

INSERT INTO auth.users(id, email) VALUES
  ('87111111-1111-4111-8111-000000000001', 'pv-owner@example.test'),
  ('87111111-1111-4111-8111-000000000002', 'pv-member@example.test'),
  ('87111111-1111-4111-8111-000000000003', 'pv-left@example.test'),
  ('87111111-1111-4111-8111-000000000004', 'pv-stranger@example.test'),
  ('87111111-1111-4111-8111-000000000005', 'pv-invitee@example.test'),
  ('87111111-1111-4111-8111-000000000006', 'pv-kicked@example.test'),
  ('87111111-1111-4111-8111-000000000007', 'pv-commish@example.test');
INSERT INTO profiles(user_id, display_name)
SELECT id, split_part(email, '@', 1) FROM auth.users WHERE id::text LIKE '87111111-%'
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO leagues(id, name, owner_id) VALUES
  ('87111111-1111-4111-8111-0000000000a1', 'Visibility league', '87111111-1111-4111-8111-000000000001'),
  ('87111111-1111-4111-8111-0000000000a2', 'Commish-only league', '87111111-1111-4111-8111-000000000007');
INSERT INTO league_participants(league_id, user_id, role, status) VALUES
  ('87111111-1111-4111-8111-0000000000a1', '87111111-1111-4111-8111-000000000001', 'owner', 'active'),
  ('87111111-1111-4111-8111-0000000000a1', '87111111-1111-4111-8111-000000000002', 'member', 'active'),
  ('87111111-1111-4111-8111-0000000000a1', '87111111-1111-4111-8111-000000000003', 'member', 'left'),
  ('87111111-1111-4111-8111-0000000000a1', '87111111-1111-4111-8111-000000000006', 'member', 'kicked'),
  -- The commissioner of league a2 isn't a participant of it.
  ('87111111-1111-4111-8111-0000000000a2', '87111111-1111-4111-8111-000000000002', 'member', 'active');
INSERT INTO invitations(league_id, invited_by, email, status) VALUES
  ('87111111-1111-4111-8111-0000000000a1', '87111111-1111-4111-8111-000000000001', 'pv-invitee@example.test', 'pending');

CREATE TEMP VIEW pv_visible WITH (security_invoker = true) AS
  SELECT array_agg(split_part(display_name, '-', 2) ORDER BY display_name) AS names
  FROM profiles WHERE user_id::text LIKE '87111111-%';
GRANT SELECT ON pv_visible TO authenticated, anon;

-- Signed out
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT user_id, display_name, avatar_url FROM profiles$$,
  '42501', NULL, 'anon cannot read profiles');
SELECT throws_ok($$SELECT * FROM visible_profile_user_ids()$$,
  '42501', NULL, 'anon cannot call the visibility helper');
RESET ROLE;

-- A member sees every participant row in their leagues, including people
-- who left or were removed (history still names them), and their other
-- league's commissioner is not exposed unless they're a participant.
SELECT set_config('request.jwt.claims', '{"sub":"87111111-1111-4111-8111-000000000002","email":"pv-member@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT names FROM pv_visible), ARRAY['kicked','left','member','owner'],
  'a member sees themselves and everyone in their leagues');
SELECT is(
  (SELECT count(*)::int FROM league_participants lp JOIN profiles p ON p.user_id = lp.user_id
   WHERE lp.league_id = '87111111-1111-4111-8111-0000000000a1'),
  4, 'every participant row in a member''s league resolves a profile');
SELECT lives_ok($$UPDATE profiles SET wishlist_public = true WHERE user_id = '87111111-1111-4111-8111-000000000002'$$,
  'a user can still update their own profile');
SELECT is((SELECT wishlist_public FROM profiles WHERE user_id = '87111111-1111-4111-8111-000000000002'), true,
  'the update took effect');
RESET ROLE;

-- An owner who isn't a participant still sees their league's members
SELECT set_config('request.jwt.claims', '{"sub":"87111111-1111-4111-8111-000000000007","email":"pv-commish@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT names FROM pv_visible), ARRAY['commish','member'],
  'an owner sees their league''s members');
RESET ROLE;

-- Someone who has left sees only themselves
SELECT set_config('request.jwt.claims', '{"sub":"87111111-1111-4111-8111-000000000003","email":"pv-left@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT names FROM pv_visible), ARRAY['left'],
  'a former member sees only their own profile');
RESET ROLE;

-- A pending invitee sees who invited them, not the rest of the league
SELECT set_config('request.jwt.claims', '{"sub":"87111111-1111-4111-8111-000000000005","email":"pv-invitee@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT names FROM pv_visible), ARRAY['invitee','owner'],
  'an invitee sees their inviter');
RESET ROLE;

-- A stranger sees only themselves
SELECT set_config('request.jwt.claims', '{"sub":"87111111-1111-4111-8111-000000000004","email":"pv-stranger@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT names FROM pv_visible), ARRAY['stranger'],
  'a signed-in stranger sees only their own profile');
SELECT is((SELECT count(*)::int FROM profiles WHERE user_id <> '87111111-1111-4111-8111-000000000004'), 0,
  'a stranger cannot list other users');
RESET ROLE;

-- The service role is unaffected
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM profiles WHERE user_id::text LIKE '87111111-%'), 7,
  'the service role still reads every profile');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
