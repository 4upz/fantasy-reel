BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- A username invite's email was resolved server-side. The owner sees the
-- invitee's name, never that address; the invitee still sees their invite.

INSERT INTO auth.users(id, email) VALUES
  ('86111111-1111-4111-8111-000000000001', 'privacy-owner@example.test'),
  ('86111111-1111-4111-8111-000000000002', 'privacy-guest@example.test'),
  ('86111111-1111-4111-8111-000000000003', 'privacy-stranger@example.test');
UPDATE profiles SET display_name = 'Privacy Guest' WHERE user_id = '86111111-1111-4111-8111-000000000002';
INSERT INTO profiles(user_id, display_name)
SELECT '86111111-1111-4111-8111-000000000002', 'Privacy Guest'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = '86111111-1111-4111-8111-000000000002');
INSERT INTO leagues(id, name, owner_id) VALUES
  ('86111111-1111-4111-8111-000000000004', 'Privacy league', '86111111-1111-4111-8111-000000000001');
INSERT INTO invitations(id, league_id, invited_by, email, invited_user_id, status) VALUES
  ('86111111-1111-4111-8111-000000000005', '86111111-1111-4111-8111-000000000004', '86111111-1111-4111-8111-000000000001',
   'privacy-guest@example.test', '86111111-1111-4111-8111-000000000002', 'pending'),
  ('86111111-1111-4111-8111-000000000006', '86111111-1111-4111-8111-000000000004', '86111111-1111-4111-8111-000000000001',
   'typed@example.test', NULL, 'pending');

-- The owner
SELECT set_config('request.jwt.claims', '{"sub":"86111111-1111-4111-8111-000000000001","email":"privacy-owner@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM invitations WHERE id = '86111111-1111-4111-8111-000000000005'), 0,
  'owner cannot read a username invite row');
SELECT is((SELECT email::text FROM invitations WHERE id = '86111111-1111-4111-8111-000000000006'), 'typed@example.test',
  'owner still reads an invite they addressed');
SELECT is((SELECT email::text FROM get_league_invitations('86111111-1111-4111-8111-000000000004') WHERE id = '86111111-1111-4111-8111-000000000005'), NULL,
  'list withholds the username invite email');
SELECT is((SELECT invitee_display_name FROM get_league_invitations('86111111-1111-4111-8111-000000000004') WHERE id = '86111111-1111-4111-8111-000000000005'), 'Privacy Guest',
  'list names the username invitee');
SELECT is((SELECT email::text FROM get_league_invitations('86111111-1111-4111-8111-000000000004') WHERE id = '86111111-1111-4111-8111-000000000006'), 'typed@example.test',
  'list keeps a typed email');
RESET ROLE;

-- The invitee
SELECT set_config('request.jwt.claims', '{"sub":"86111111-1111-4111-8111-000000000002","email":"privacy-guest@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM invitations WHERE id = '86111111-1111-4111-8111-000000000005'), 1,
  'invitee still sees their username invite');
RESET ROLE;

-- Someone else
SELECT set_config('request.jwt.claims', '{"sub":"86111111-1111-4111-8111-000000000003","email":"privacy-stranger@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM get_league_invitations('86111111-1111-4111-8111-000000000004')), 0,
  'a non-owner gets no invitations from the list');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM get_league_invitations('86111111-1111-4111-8111-000000000004')$$,
  '42501', NULL, 'anon cannot call the list');
RESET ROLE;

-- The marker can't be cleared to unmask the row, even by the service role
SELECT throws_ok($$UPDATE invitations SET invited_user_id = NULL WHERE id = '86111111-1111-4111-8111-000000000005'$$,
  '42501', 'An invitation''s invited user cannot be changed', 'invited_user_id is write-once');
SELECT lives_ok($$UPDATE invitations SET status = 'cancelled', responded_at = now() WHERE id = '86111111-1111-4111-8111-000000000005'$$,
  'status changes still work');

SELECT * FROM finish();
ROLLBACK;
