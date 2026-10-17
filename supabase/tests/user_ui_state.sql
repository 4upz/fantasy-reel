BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- UI state is private to its owner, and tour outcomes merge monotonically so
-- a second tab or a stale bundle can never undo a newer answer.

INSERT INTO auth.users(id, email) VALUES
  ('91111111-1111-4111-8111-000000000001', 'ui-alice@example.test'),
  ('91111111-1111-4111-8111-000000000002', 'ui-bob@example.test');
INSERT INTO user_ui_state(user_id, key, value) VALUES
  ('91111111-1111-4111-8111-000000000002', 'tour:bidding', '{"v": 1, "status": "completed"}');

SELECT set_config('request.jwt.claims', '{"sub":"91111111-1111-4111-8111-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- Ownership
SELECT is((SELECT count(*)::int FROM user_ui_state), 0, 'a member sees none of another member''s state');
SELECT throws_ok(
  $$INSERT INTO user_ui_state(user_id, key, value) VALUES ('91111111-1111-4111-8111-000000000002', 'prefs:tours', '{"enabled": false}')$$,
  '42501', NULL, 'a member cannot write state for someone else');
SELECT lives_ok(
  $$INSERT INTO user_ui_state(user_id, key, value) VALUES ('91111111-1111-4111-8111-000000000001', 'prefs:tours', '{"enabled": false}')$$,
  'a member turns tours off');
SELECT throws_ok(
  $$INSERT INTO user_ui_state(user_id, key, value) VALUES ('91111111-1111-4111-8111-000000000001', 'secrets:x', '{}')$$,
  '23514', NULL, 'keys must use a known namespace');
SELECT throws_ok(
  $$INSERT INTO user_ui_state(user_id, key, value) VALUES ('91111111-1111-4111-8111-000000000001', 'hint:big', jsonb_build_object('x', repeat('a', 2000)))$$,
  '23514', NULL, 'values are capped in size');

-- Outcomes
SELECT is(record_tour_outcome('bidding', 1, 'snoozed')->>'status', 'snoozed', 'Not now snoozes the tour');
SELECT ok((record_tour_outcome('bidding', 1, 'snoozed')->>'status') = 'dismissed', 'a second Not now counts as dismissed');
SELECT is(record_tour_outcome('bidding', 1, 'snoozed')->>'status', 'dismissed', 'a later snooze does not reopen a dismissed tour');
SELECT is(record_tour_outcome('bidding', 1, 'completed')->>'status', 'completed', 'finishing beats dismissing');
SELECT is(record_tour_outcome('bidding', 1, 'dismissed')->>'status', 'completed', 'dismissing does not undo finishing');
SELECT is(record_tour_outcome('bidding', 2, 'snoozed')->>'status', 'snoozed', 'a new version is asked about again');
SELECT is(record_tour_outcome('bidding', 1, 'completed')->>'v', '2', 'a stale tab reporting an old version changes nothing');
SELECT throws_ok($$SELECT record_tour_outcome('Bad Id!', 1, 'completed')$$, '23514', NULL, 'tour ids are checked for shape');
SELECT throws_ok($$SELECT record_tour_outcome('bidding', 1, 'started')$$, '22023', NULL, 'unknown outcomes are refused');

-- Reset
DELETE FROM user_ui_state WHERE key LIKE 'tour:%';
SELECT is((SELECT count(*)::int FROM user_ui_state WHERE key LIKE 'tour:%'), 0, 'a member resets their tours');
RESET ROLE;

SELECT is(
  (SELECT value->>'status' FROM user_ui_state WHERE user_id = '91111111-1111-4111-8111-000000000002' AND key = 'tour:bidding'),
  'completed', 'another member''s state survived the reset');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM user_ui_state$$, '42501', NULL, 'signed-out visitors cannot read UI state');
SELECT throws_ok($$SELECT record_tour_outcome('bidding', 1, 'completed')$$, '42501', NULL, 'signed-out visitors cannot record tours');
RESET ROLE;

-- Row cap
INSERT INTO user_ui_state(user_id, key, value)
SELECT '91111111-1111-4111-8111-000000000001', 'hint:h' || g, '{}' FROM generate_series(1, 199) g;
SELECT throws_ok(
  $$INSERT INTO user_ui_state(user_id, key, value) VALUES ('91111111-1111-4111-8111-000000000001', 'hint:one-too-many', '{}')$$,
  '54000', NULL, 'a user cannot store more than 200 keys');

-- State goes with the account
DELETE FROM auth.users WHERE id = '91111111-1111-4111-8111-000000000002';
SELECT is(
  (SELECT count(*)::int FROM user_ui_state WHERE user_id = '91111111-1111-4111-8111-000000000002'),
  0, 'deleting an account deletes its UI state');

SELECT * FROM finish();
ROLLBACK;
