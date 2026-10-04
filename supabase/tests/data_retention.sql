BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- ---------------------------------------------------------------------------
-- purge_expired_data: service role only
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege(r, 'purge_expired_data(integer)', 'EXECUTE'), r || ' cannot purge')
FROM unnest(ARRAY['anon', 'authenticated']) AS r;
SELECT ok(has_function_privilege('service_role', 'purge_expired_data(integer)', 'EXECUTE'), 'service_role can purge');

INSERT INTO auth.users (id, email) VALUES
  ('8d600000-0000-4000-8000-000000000001', 'owner@retention.test'),
  ('8d600000-0000-4000-8000-000000000002', 'member@retention.test');

-- One season still running, one completed long ago, one completed recently.
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('8d600000-0000-4000-8000-000000000010', 'Running', '8d600000-0000-4000-8000-000000000001', 'active', current_date + 60),
  ('8d600000-0000-4000-8000-000000000011', 'Old season', '8d600000-0000-4000-8000-000000000001', 'active', current_date - 200),
  ('8d600000-0000-4000-8000-000000000012', 'Recent season', '8d600000-0000-4000-8000-000000000001', 'active', current_date - 5),
  ('8d600000-0000-4000-8000-000000000013', 'Drafting', '8d600000-0000-4000-8000-000000000001', 'drafting', current_date + 60);

-- Completion is write-once through the real path; the test only needs the end
-- state, so set it with the guards out of the way.
SET LOCAL session_replication_role = replica;
UPDATE leagues SET status = 'completed', completed_at = now() - interval '120 days'
WHERE id = '8d600000-0000-4000-8000-000000000011';
UPDATE leagues SET status = 'completed', completed_at = now() - interval '10 days'
WHERE id = '8d600000-0000-4000-8000-000000000012';
SET LOCAL session_replication_role = origin;

-- notification_log
INSERT INTO notification_log (id, notification_type, recipient_email, status, created_at) VALUES
  ('8d600000-0000-4000-8000-000000000101', 'trade_proposed', 'old@retention.test', 'sent', now() - interval '91 days'),
  ('8d600000-0000-4000-8000-000000000102', 'trade_proposed', 'new@retention.test', 'sent', now() - interval '89 days');

