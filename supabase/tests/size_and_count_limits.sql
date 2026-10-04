BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Size and count limits on client-writable tables
-- (20261004130500_size_and_count_limits.sql).

INSERT INTO auth.users(id, email) VALUES
  ('86111111-1111-4111-8111-000000000001', 'limits-owner@example.test'),
  ('86111111-1111-4111-8111-000000000002', 'limits-member@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('86111111-1111-4111-8111-000000000003', 'Limits league', '86111111-1111-4111-8111-000000000001', 'active', current_date + 60);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('86111111-1111-4111-8111-000000000004', '86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000001', 'owner'),
  ('86111111-1111-4111-8111-000000000005', '86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000002', 'member');
INSERT INTO teams(id, participant_id, name) VALUES
  ('86111111-1111-4111-8111-000000000006', '86111111-1111-4111-8111-000000000004', 'Limits Alpha'),
  ('86111111-1111-4111-8111-000000000007', '86111111-1111-4111-8111-000000000005', 'Limits Beta');
INSERT INTO notifications(id, user_id, league_id, type, title, body) VALUES
  ('86111111-1111-4111-8111-000000000008', '86111111-1111-4111-8111-000000000001', '86111111-1111-4111-8111-000000000003', 'trade_proposed', 'Hello', 'Body');

-- ----------------------------------------------------------------------------
-- leagues
-- ----------------------------------------------------------------------------
SELECT throws_ok($$INSERT INTO leagues(name, owner_id, max_participants) VALUES ('x', '86111111-1111-4111-8111-000000000001', 100000)$$,
  '23514', NULL, 'max_participants is bounded (service role too)');
UPDATE leagues SET max_participants = 8 WHERE id = '86111111-1111-4111-8111-000000000003';
SELECT throws_ok($$UPDATE leagues SET max_participants = 100000 WHERE id = '86111111-1111-4111-8111-000000000003'$$,
  '23514', NULL, 'max_participants cannot be raised to 100000');

SELECT set_config('request.jwt.claim.sub', '86111111-1111-4111-8111-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO leagues(name, owner_id) VALUES ('Direct', '86111111-1111-4111-8111-000000000001')$$,
  '42501', 'permission denied for table leagues', 'clients cannot create leagues directly');
SELECT throws_ok($$UPDATE league_series SET name = repeat('x', 256) WHERE id = (SELECT series_id FROM leagues WHERE id = '86111111-1111-4111-8111-000000000003')$$,
  '23514', NULL, 'series name is bounded');

-- ----------------------------------------------------------------------------
-- wishlisted_movies
-- ----------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO wishlisted_movies(user_id, tmdb_id, title, poster_url) VALUES
  ('86111111-1111-4111-8111-000000000001', 1, 'Real title', 'https://image.tmdb.org/t/p/w500/abc.jpg'),
  ('86111111-1111-4111-8111-000000000001', 2, 'Path poster', '/abc.jpg'),
  ('86111111-1111-4111-8111-000000000001', 3, 'No poster', NULL)$$,
  'normal wishlist rows are accepted');
SELECT throws_ok($$INSERT INTO wishlisted_movies(user_id, tmdb_id, title) VALUES ('86111111-1111-4111-8111-000000000001', 4, repeat('x', 501))$$,
  '23514', NULL, 'oversized wishlist title is refused');
SELECT throws_ok($$INSERT INTO wishlisted_movies(user_id, tmdb_id, title, poster_url) VALUES ('86111111-1111-4111-8111-000000000001', 5, 't', 'https://tracker.example/p.jpg')$$,
  '23514', NULL, 'poster on a foreign host is refused');
SELECT throws_ok($$INSERT INTO wishlisted_movies(user_id, tmdb_id, title, poster_url) VALUES ('86111111-1111-4111-8111-000000000001', 6, 't', '//tracker.example/p.jpg')$$,
  '23514', NULL, 'protocol-relative poster is refused');

RESET ROLE;
INSERT INTO wishlisted_movies(user_id, tmdb_id, title)
SELECT '86111111-1111-4111-8111-000000000001', g, 'Filler' FROM generate_series(100, 596) g;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM wishlisted_movies WHERE user_id = '86111111-1111-4111-8111-000000000001'), 500::BIGINT, 'wishlist is at the cap');
SELECT throws_ok($$INSERT INTO wishlisted_movies(user_id, tmdb_id, title) VALUES ('86111111-1111-4111-8111-000000000001', 7, 'One more')$$,
  '23514', 'Your wishlist is full (500 movies). Remove some to add more.', 'wishlist cap holds for clients');
SELECT lives_ok($$INSERT INTO wishlisted_movies(user_id, tmdb_id, title) VALUES ('86111111-1111-4111-8111-000000000001', 1, 'Real title')
  ON CONFLICT (user_id, tmdb_id) DO UPDATE SET title = EXCLUDED.title$$,
  're-adding a movie already on a full wishlist still works');

