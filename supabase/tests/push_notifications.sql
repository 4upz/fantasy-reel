BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

CREATE FUNCTION pg_temp.push_id(n INTEGER) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('8e700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID;
$$;
CREATE FUNCTION pg_temp.token(n INTEGER) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT repeat(lpad(to_hex(n), 2, '0'), 32);
$$;

-- Users 1 and 2 play in a two-team draft; user 3 plays nowhere.
INSERT INTO auth.users(id, email) SELECT pg_temp.push_id(n), 'push-' || n || '@example.test' FROM generate_series(1, 3) n;

-- ---------------------------------------------------------------------------
-- Grants: clients only register and unregister, never read tokens or the queue
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'register_push_device(text,text,text)', 'EXECUTE'), 'anon cannot register a device');
SELECT ok(has_function_privilege('authenticated', 'register_push_device(text,text,text)', 'EXECUTE'), 'a signed-in user can register a device');
SELECT ok(has_function_privilege('authenticated', 'unregister_push_device(text)', 'EXECUTE'), 'a signed-in user can unregister a device');
SELECT ok(NOT has_function_privilege(r, fn, 'EXECUTE'), r || ' cannot execute ' || fn)
FROM unnest(ARRAY['anon', 'authenticated']) r,
     unnest(ARRAY['claim_push_notifications(integer)', 'finish_push_notifications(jsonb)']) fn;
SELECT ok(has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role can execute ' || fn)
FROM unnest(ARRAY['claim_push_notifications(integer)', 'finish_push_notifications(jsonb)']) fn;
SELECT ok(NOT has_table_privilege(r, t, 'SELECT'), r || ' cannot read ' || t)
FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['push_devices', 'push_outbox']) t;

-- ---------------------------------------------------------------------------
-- Registration: one account per token
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT register_push_device(pg_temp.token(1), 'sandbox', 'com.fantasyreel.ios')$$,
  '42501', NULL, 'anon is refused');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', pg_temp.push_id(1)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT register_push_device(upper(pg_temp.token(1)), 'sandbox', 'com.fantasyreel.ios')$$,
  'user 1 registers a phone');
SELECT lives_ok($$SELECT register_push_device(pg_temp.token(1), 'sandbox', 'com.fantasyreel.ios')$$,
  'registering again is harmless');
SELECT throws_ok($$SELECT register_push_device('not-a-token', 'sandbox', 'com.fantasyreel.ios')$$,
  '23514', NULL, 'a malformed token is refused');
SELECT throws_ok($$SELECT register_push_device(pg_temp.token(9), 'staging', 'com.fantasyreel.ios')$$,
  '23514', NULL, 'an unknown APNs environment is refused');
SELECT throws_ok($$SELECT register_push_device(pg_temp.token(9), 'sandbox', 'com.example.other')$$,
  '23514', NULL, 'another app''s bundle ID is refused (it would become the APNs topic)');
RESET ROLE;
SELECT is((SELECT user_id FROM push_devices WHERE token = pg_temp.token(1)), pg_temp.push_id(1),
  'the token is stored lowercase for user 1');

SELECT set_config('request.jwt.claim.sub', pg_temp.push_id(2)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT register_push_device(pg_temp.token(2), 'production', 'com.fantasyreel.ios')$$,
  'user 2 registers a phone');
SELECT lives_ok($$SELECT unregister_push_device(pg_temp.token(1))$$, 'unregistering someone else''s token runs');
RESET ROLE;
SELECT is((SELECT count(*)::INT FROM push_devices WHERE token = pg_temp.token(1)), 1,
  'but leaves their token alone');

-- ---------------------------------------------------------------------------
-- Preferences: own row only; no row means everything is on
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', pg_temp.push_id(2)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO push_preferences(user_id, bids) VALUES (pg_temp.push_id(2), FALSE)$$,
  'user 2 turns bid pushes off');
SELECT throws_ok($$INSERT INTO push_preferences(user_id) VALUES (pg_temp.push_id(1))$$,
  '42501', NULL, 'nobody writes another user''s preferences');
RESET ROLE;
SELECT is((SELECT count(*)::INT FROM push_preferences WHERE user_id = pg_temp.push_id(1)), 0,
  'user 1 still has no preferences row');

-- ---------------------------------------------------------------------------
-- Queueing on every notification insert
-- ---------------------------------------------------------------------------
INSERT INTO notifications(id, user_id, type, title, body) VALUES
  (pg_temp.push_id(101), pg_temp.push_id(1), 'outbid', 'Outbid', 'b'),
  (pg_temp.push_id(102), pg_temp.push_id(2), 'outbid', 'Outbid', 'b'),
  (pg_temp.push_id(103), pg_temp.push_id(2), 'trade_proposed', 'Trade', 'b'),
  (pg_temp.push_id(104), pg_temp.push_id(3), 'outbid', 'Outbid', 'b');