-- invitations (triggers off so updated_at keeps the backdated value)
SET LOCAL session_replication_role = replica;
INSERT INTO invitations (id, league_id, invited_by, email, status, sent_at, expires_at, responded_at, updated_at) VALUES
  -- dead for > 30 days: deleted
  ('8d600000-0000-4000-8000-000000000201', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000001', 'declined@retention.test', 'declined', now() - interval '60 days', now() - interval '53 days', now() - interval '40 days', now() - interval '40 days'),
  ('8d600000-0000-4000-8000-000000000202', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000001', 'cancelled@retention.test', 'cancelled', now() - interval '60 days', now() - interval '53 days', NULL, now() - interval '45 days'),
  ('8d600000-0000-4000-8000-000000000203', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000001', 'lapsed@retention.test', 'pending', now() - interval '60 days', now() - interval '31 days', NULL, now() - interval '60 days'),
  -- recently dead: kept
  ('8d600000-0000-4000-8000-000000000204', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000001', 'recent-decline@retention.test', 'declined', now() - interval '20 days', now() - interval '13 days', now() - interval '10 days', now() - interval '10 days'),
  ('8d600000-0000-4000-8000-000000000205', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000001', 'recent-lapse@retention.test', 'pending', now() - interval '20 days', now() - interval '13 days', NULL, now() - interval '20 days'),
  -- open: never deleted, however old it was sent
  ('8d600000-0000-4000-8000-000000000206', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000001', 'open@retention.test', 'pending', now() - interval '400 days', now() + interval '2 days', NULL, now() - interval '400 days'),
  -- accepted: kept while the season runs or recently ended, deleted 30 days after completion
  ('8d600000-0000-4000-8000-000000000207', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000001', 'accepted-running@retention.test', 'accepted', now() - interval '300 days', now() - interval '293 days', now() - interval '299 days', now() - interval '299 days'),
  ('8d600000-0000-4000-8000-000000000208', '8d600000-0000-4000-8000-000000000011', '8d600000-0000-4000-8000-000000000001', 'accepted-old@retention.test', 'accepted', now() - interval '300 days', now() - interval '293 days', now() - interval '299 days', now() - interval '299 days'),
  ('8d600000-0000-4000-8000-000000000209', '8d600000-0000-4000-8000-000000000012', '8d600000-0000-4000-8000-000000000001', 'accepted-recent@retention.test', 'accepted', now() - interval '300 days', now() - interval '293 days', now() - interval '299 days', now() - interval '299 days');
SET LOCAL session_replication_role = origin;

-- in-app notifications
INSERT INTO notifications (id, user_id, type, title, body, read_at, created_at) VALUES
  ('8d600000-0000-4000-8000-000000000301', '8d600000-0000-4000-8000-000000000002', 'outbid', 't', 'b', now() - interval '95 days', now() - interval '100 days'),
  ('8d600000-0000-4000-8000-000000000302', '8d600000-0000-4000-8000-000000000002', 'outbid', 't', 'b', NULL, now() - interval '100 days'),
  ('8d600000-0000-4000-8000-000000000303', '8d600000-0000-4000-8000-000000000002', 'outbid', 't', 'b', NULL, now() - interval '181 days'),
  ('8d600000-0000-4000-8000-000000000304', '8d600000-0000-4000-8000-000000000002', 'outbid', 't', 'b', now(), now() - interval '10 days');

-- draft outbox
INSERT INTO discord_channels(id, league_id, guild_id, channel_id, webhook_id, webhook_url) VALUES
  ('8d600000-0000-4000-8000-000000000401', '8d600000-0000-4000-8000-000000000010', 'g1', 'c1', 'w1', 'https://discord.com/api/webhooks/1/a'),
  ('8d600000-0000-4000-8000-000000000402', '8d600000-0000-4000-8000-000000000013', 'g2', 'c2', 'w2', 'https://discord.com/api/webhooks/2/b');
INSERT INTO draft_notification_outbox (id, league_id, channel_id, event_key, kind, status, created_at, delivered_at) VALUES
  ('8d600000-0000-4000-8000-000000000411', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000401', 'e1', 'draft_pick', 'sent', now() - interval '20 days', now() - interval '8 days'),
  ('8d600000-0000-4000-8000-000000000412', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000401', 'e2', 'draft_pick', 'sent', now() - interval '20 days', now() - interval '6 days'),
  ('8d600000-0000-4000-8000-000000000413', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000401', 'e3', 'draft_pick', 'pending', now() - interval '60 days', NULL),
  ('8d600000-0000-4000-8000-000000000414', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000401', 'e4', 'draft_pick', 'failed', now() - interval '20 days', NULL),
  ('8d600000-0000-4000-8000-000000000415', '8d600000-0000-4000-8000-000000000010', '8d600000-0000-4000-8000-000000000401', 'e5', 'draft_pick', 'failed', now() - interval '31 days', NULL),
  ('8d600000-0000-4000-8000-000000000416', '8d600000-0000-4000-8000-000000000013', '8d600000-0000-4000-8000-000000000402', 'e6', 'draft_pick', 'sent', now() - interval '60 days', now() - interval '60 days');

-- Discord dedupe log
INSERT INTO discord_notification_log (id, league_id, movie_id, notification_type, created_at) VALUES
  ('8d600000-0000-4000-8000-000000000501', '8d600000-0000-4000-8000-000000000011', NULL, 'season_end_reminder:old', now() - interval '130 days'),
  ('8d600000-0000-4000-8000-000000000502', '8d600000-0000-4000-8000-000000000010', NULL, 'season_end_reminder:running', now() - interval '300 days'),
  ('8d600000-0000-4000-8000-000000000503', '8d600000-0000-4000-8000-000000000012', NULL, 'season_end_reminder:recent', now() - interval '300 days');

SET LOCAL ROLE service_role;
SELECT is(
  purge_expired_data(),
  '{"notification_log": 1, "invitations": 4, "notifications": 2, "draft_notification_outbox": 2, "discord_notification_log": 1, "more_remaining": false}'::jsonb,
  'the purge reports what it deleted'
);
RESET ROLE;

SELECT is(ARRAY(SELECT id::text FROM notification_log WHERE id::text LIKE '8d6%' ORDER BY id),
  ARRAY['8d600000-0000-4000-8000-000000000102'], 'notification_log keeps 90 days');
SELECT is(ARRAY(SELECT email::text FROM invitations WHERE id::text LIKE '8d6%' ORDER BY id),
  ARRAY['recent-decline@retention.test', 'recent-lapse@retention.test', 'open@retention.test',
        'accepted-running@retention.test', 'accepted-recent@retention.test'],
  'dead invitations go after 30 days; open ones and those of running seasons stay');
SELECT is(ARRAY(SELECT id::text FROM notifications WHERE id::text LIKE '8d6%' ORDER BY id),
  ARRAY['8d600000-0000-4000-8000-000000000302', '8d600000-0000-4000-8000-000000000304'],
  'read notifications go after 90 days, unread after 180');
SELECT is(ARRAY(SELECT event_key FROM draft_notification_outbox WHERE id::text LIKE '8d6%' ORDER BY id),
  ARRAY['e2', 'e3', 'e4', 'e6'],
  'delivered outbox rows go after 7 days, failed after 30; pending rows and drafting leagues are kept');
SELECT is(ARRAY(SELECT notification_type FROM discord_notification_log WHERE id::text LIKE '8d6%' ORDER BY id),
  ARRAY['season_end_reminder:running', 'season_end_reminder:recent'],
  'Discord dedupe rows go only 90 days after their season completed');

SET LOCAL ROLE service_role;
SELECT is((purge_expired_data() ->> 'invitations')::int, 0, 'a second run deletes nothing more');
SELECT throws_ok($$SELECT purge_expired_data(0)$$, 'P0001', NULL, 'a zero batch size is rejected');
RESET ROLE;

-- Batches cap each table and flag the leftover.
INSERT INTO notification_log (notification_type, recipient_email, status, created_at)
SELECT 'trade_proposed', 'bulk@retention.test', 'sent', now() - interval '100 days' FROM generate_series(1, 3);
SET LOCAL ROLE service_role;
SELECT is(purge_expired_data(2) -> 'more_remaining', 'true'::jsonb, 'a full batch reports more remaining');
SELECT is((purge_expired_data(2) ->> 'notification_log')::int, 1, 'the next run finishes the backlog');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- email_preferences
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_table_privilege('anon', 'email_preferences', p), 'anon has no ' || p || ' on email_preferences')
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p;
SELECT ok(NOT has_column_privilege('authenticated', 'email_preferences', 'unsubscribe_token', p),
          'authenticated cannot ' || p || ' the unsubscribe token')
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) AS p;
SELECT ok(NOT has_function_privilege(r, 'ensure_email_preferences(uuid[])', 'EXECUTE'), r || ' cannot read tokens')
FROM unnest(ARRAY['anon', 'authenticated']) AS r;

-- The sender creates a default row with a token for everyone it emails.
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM ensure_email_preferences(ARRAY[
    '8d600000-0000-4000-8000-000000000001', '8d600000-0000-4000-8000-000000000002',
    '8d600000-0000-4000-8000-0000000000ff']::uuid[]) WHERE season_recap_emails AND unsubscribe_token IS NOT NULL),
  2,
  'every existing recipient gets an opted-in row with a token; unknown ids are ignored'
);
SELECT is(
  (SELECT count(*)::int FROM ensure_email_preferences(ARRAY['8d600000-0000-4000-8000-000000000002']::uuid[])),
  1,
  'an existing row is returned once, not duplicated'
);
RESET ROLE;

-- A user sets their own preference, upsert style, and nobody else's.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"8d600000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO email_preferences (user_id, season_recap_emails) VALUES ('8d600000-0000-4000-8000-000000000002', false)
    ON CONFLICT (user_id) DO UPDATE SET season_recap_emails = EXCLUDED.season_recap_emails$$,
  'a user can turn off their own season recap emails'
);
SELECT is((SELECT season_recap_emails FROM email_preferences WHERE user_id = '8d600000-0000-4000-8000-000000000002'),
  false, 'the preference is saved');
SELECT is((SELECT count(*)::int FROM email_preferences), 1, 'a user sees only their own row');
UPDATE email_preferences SET season_recap_emails = false WHERE user_id = '8d600000-0000-4000-8000-000000000001';
SELECT throws_ok(
  $$INSERT INTO email_preferences (user_id, season_recap_emails) VALUES ('8d600000-0000-4000-8000-000000000001', false)$$,
  '42501', NULL, 'a user cannot create a row for someone else'
);
SELECT throws_ok($$SELECT unsubscribe_token FROM email_preferences$$, '42501', NULL, 'the token is not readable');
RESET ROLE;
SELECT is((SELECT season_recap_emails FROM email_preferences WHERE user_id = '8d600000-0000-4000-8000-000000000001'),
  true, 'another user''s preference is untouched');

-- Deleting the account removes the row.
DELETE FROM auth.users WHERE id = '8d600000-0000-4000-8000-000000000002';
SELECT is((SELECT count(*)::int FROM email_preferences WHERE user_id = '8d600000-0000-4000-8000-000000000002'), 0,
  'preferences go with the account');

SELECT * FROM finish();
ROLLBACK;
