BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- An invitation stays pinned to the league, recipient and sender it was
-- created with. Invitees may only decline; owners keep cancel and resend.

INSERT INTO auth.users(id, email) VALUES
  ('85111111-1111-4111-8111-000000000001', 'invite-owner@example.test'),
  ('85111111-1111-4111-8111-000000000002', 'invite-target-owner@example.test'),
  ('85111111-1111-4111-8111-000000000003', 'invite-guest@example.test');
INSERT INTO leagues(id, name, owner_id, invite_only) VALUES
  ('85111111-1111-4111-8111-000000000004', 'Inviter league', '85111111-1111-4111-8111-000000000001', true),
  ('85111111-1111-4111-8111-000000000005', 'Second inviter league', '85111111-1111-4111-8111-000000000001', true),
  ('85111111-1111-4111-8111-000000000006', 'Target league', '85111111-1111-4111-8111-000000000002', true);
INSERT INTO invitations(id, league_id, invited_by, email, status) VALUES
  ('85111111-1111-4111-8111-000000000007', '85111111-1111-4111-8111-000000000004', '85111111-1111-4111-8111-000000000001', 'invite-guest@example.test', 'pending'),
  ('85111111-1111-4111-8111-000000000008', '85111111-1111-4111-8111-000000000005', '85111111-1111-4111-8111-000000000001', 'invite-guest@example.test', 'pending'),
  ('85111111-1111-4111-8111-000000000009', '85111111-1111-4111-8111-000000000004', '85111111-1111-4111-8111-000000000001', 'someone-else@example.test', 'pending');

-- The invitee
SELECT set_config('request.jwt.claims', '{"sub":"85111111-1111-4111-8111-000000000003","email":"invite-guest@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE invitations SET league_id = '85111111-1111-4111-8111-000000000006' WHERE id = '85111111-1111-4111-8111-000000000007'$$,
  '42501', NULL, 'invitee cannot point an invitation at another league');
SELECT throws_ok($$UPDATE invitations SET league_id = '85111111-1111-4111-8111-000000000006', status = 'declined' WHERE id = '85111111-1111-4111-8111-000000000007'$$,
  '42501', NULL, 'invitee cannot repoint while declining');
SELECT throws_ok($$UPDATE invitations SET status = 'accepted' WHERE id = '85111111-1111-4111-8111-000000000007'$$,
  '42501', NULL, 'invitee cannot accept without joining');
SELECT throws_ok($$INSERT INTO invitations(league_id, invited_by, email) VALUES ('85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000003', 'invite-guest@example.test')$$,
  '42501', NULL, 'invitee cannot invite themselves to a league they do not own');
SELECT ok(NOT has_pending_invitation('85111111-1111-4111-8111-000000000006'), 'target league stays hidden from the invitee');
SELECT lives_ok($$UPDATE invitations SET status = 'declined', responded_at = now() WHERE id = '85111111-1111-4111-8111-000000000007'$$,
  'invitee can decline (decline-invitation)');
UPDATE invitations SET status = 'pending', responded_at = NULL WHERE id = '85111111-1111-4111-8111-000000000007';
RESET ROLE;
SELECT is((SELECT status::text FROM invitations WHERE id = '85111111-1111-4111-8111-000000000007'), 'declined', 'invitee cannot reopen a declined invitation');
SELECT is((SELECT league_id FROM invitations WHERE id = '85111111-1111-4111-8111-000000000007'), '85111111-1111-4111-8111-000000000004'::uuid, 'declined invitation kept its league');

-- The owner
SELECT set_config('request.jwt.claims', '{"sub":"85111111-1111-4111-8111-000000000001","email":"invite-owner@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO invitations(league_id, invited_by, email, status) VALUES ('85111111-1111-4111-8111-000000000004', '85111111-1111-4111-8111-000000000001', 'new-guest@example.test', 'pending')$$,
  'owner can invite to their league (send-invite)');
SELECT throws_ok($$INSERT INTO invitations(league_id, invited_by, email) VALUES ('85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000001', 'new-guest@example.test')$$,
  '42501', NULL, 'owner cannot invite to a league they do not own');
SELECT lives_ok($$UPDATE invitations SET status = 'cancelled', responded_at = now() WHERE id = '85111111-1111-4111-8111-000000000009'$$,
  'owner can cancel (cancel-invitation)');
SELECT lives_ok($$UPDATE invitations SET token = gen_random_uuid(), expires_at = now() + interval '7 days', status = 'pending', sent_at = now(), responded_at = NULL WHERE id = '85111111-1111-4111-8111-000000000009'$$,
  'owner can resend (resend-invitation)');
SELECT is((SELECT status::text FROM invitations WHERE id = '85111111-1111-4111-8111-000000000009'), 'pending', 'resend reopened the invitation');
SELECT throws_ok($$UPDATE invitations SET league_id = '85111111-1111-4111-8111-000000000005' WHERE id = '85111111-1111-4111-8111-000000000009'$$,
  '42501', 'An invitation''s league, recipient and sender cannot be changed', 'owner cannot move an invitation between their own leagues');
SELECT throws_ok($$UPDATE invitations SET league_id = '85111111-1111-4111-8111-000000000006' WHERE id = '85111111-1111-4111-8111-000000000009'$$,
  '42501', NULL, 'owner cannot move an invitation into a foreign league');
SELECT throws_ok($$UPDATE invitations SET email = 'invite-guest@example.test' WHERE id = '85111111-1111-4111-8111-000000000009'$$,
  '42501', 'An invitation''s league, recipient and sender cannot be changed', 'owner cannot readdress an invitation');
SELECT throws_ok($$UPDATE invitations SET invited_by = '85111111-1111-4111-8111-000000000002' WHERE id = '85111111-1111-4111-8111-000000000009'$$,
  '42501', 'An invitation''s league, recipient and sender cannot be changed', 'owner cannot reassign the sender');
RESET ROLE;

-- The service role (join-league accepts here)
SET LOCAL ROLE service_role;
SELECT lives_ok($$UPDATE invitations SET status = 'accepted', responded_at = now() WHERE id = '85111111-1111-4111-8111-000000000008'$$,
  'join-league can accept');
SELECT throws_ok($$UPDATE invitations SET league_id = '85111111-1111-4111-8111-000000000006' WHERE id = '85111111-1111-4111-8111-000000000008'$$,
  '42501', 'An invitation''s league, recipient and sender cannot be changed', 'no writer can repoint an invitation');
RESET ROLE;

SELECT lives_ok($$DELETE FROM leagues WHERE id = '85111111-1111-4111-8111-000000000005'$$, 'deleting a league still cascades to its invitations');

SELECT * FROM finish();
ROLLBACK;
