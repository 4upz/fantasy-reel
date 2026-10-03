BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Avatars render straight from the viewer's browser, so a member must not be
-- able to point one at a server they control and log leaguemates' IPs.

SELECT ok(is_allowed_avatar_url(NULL), 'no avatar is allowed');
SELECT ok(is_allowed_avatar_url('https://abcdefghijklmnop.supabase.co/storage/v1/object/public/avatars/u1/1700000000.png'), 'profile upload URL');
SELECT ok(is_allowed_avatar_url('https://abcdefghijklmnop.supabase.co/storage/v1/object/public/team-avatars/t1/1700000000.webp'), 'team upload URL');
SELECT ok(is_allowed_avatar_url('http://127.0.0.1:54321/storage/v1/object/public/avatars/u1/1.png'), 'local upload URL');
SELECT ok(is_allowed_avatar_url('https://cdn.discordapp.com/avatars/123/abc.png'), 'Discord sign-in photo');
SELECT ok(is_allowed_avatar_url('https://lh3.googleusercontent.com/a/ACg8ocK=s96-c'), 'Google sign-in photo');

SELECT ok(NOT is_allowed_avatar_url('https://attacker.example/pixel.png'), 'arbitrary host');
SELECT ok(NOT is_allowed_avatar_url('http://cdn.discordapp.com/avatars/1/a.png'), 'plain http to Discord');
SELECT ok(NOT is_allowed_avatar_url('https://cdn.discordapp.com.attacker.example/a.png'), 'Discord-prefixed host');
SELECT ok(NOT is_allowed_avatar_url('https://cdn.discordapp.com@attacker.example/a.png'), 'userinfo trick');
SELECT ok(NOT is_allowed_avatar_url('https://attacker.example/?u=https://cdn.discordapp.com/a.png'), 'allowed URL in the query');
SELECT ok(NOT is_allowed_avatar_url('https://abc.supabase.co/storage/v1/object/public/posters/x.png'), 'other storage bucket');
SELECT ok(NOT is_allowed_avatar_url('https://abc.supabase.co/functions/v1/x'), 'non-storage Supabase path');
SELECT ok(NOT is_allowed_avatar_url(E'https://cdn.discordapp.com/\\@attacker.example/a.png'), 'backslash');
SELECT ok(NOT is_allowed_avatar_url('https://cdn.discordapp.com/a b.png'), 'whitespace');
SELECT ok(NOT is_allowed_avatar_url('https://cdn.discordapp.com/' || repeat('a', 2100)), 'over 2048 characters');

INSERT INTO auth.users(id, email) VALUES
  ('87111111-1111-4111-8111-000000000001', 'avatar-member@example.test');
INSERT INTO leagues(id, name, owner_id) VALUES
  ('87111111-1111-4111-8111-000000000002', 'Avatar league', '87111111-1111-4111-8111-000000000001');
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('87111111-1111-4111-8111-000000000003', '87111111-1111-4111-8111-000000000002', '87111111-1111-4111-8111-000000000001', 'owner');
INSERT INTO teams(id, participant_id, name) VALUES
  ('87111111-1111-4111-8111-000000000004', '87111111-1111-4111-8111-000000000003', 'Avatar team');

-- A member writing through the API
SELECT set_config('request.jwt.claims', '{"sub":"87111111-1111-4111-8111-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE profiles SET avatar_url = 'https://attacker.example/pixel.png' WHERE user_id = '87111111-1111-4111-8111-000000000001'$$,
  '23514', 'Avatar must be an uploaded image', 'member cannot point their profile avatar at another host');
SELECT throws_ok(
  $$UPDATE teams SET avatar_url = 'https://attacker.example/pixel.png' WHERE id = '87111111-1111-4111-8111-000000000004'$$,
  '23514', 'Avatar must be an uploaded image', 'member cannot point their team avatar at another host');
SELECT lives_ok(
  $$UPDATE profiles SET avatar_url = 'https://abc.supabase.co/storage/v1/object/public/avatars/87111111-1111-4111-8111-000000000001/1.png' WHERE user_id = '87111111-1111-4111-8111-000000000001'$$,
  'member can save an uploaded profile avatar');
SELECT lives_ok(
  $$UPDATE teams SET avatar_url = 'https://abc.supabase.co/storage/v1/object/public/team-avatars/87111111-1111-4111-8111-000000000004/1.png' WHERE id = '87111111-1111-4111-8111-000000000004'$$,
  'member can save an uploaded team avatar');
SELECT lives_ok(
  $$UPDATE profiles SET avatar_url = NULL WHERE user_id = '87111111-1111-4111-8111-000000000001'$$,
  'member can remove their avatar');
RESET ROLE;

-- A row saved before the check stays editable as long as the avatar is untouched
ALTER TABLE profiles DISABLE TRIGGER enforce_allowed_avatar_url;
UPDATE profiles SET avatar_url = 'https://legacy.example/me.png' WHERE user_id = '87111111-1111-4111-8111-000000000001';
ALTER TABLE profiles ENABLE TRIGGER enforce_allowed_avatar_url;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$UPDATE profiles SET display_name = 'Renamed', avatar_url = avatar_url WHERE user_id = '87111111-1111-4111-8111-000000000001'$$,
  'legacy avatar does not block other profile edits');
RESET ROLE;
SELECT is((SELECT avatar_url FROM profiles WHERE user_id = '87111111-1111-4111-8111-000000000001'),
  'https://legacy.example/me.png', 'legacy avatar is left in place');

-- Server-side writers drop a disallowed avatar instead of failing
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('87111111-1111-4111-8111-000000000005', 'avatar-discord@example.test',
   '{"full_name":"Disco","avatar_url":"https://cdn.discordapp.com/avatars/5/a.png"}'),
  ('87111111-1111-4111-8111-000000000006', 'avatar-odd@example.test',
   '{"full_name":"Odd","avatar_url":"https://attacker.example/pixel.png"}');
SELECT is((SELECT avatar_url FROM profiles WHERE user_id = '87111111-1111-4111-8111-000000000005'),
  'https://cdn.discordapp.com/avatars/5/a.png', 'OAuth sign-up keeps a Discord photo');
SELECT ok(EXISTS (SELECT 1 FROM profiles WHERE user_id = '87111111-1111-4111-8111-000000000006' AND avatar_url IS NULL),
  'OAuth sign-up with an unexpected host still creates the profile, without the avatar');

UPDATE auth.users SET raw_user_meta_data = '{"full_name":"Odd","picture":"https://lh3.googleusercontent.com/a/xyz=s96-c"}'
WHERE id = '87111111-1111-4111-8111-000000000006';
SELECT is((SELECT avatar_url FROM profiles WHERE user_id = '87111111-1111-4111-8111-000000000006'),
  'https://lh3.googleusercontent.com/a/xyz=s96-c', 'OAuth profile sync keeps a Google photo');

SET LOCAL ROLE service_role;
UPDATE teams SET avatar_url = 'https://attacker.example/pixel.png' WHERE id = '87111111-1111-4111-8111-000000000004';
RESET ROLE;
SELECT is((SELECT avatar_url FROM teams WHERE id = '87111111-1111-4111-8111-000000000004'), NULL,
  'service-role write of a disallowed avatar is dropped');

SELECT * FROM finish();
ROLLBACK;
