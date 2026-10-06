BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Only the Discord bot (service role) creates channel links or changes where
-- they post; owners keep the notification toggles and unlinking, and
-- webhook_url must be a Discord webhook endpoint.

INSERT INTO auth.users(id, email) VALUES
  ('85222222-2222-4222-8222-000000000001', 'restrict-owner@example.test');
INSERT INTO leagues(id, name, owner_id) VALUES
  ('85222222-2222-4222-8222-000000000003', 'Webhook restrictions', '85222222-2222-4222-8222-000000000001');
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('85222222-2222-4222-8222-000000000004', '85222222-2222-4222-8222-000000000003', '85222222-2222-4222-8222-000000000001', 'owner');
INSERT INTO discord_channels(id, league_id, guild_id, channel_id, webhook_id, webhook_url) VALUES
  ('85222222-2222-4222-8222-000000000006', '85222222-2222-4222-8222-000000000003', 'restrict-guild', 'restrict-channel', 'restrict-webhook', 'https://discord.com/api/webhooks/1/token');

SELECT is(
  (SELECT convalidated FROM pg_constraint WHERE conname = 'discord_channels_webhook_url_host'),
  TRUE, 'webhook host constraint is validated');

-- Owner, through the Data API.
SELECT set_config('request.jwt.claim.sub', '85222222-2222-4222-8222-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$
  INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url)
  VALUES ('85222222-2222-4222-8222-000000000003', 'g', 'someone-elses-channel', 'w', 'https://discord.com/api/webhooks/2/token')
$$, '42501', NULL, 'owner cannot create a channel link directly');

SELECT throws_ok($$
  UPDATE discord_channels SET webhook_url = 'http://169.254.169.254/latest/meta-data'
  WHERE id = '85222222-2222-4222-8222-000000000006'
$$, '42501', NULL, 'owner cannot change webhook_url');

SELECT throws_ok($$
  UPDATE discord_channels SET channel_id = 'another-channel'
  WHERE id = '85222222-2222-4222-8222-000000000006'
$$, '42501', NULL, 'owner cannot move the link to another channel');

SELECT throws_ok($$
  UPDATE discord_channels SET bid_alert_role_id = '1'
  WHERE id = '85222222-2222-4222-8222-000000000006'
$$, '42501', NULL, 'owner cannot set mention roles directly');

SELECT lives_ok($$
  UPDATE discord_channels SET notify_scores = FALSE, enabled = FALSE
  WHERE id = '85222222-2222-4222-8222-000000000006'
$$, 'owner can still change notification toggles');

SELECT lives_ok($$
  DELETE FROM discord_channels WHERE id = '85222222-2222-4222-8222-000000000006'
$$, 'owner can still unlink');

RESET ROLE;

-- The bot's service role: Discord webhook URLs only.
SET LOCAL ROLE service_role;

SELECT lives_ok($$
  INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url)
  VALUES ('85222222-2222-4222-8222-000000000003', 'g', 'c-discord', 'w', 'https://discord.com/api/webhooks/123/abc-DEF_456')
$$, 'discord.com webhook accepted');

SELECT lives_ok($$
  INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url)
  VALUES ('85222222-2222-4222-8222-000000000003', 'g', 'c-discordapp', 'w', 'https://discordapp.com/api/v10/webhooks/123/abc')
$$, 'discordapp.com versioned webhook accepted');

SELECT throws_ok($$
  INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url)
  VALUES ('85222222-2222-4222-8222-000000000003', 'g', 'c-meta', 'w', 'http://169.254.169.254/latest/meta-data')
$$, '23514', NULL, 'metadata address rejected');

SELECT throws_ok($$
  INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url)
  VALUES ('85222222-2222-4222-8222-000000000003', 'g', 'c-lookalike', 'w', 'https://discord.com.evil.example/api/webhooks/1/token')
$$, '23514', NULL, 'look-alike host rejected');

SELECT throws_ok($$
  INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url)
  VALUES ('85222222-2222-4222-8222-000000000003', 'g', 'c-userinfo', 'w', 'https://discord.com@evil.example/api/webhooks/1/token')
$$, '23514', NULL, 'userinfo trick rejected');

SELECT throws_ok($$
  INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url)
  VALUES ('85222222-2222-4222-8222-000000000003', 'g', 'c-http', 'w', 'http://discord.com/api/webhooks/1/token')
$$, '23514', NULL, 'plain http to Discord rejected');

SELECT * FROM finish();
ROLLBACK;
