BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- discord_channels_safe must not let anyone without an account read or change
-- Discord settings, and must apply the discord_channels RLS policies to readers.

SELECT ok('security_invoker=true' = ANY(c.reloptions),
  'discord_channels_safe runs with the caller''s privileges')
  FROM pg_class c WHERE c.oid = 'public.discord_channels_safe'::regclass;

SELECT is(has_table_privilege('anon', 'public.discord_channels_safe', 'SELECT'), false, 'anon cannot read the view');
SELECT is(has_table_privilege('anon', 'public.discord_channels_safe', 'INSERT'), false, 'anon cannot insert through the view');
SELECT is(has_table_privilege('anon', 'public.discord_channels_safe', 'UPDATE'), false, 'anon cannot update through the view');
SELECT is(has_table_privilege('anon', 'public.discord_channels_safe', 'DELETE'), false, 'anon cannot delete through the view');

SELECT is(has_table_privilege('authenticated', 'public.discord_channels_safe', 'SELECT'), true, 'signed-in users can still read the view');
SELECT is(has_table_privilege('authenticated', 'public.discord_channels_safe', 'INSERT'), false, 'signed-in users cannot insert through the view');
SELECT is(has_table_privilege('authenticated', 'public.discord_channels_safe', 'UPDATE'), false, 'signed-in users cannot update through the view');
SELECT is(has_table_privilege('authenticated', 'public.discord_channels_safe', 'DELETE'), false, 'signed-in users cannot delete through the view');

SELECT is(has_table_privilege('service_role', 'public.discord_channels_safe', 'SELECT'), true, 'service_role keeps access');

-- A signed-in user only sees channels for leagues they belong to.
INSERT INTO auth.users(id, email) VALUES
  ('d15c0000-0000-4000-8000-000000000001', 'discord-safe-owner@example.test'),
  ('d15c0000-0000-4000-8000-000000000002', 'discord-safe-outsider@example.test');
INSERT INTO leagues(id, name, owner_id) VALUES
  ('d15c0000-0000-4000-8000-000000000003', 'Discord safe view', 'd15c0000-0000-4000-8000-000000000001');
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('d15c0000-0000-4000-8000-000000000004', 'd15c0000-0000-4000-8000-000000000003', 'd15c0000-0000-4000-8000-000000000001', 'owner');
INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url) VALUES
  ('d15c0000-0000-4000-8000-000000000003', 'g-safe', 'c-safe', 'w-safe', 'https://discord.com/api/webhooks/1/token');

SELECT set_config('request.jwt.claims', '{"sub":"d15c0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM discord_channels_safe WHERE channel_id = 'c-safe'), 0,
  'a non-member sees no rows for another league');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d15c0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM discord_channels_safe WHERE channel_id = 'c-safe'), 1,
  'a league member still sees their league''s channel');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