SELECT is(ARRAY(SELECT notification_id FROM push_outbox ORDER BY notification_id),
  ARRAY[pg_temp.push_id(101), pg_temp.push_id(103)],
  'pushes queue per device, skipping switched-off categories and users with no phone');

-- ---------------------------------------------------------------------------
-- Claiming and finishing
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
CREATE TEMP TABLE claimed AS SELECT * FROM claim_push_notifications(10);
RESET ROLE;
SELECT is((SELECT count(*)::INT FROM claimed), 2, 'both pushes are leased');
SELECT is((SELECT badge FROM claimed WHERE notification_id = pg_temp.push_id(103)), 2,
  'the badge is the user''s unread count');
SELECT is((SELECT token FROM claimed WHERE notification_id = pg_temp.push_id(101)), pg_temp.token(1),
  'the claim carries the token');
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::INT FROM claim_push_notifications(10)), 0, 'leased rows are not claimed twice');
SELECT is(finish_push_notifications(jsonb_build_array(
  jsonb_build_object('id', (SELECT id FROM claimed WHERE notification_id = pg_temp.push_id(101)),
    'lease_token', (SELECT lease_token FROM claimed WHERE notification_id = pg_temp.push_id(101)), 'outcome', 'retry', 'error', '503'),
  jsonb_build_object('id', (SELECT id FROM claimed WHERE notification_id = pg_temp.push_id(103)),
    'lease_token', gen_random_uuid(), 'outcome', 'sent')
)), 1, 'a result with a lapsed lease is ignored');
RESET ROLE;
SELECT is((SELECT status FROM push_outbox WHERE notification_id = pg_temp.push_id(101)), 'pending', 'a retry goes back in the queue');
SELECT ok((SELECT available_at > now() FROM push_outbox WHERE notification_id = pg_temp.push_id(101)), 'after a backoff');

SET LOCAL ROLE service_role;
SELECT is(finish_push_notifications(jsonb_build_array(jsonb_build_object(
  'id', (SELECT id FROM claimed WHERE notification_id = pg_temp.push_id(103)),
  'lease_token', (SELECT lease_token FROM claimed WHERE notification_id = pg_temp.push_id(103)), 'outcome', 'unregistered'))),
  1, 'APNs reports user 2''s token dead');
SELECT throws_ok($$SELECT finish_push_notifications('[{"id": "8e700000-0000-4000-8000-000000000001", "lease_token": "8e700000-0000-4000-8000-000000000001", "outcome": "maybe"}]')$$,
  'P0001', NULL, 'an unknown outcome is refused');
RESET ROLE;
SELECT is((SELECT count(*)::INT FROM push_devices WHERE user_id = pg_temp.push_id(2)), 0, 'and the dead token is deleted');

-- A run out of time hands back what it never tried, attempt and all.
UPDATE push_outbox SET available_at = now() WHERE notification_id = pg_temp.push_id(101);
SET LOCAL ROLE service_role;
CREATE TEMP TABLE reclaimed AS SELECT * FROM claim_push_notifications(10);
SELECT is(finish_push_notifications(jsonb_build_array(jsonb_build_object(
  'id', (SELECT id FROM reclaimed), 'lease_token', (SELECT lease_token FROM reclaimed), 'outcome', 'unsent'))),
  1, 'an unsent push is handed back');
RESET ROLE;
SELECT is((SELECT attempts FROM push_outbox WHERE notification_id = pg_temp.push_id(101)), 1,
  'without using up an attempt');
SELECT ok((SELECT status = 'pending' AND available_at <= now() AND lease_token IS NULL AND last_error = '503'
  FROM push_outbox WHERE notification_id = pg_temp.push_id(101)), 'and is ready for the next run');

-- A token that moved to another account, and a push that sat too long, are never sent.
UPDATE push_outbox SET available_at = now() WHERE notification_id = pg_temp.push_id(101);
SELECT set_config('request.jwt.claim.sub', pg_temp.push_id(3)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT register_push_device(pg_temp.token(1), 'sandbox', 'com.fantasyreel.ios');
RESET ROLE;
INSERT INTO notifications(id, user_id, type, title, body, created_at) VALUES
  (pg_temp.push_id(105), pg_temp.push_id(3), 'bid_won', 'Won', 'b', now());
UPDATE push_outbox SET created_at = now() - interval '4 hours' WHERE notification_id = pg_temp.push_id(105);
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::INT FROM claim_push_notifications(10)), 0, 'nothing is sent');
RESET ROLE;
SELECT is((SELECT status FROM push_outbox WHERE notification_id = pg_temp.push_id(101)), 'skipped',
  'user 1''s push is skipped once the phone belongs to user 3');
SELECT is((SELECT status FROM push_outbox WHERE notification_id = pg_temp.push_id(105)), 'expired',
  'a push older than three hours expires');

-- ---------------------------------------------------------------------------
-- "It's your pick"
-- ---------------------------------------------------------------------------
INSERT INTO leagues(id, name, owner_id, season_year, season_end, draft_slots, draft_counterpick_slots, faab_budget, custom_draft_order) VALUES
  (pg_temp.push_id(10), 'Push draft', pg_temp.push_id(1), extract(YEAR FROM current_date)::INTEGER, current_date + 90, 2, 0, 100, TRUE);