-- ----------------------------------------------------------------------------
-- notifications: clients may only mark them read
-- ----------------------------------------------------------------------------
SELECT lives_ok($$UPDATE notifications SET read_at = now() WHERE id = '86111111-1111-4111-8111-000000000008'$$,
  'clients can mark a notification read');
SELECT throws_ok($$UPDATE notifications SET body = repeat('x', 100000) WHERE id = '86111111-1111-4111-8111-000000000008'$$,
  '42501', NULL, 'clients cannot rewrite notification text');

-- ----------------------------------------------------------------------------
-- invitations
-- ----------------------------------------------------------------------------
RESET ROLE;
INSERT INTO invitations(league_id, invited_by, email)
SELECT '86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000001', 'invitee' || g || '@example.test'
FROM generate_series(1, 100) g;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO invitations(league_id, invited_by, email) VALUES ('86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000001', 'one-more@example.test')$$,
  '23514', NULL, 'pending invitations per league are capped');
RESET ROLE;
SELECT lives_ok($$INSERT INTO invitations(league_id, invited_by, email, status) VALUES ('86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000001', 'old@example.test', 'accepted')$$,
  'non-pending invitation rows are not counted against the cap');

-- ----------------------------------------------------------------------------
-- discord_channels
-- ----------------------------------------------------------------------------
SELECT throws_ok($$INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url) VALUES
  ('86111111-1111-4111-8111-000000000003', repeat('1', 101), 'c-long', 'w', 'https://discord.com/api/webhooks/1/x')$$,
  '23514', NULL, 'oversized Discord ids are refused');
INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url)
SELECT '86111111-1111-4111-8111-000000000003', 'g', 'limits-c' || g, 'w', 'https://discord.com/api/webhooks/1/x'
FROM generate_series(1, 25) g;
SELECT throws_ok($$INSERT INTO discord_channels(league_id, guild_id, channel_id, webhook_id, webhook_url) VALUES
  ('86111111-1111-4111-8111-000000000003', 'g', 'limits-c26', 'w', 'https://discord.com/api/webhooks/1/x')$$,
  '23514', NULL, 'linked channels per league are capped');

-- ----------------------------------------------------------------------------
-- trade_offers
-- ----------------------------------------------------------------------------
SELECT throws_ok($$INSERT INTO trade_offers(league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status, initiator_message) VALUES
  ('86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000006', '86111111-1111-4111-8111-000000000007', '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}', 'proposed', repeat('x', 1501))$$,
  '23514', 'Trade messages can be at most 1500 characters', 'oversized trade message is refused');
SELECT lives_ok($$INSERT INTO trade_offers(league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status, initiator_message) VALUES
  ('86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000006', '86111111-1111-4111-8111-000000000007', '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}', 'proposed', repeat('x', 1500))$$,
  'a 1500-character trade message is accepted');
SELECT throws_ok($$UPDATE trade_offers SET veto_reason = repeat('x', 1501) WHERE initiator_team_id = '86111111-1111-4111-8111-000000000006'$$,
  '23514', 'Veto reasons can be at most 1500 characters', 'oversized veto reason is refused');

-- An offer stored before the limit keeps working: expiring it doesn't touch the message.
ALTER TABLE trade_offers DISABLE TRIGGER enforce_trade_offer_limits;
INSERT INTO trade_offers(id, league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status, initiator_message) VALUES
  ('86111111-1111-4111-8111-000000000009', '86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000007', '86111111-1111-4111-8111-000000000006', '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}', 'proposed', repeat('x', 5000));
ALTER TABLE trade_offers ENABLE TRIGGER enforce_trade_offer_limits;
SELECT lives_ok($$UPDATE trade_offers SET status = 'expired', expired_reason = 'offer_window' WHERE id = '86111111-1111-4111-8111-000000000009'$$,
  'a legacy offer with a long message can still be expired');

INSERT INTO trade_offers(league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status)
SELECT '86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000006', '86111111-1111-4111-8111-000000000007', '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}', 'proposed'
FROM generate_series(1, 24);
SELECT throws_ok($$INSERT INTO trade_offers(league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status) VALUES
  ('86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000006', '86111111-1111-4111-8111-000000000007', '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}', 'proposed')$$,
  '23514', NULL, 'open offers per proposing team are capped');
SELECT lives_ok($$INSERT INTO trade_offers(league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status) VALUES
  ('86111111-1111-4111-8111-000000000003', '86111111-1111-4111-8111-000000000007', '86111111-1111-4111-8111-000000000006', '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}', 'proposed')$$,
  'the cap is per team');

-- ----------------------------------------------------------------------------
-- D13
-- ----------------------------------------------------------------------------
SELECT hasnt_function('public', 'process_score_queue', ARRAY[]::TEXT[], 'process_score_queue is gone');

SELECT * FROM finish();
ROLLBACK;
