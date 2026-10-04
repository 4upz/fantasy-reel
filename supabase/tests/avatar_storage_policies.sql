BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Each owner can write exactly one avatar object, `<folder>/avatar`, and can
-- still list and delete whatever older uploads left in their own folder.

INSERT INTO auth.users(id, email) VALUES
  ('88222222-2222-4222-8222-000000000001', 'as-owner@example.test'),
  ('88222222-2222-4222-8222-000000000002', 'as-other@example.test');
INSERT INTO leagues(id, name, owner_id) VALUES
  ('88222222-2222-4222-8222-0000000000a1', 'Avatar storage league', '88222222-2222-4222-8222-000000000001');
INSERT INTO league_participants(id, league_id, user_id, role, status) VALUES
  ('88222222-2222-4222-8222-0000000000b1', '88222222-2222-4222-8222-0000000000a1', '88222222-2222-4222-8222-000000000001', 'owner', 'active'),
  ('88222222-2222-4222-8222-0000000000b2', '88222222-2222-4222-8222-0000000000a1', '88222222-2222-4222-8222-000000000002', 'member', 'active');
INSERT INTO teams(id, participant_id, name) VALUES
  ('88222222-2222-4222-8222-0000000000c1', '88222222-2222-4222-8222-0000000000b1', 'Owner Team'),
  ('88222222-2222-4222-8222-0000000000c2', '88222222-2222-4222-8222-0000000000b2', 'Other Team');

-- Files written by the old timestamped uploads, plus an odd name nobody's
-- policy should choke on.
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('avatars', '88222222-2222-4222-8222-000000000001/1700000000000.jpg'),
  ('avatars', '88222222-2222-4222-8222-000000000002/1700000000000.png'),
  ('team-avatars', '88222222-2222-4222-8222-0000000000c1/1700000000000.jpg'),
  ('team-avatars', 'not-a-team/avatar');

SELECT set_config('request.jwt.claims', '{"sub":"88222222-2222-4222-8222-000000000001","role":"authenticated"}', true);
-- Storage blocks direct DELETEs on its tables unless this is set, as the
-- Storage API does for its own deletes.
SELECT set_config('storage.allow_delete_query', 'true', true);
SET LOCAL ROLE authenticated;

-- Profile avatars
SELECT lives_ok(
  $$INSERT INTO storage.objects(bucket_id, name) VALUES ('avatars', '88222222-2222-4222-8222-000000000001/avatar')$$,
  'a user can write their own avatar object');
SELECT throws_ok(
  $$INSERT INTO storage.objects(bucket_id, name) VALUES ('avatars', '88222222-2222-4222-8222-000000000001/1700000000001.jpg')$$,
  '42501', NULL, 'a user cannot add another file to their folder');
SELECT throws_ok(
  $$INSERT INTO storage.objects(bucket_id, name) VALUES ('avatars', '88222222-2222-4222-8222-000000000002/avatar')$$,
  '42501', NULL, 'a user cannot write someone else''s avatar');
SELECT lives_ok(
  $$UPDATE storage.objects SET metadata = '{"size":1}' WHERE bucket_id = 'avatars' AND name = '88222222-2222-4222-8222-000000000001/avatar'$$,
  'a user can overwrite their own avatar object');
SELECT throws_ok(
  $$UPDATE storage.objects SET name = '88222222-2222-4222-8222-000000000001/copy.jpg' WHERE bucket_id = 'avatars' AND name = '88222222-2222-4222-8222-000000000001/avatar'$$,
  '42501', NULL, 'a user cannot rename their avatar to a second name');
SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM storage.objects WHERE bucket_id = 'avatars'),
  ARRAY['88222222-2222-4222-8222-000000000001/1700000000000.jpg', '88222222-2222-4222-8222-000000000001/avatar'],
  'a user lists only their own folder');
SELECT lives_ok(
  $$DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = '88222222-2222-4222-8222-000000000001/1700000000000.jpg'$$,
  'a user can delete an older upload');

-- Team avatars
SELECT lives_ok(
  $$INSERT INTO storage.objects(bucket_id, name) VALUES ('team-avatars', '88222222-2222-4222-8222-0000000000c1/avatar')$$,
  'a team owner can write the team avatar object');
SELECT throws_ok(
  $$INSERT INTO storage.objects(bucket_id, name) VALUES ('team-avatars', '88222222-2222-4222-8222-0000000000c1/1700000000001.jpg')$$,
  '42501', NULL, 'a team owner cannot add another file to the team folder');
SELECT throws_ok(
  $$INSERT INTO storage.objects(bucket_id, name) VALUES ('team-avatars', '88222222-2222-4222-8222-0000000000c2/avatar')$$,
  '42501', NULL, 'a user cannot write another team''s avatar');
SELECT throws_ok(
  $$INSERT INTO storage.objects(bucket_id, name) VALUES ('team-avatars', 'not-a-team/avatar2')$$,
  '42501', NULL, 'a malformed team folder is refused, not a cast error');
SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM storage.objects WHERE bucket_id = 'team-avatars'),
  ARRAY['88222222-2222-4222-8222-0000000000c1/1700000000000.jpg', '88222222-2222-4222-8222-0000000000c1/avatar'],
  'a team owner lists only their team folder');
SELECT lives_ok(
  $$DELETE FROM storage.objects WHERE bucket_id = 'team-avatars' AND name = '88222222-2222-4222-8222-0000000000c1/1700000000000.jpg'$$,
  'a team owner can delete an older upload');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name LIKE '88222222-2222-4222-8222-000000000001/%' OR name LIKE '88222222-2222-4222-8222-0000000000c1/%'),
  2, 'after cleanup each owner holds just their avatar object');

SELECT * FROM finish();
ROLLBACK;
