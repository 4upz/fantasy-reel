BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Supabase Auth rewrites raw_user_meta_data with whichever identity signed in
-- last. The profile picture must stay the one the account started with.

SELECT is(oauth_avatar_provider('https://cdn.discordapp.com/avatars/1/a.png'), 'discord', 'Discord photo');
SELECT is(oauth_avatar_provider('https://lh3.googleusercontent.com/a/x=s96-c'), 'google', 'Google photo');
SELECT is(oauth_avatar_provider('https://api.fantasyreel.com/storage/v1/object/public/avatars/u/1.png'), NULL, 'upload');
SELECT is(oauth_avatar_provider('https://cdn.discordapp.com.attacker.example/a.png'), NULL, 'Discord-prefixed host');
SELECT is(oauth_avatar_provider(NULL), NULL, 'no avatar');

INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('88111111-1111-4111-8111-000000000001', 'sync-discord@example.test',
   '{"full_name":"Disco","avatar_url":"https://cdn.discordapp.com/avatars/1/first.png"}'),
  ('88111111-1111-4111-8111-000000000002', 'sync-upload@example.test',
   '{"full_name":"Upload","avatar_url":"https://cdn.discordapp.com/avatars/2/first.png"}'),
  ('88111111-1111-4111-8111-000000000003', 'sync-email@example.test',
   '{"display_name":"Emailer"}');

-- Linking Google to a Discord account
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data
  || '{"avatar_url":"https://lh3.googleusercontent.com/a/g1=s96-c","picture":"https://lh3.googleusercontent.com/a/g1=s96-c"}'
WHERE id = '88111111-1111-4111-8111-000000000001';
SELECT is((SELECT avatar_url FROM profiles WHERE user_id = '88111111-1111-4111-8111-000000000001'),
  'https://cdn.discordapp.com/avatars/1/first.png', 'signing in with Google keeps the Discord photo');

-- Changing the Discord avatar refreshes the stored Discord URL
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data
  || '{"avatar_url":"https://cdn.discordapp.com/avatars/1/second.png"}'
WHERE id = '88111111-1111-4111-8111-000000000001';
SELECT is((SELECT avatar_url FROM profiles WHERE user_id = '88111111-1111-4111-8111-000000000001'),
  'https://cdn.discordapp.com/avatars/1/second.png', 'a new Discord avatar replaces the old Discord URL');

-- An uploaded avatar survives any metadata write, such as the display-name sync
UPDATE profiles SET avatar_url = 'https://api.fantasyreel.com/storage/v1/object/public/avatars/88111111-1111-4111-8111-000000000002/1.png'
WHERE user_id = '88111111-1111-4111-8111-000000000002';
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"display_name":"Renamed"}'
WHERE id = '88111111-1111-4111-8111-000000000002';
SELECT is((SELECT avatar_url FROM profiles WHERE user_id = '88111111-1111-4111-8111-000000000002'),
  'https://api.fantasyreel.com/storage/v1/object/public/avatars/88111111-1111-4111-8111-000000000002/1.png',
  'a display-name change keeps the uploaded avatar');

-- An email account with no picture does not take one from a linked provider
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data
  || '{"avatar_url":"https://cdn.discordapp.com/avatars/3/a.png"}'
WHERE id = '88111111-1111-4111-8111-000000000003';
SELECT is((SELECT avatar_url FROM profiles WHERE user_id = '88111111-1111-4111-8111-000000000003'),
  NULL, 'linking Discord to an email account leaves it without a photo');

SELECT * FROM finish();
ROLLBACK;
