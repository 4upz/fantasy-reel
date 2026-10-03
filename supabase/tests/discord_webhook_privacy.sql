BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- discord_channels.webhook_url is a credential: only the service role reads it.

INSERT INTO auth.users(id, email) VALUES
  ('85111111-1111-4111-8111-000000000001', 'webhook-owner@example.test'),
  ('85111111-1111-4111-8111-000000000002', 'webhook-member@example.test');
INSERT INTO leagues(id, name, owner_id) VALUES
  ('85111111-1111-4111-8111-000000000003', 'Webhook privacy', '85111111-1111-4111-8111-000000000001');
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('85111111-1111-4111-8111-000000000004', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000001', 'owner'),
  ('85111111-1111-4111-8111-000000000005', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000002', 'member');
INSERT INTO discord_channels(id, league_id, guild_id, channel_id, webhook_id, webhook_url) VALUES
  ('85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000003', 'privacy-guild', 'privacy-channel', 'privacy-webhook', 'https://example.invalid/secret');

SELECT set_config('request.jwt.claim.sub', '85111111-1111-4111-8111-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT webhook_url FROM discord_channels$$, '42501', NULL, 'member cannot read webhook_url');
SELECT throws_ok($$SELECT * FROM discord_channels$$, '42501', NULL, 'member cannot select every column');
SELECT throws_ok($$SELECT webhook_id FROM discord_channels$$, '42501', NULL, 'member cannot read webhook_id');
SELECT is((SELECT channel_id FROM discord_channels), 'privacy-channel', 'member still reads the non-credential columns');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '85111111-1111-4111-8111-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT webhook_url FROM discord_channels$$, '42501', NULL, 'owner cannot read webhook_url either');
SELECT lives_ok($$UPDATE discord_channels SET notify_bids = FALSE WHERE id = '85111111-1111-4111-8111-000000000006'$$, 'owner can still update channel settings');
SELECT is((SELECT notify_bids FROM discord_channels), FALSE, 'owner update applied');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT webhook_url FROM discord_channels$$, '42501', NULL, 'anon cannot read webhook_url');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is((SELECT webhook_url FROM discord_channels WHERE id = '85111111-1111-4111-8111-000000000006'), 'https://example.invalid/secret', 'service role reads webhook_url');

SELECT * FROM finish();
ROLLBACK;