INSERT INTO league_participants(id, league_id, user_id, role, draft_order) VALUES
  (pg_temp.push_id(11), pg_temp.push_id(10), pg_temp.push_id(1), 'owner', 1),
  (pg_temp.push_id(12), pg_temp.push_id(10), pg_temp.push_id(2), 'member', 2);
INSERT INTO teams(id, participant_id, name) VALUES
  (pg_temp.push_id(21), pg_temp.push_id(11), 'Team One'),
  (pg_temp.push_id(22), pg_temp.push_id(12), 'Team Two');
INSERT INTO movies(id, tmdb_id, title, release_date)
SELECT pg_temp.push_id(n), 1987700000 + n, 'Push movie ' || n, current_date + 30 FROM generate_series(31, 32) n;

SELECT set_config('request.jwt.claim.sub', pg_temp.push_id(1)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT start_draft(pg_temp.push_id(10))$$, 'the owner starts the draft');
RESET ROLE;
SELECT is(ARRAY(SELECT user_id FROM notifications WHERE league_id = pg_temp.push_id(10) AND type = 'draft_turn'),
  ARRAY[pg_temp.push_id(1)], 'the first picker is told it''s their pick');

SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT commit_draft_pick(pg_temp.push_id(10), pg_temp.push_id(1), pg_temp.push_id(31), 1, pg_temp.push_id(41))$$,
  'the first pick commits');
RESET ROLE;
SELECT is(ARRAY(SELECT user_id FROM notifications WHERE league_id = pg_temp.push_id(10) AND type = 'draft_turn' ORDER BY user_id),
  ARRAY[pg_temp.push_id(1), pg_temp.push_id(2)], 'then the next picker is told');
SELECT is((SELECT data->>'round' FROM notifications WHERE league_id = pg_temp.push_id(10) AND user_id = pg_temp.push_id(2) AND type = 'draft_turn'),
  '1', 'with the round');

-- ---------------------------------------------------------------------------
-- Retention and account deletion
-- ---------------------------------------------------------------------------
UPDATE push_outbox SET created_at = now() - interval '8 days' WHERE notification_id = pg_temp.push_id(101);
-- A stale pending push is expired, never deleted; one another run is sending is left alone.
SELECT set_config('request.jwt.claim.sub', pg_temp.push_id(3)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT register_push_device(pg_temp.token(4), 'sandbox', 'com.fantasyreel.ios');
RESET ROLE;
INSERT INTO notifications(id, user_id, type, title, body) VALUES
  (pg_temp.push_id(150), pg_temp.push_id(3), 'outbid', 'Stale', 'b'),
  (pg_temp.push_id(151), pg_temp.push_id(3), 'outbid', 'In flight', 'b');
UPDATE push_outbox SET created_at = now() - interval '5 hours' WHERE notification_id IN (pg_temp.push_id(150), pg_temp.push_id(151));
DELETE FROM push_outbox o USING push_devices d
  WHERE d.id = o.device_id AND d.token = pg_temp.token(1) AND o.notification_id IN (pg_temp.push_id(150), pg_temp.push_id(151));
UPDATE push_outbox SET leased_until = now() + interval '1 minute', lease_token = gen_random_uuid()
  WHERE notification_id = pg_temp.push_id(151);
UPDATE push_devices SET last_registered_at = now() - interval '200 days' WHERE token = pg_temp.token(1);
SET LOCAL ROLE service_role;
SELECT is((purge_expired_data() ->> 'push_outbox')::INT, 1, 'settled pushes go after 7 days');
RESET ROLE;
SELECT is((SELECT status FROM push_outbox WHERE notification_id = pg_temp.push_id(150)), 'expired',
  'a push past its three hours is expired, not deleted');
SELECT is((SELECT status FROM push_outbox WHERE notification_id = pg_temp.push_id(151)), 'pending',
  'a push another run is sending is left to that run');
SELECT is((SELECT count(*)::INT FROM push_devices WHERE token = pg_temp.token(1)), 0,
  'phones that haven''t opened the app in 180 days are forgotten');

SELECT set_config('request.jwt.claim.sub', pg_temp.push_id(3)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT register_push_device(pg_temp.token(3), 'sandbox', 'com.fantasyreel.ios');
INSERT INTO push_preferences(user_id) VALUES (pg_temp.push_id(3));
RESET ROLE;
DELETE FROM auth.users WHERE id = pg_temp.push_id(3);
SELECT is((SELECT count(*)::INT FROM push_devices WHERE user_id = pg_temp.push_id(3)), 0, 'deleting an account removes its phones');
SELECT is((SELECT count(*)::INT FROM push_preferences WHERE user_id = pg_temp.push_id(3)), 0, 'and its push preferences');

SELECT * FROM finish();
ROLLBACK;
