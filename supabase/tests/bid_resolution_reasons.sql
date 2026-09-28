BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id, email) VALUES
  ('82111111-1111-4111-8111-000000000001', 'bid-reasons-a@example.test'),
  ('82111111-1111-4111-8111-000000000002', 'bid-reasons-b@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('82111111-1111-4111-8111-000000000003', 'Bid reasons', '82111111-1111-4111-8111-000000000001', 'active', current_date - 1);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('82111111-1111-4111-8111-000000000004', '82111111-1111-4111-8111-000000000003', '82111111-1111-4111-8111-000000000001', 'owner'),
  ('82111111-1111-4111-8111-000000000005', '82111111-1111-4111-8111-000000000003', '82111111-1111-4111-8111-000000000002', 'member');
INSERT INTO teams(id, participant_id, name) VALUES
  ('82111111-1111-4111-8111-000000000006', '82111111-1111-4111-8111-000000000004', 'Reason Alpha'),
  ('82111111-1111-4111-8111-000000000007', '82111111-1111-4111-8111-000000000005', 'Reason Beta');
INSERT INTO movies(id, tmdb_id, title, release_date) VALUES
  ('82111111-1111-4111-8111-000000000008', 987620001, 'Bid reason target', current_date + 5);
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('82111111-1111-4111-8111-000000000009', '82111111-1111-4111-8111-000000000003', '82111111-1111-4111-8111-000000000007', '82111111-1111-4111-8111-000000000008', 1, 1);

-- Both current pending states and historical terminal rows have nullable reasons.
INSERT INTO pickup_bids(id, league_id, team_id, tmdb_id, amount, status, resolution_reason, processing_deadline)
SELECT ('82111111-1111-4111-8111-' || lpad(n::TEXT, 12, '0'))::UUID,
  '82111111-1111-4111-8111-000000000003', '82111111-1111-4111-8111-000000000006',
  987620000 + n, 1, status::bid_status, reason, now()
FROM (VALUES (10, 'active', NULL), (11, 'outbid', NULL), (12, 'lost', NULL),
  (13, 'cancelled', 'user_cancelled')) AS bids(n, status, reason);
INSERT INTO counterpick_bids(id, league_id, team_id, movie_id, target_team_id, draft_pick_id, amount, status, processing_deadline)
SELECT ('82111111-1111-4111-8111-' || lpad(n::TEXT, 12, '0'))::UUID,
  '82111111-1111-4111-8111-000000000003', '82111111-1111-4111-8111-000000000006',
  '82111111-1111-4111-8111-000000000008', '82111111-1111-4111-8111-000000000007',
  '82111111-1111-4111-8111-000000000009', 1, status::bid_status, now()
FROM (VALUES (20, 'active'), (21, 'outbid'), (22, 'lost')) AS bids(n, status);

SELECT throws_ok($$UPDATE pickup_bids SET resolution_reason = 'not_a_reason' WHERE id = '82111111-1111-4111-8111-000000000012'$$,
  '23514', NULL, 'pickup reasons reject unknown values');
SELECT throws_ok($$UPDATE counterpick_bids SET resolution_reason = 'not_a_reason' WHERE id = '82111111-1111-4111-8111-000000000022'$$,
  '23514', NULL, 'counterpick reasons reject unknown values');
SELECT throws_ok($$UPDATE pickup_bids SET resolution_reason = 'outbid' WHERE id = '82111111-1111-4111-8111-000000000010'$$,
  '23514', NULL, 'pending pickup bids cannot carry terminal reasons');
SELECT throws_ok($$UPDATE counterpick_bids SET status = 'won', resolution_reason = 'no_slots' WHERE id = '82111111-1111-4111-8111-000000000020'$$,
  '23514', NULL, 'won counterpick bids cannot carry loss reasons');
SELECT lives_ok($$UPDATE pickup_bids SET status = 'active', resolution_reason = NULL WHERE id = '82111111-1111-4111-8111-000000000013'$$,
  'a reused pickup bid clears its previous reason');
UPDATE pickup_bids SET status = 'cancelled', resolution_reason = 'user_cancelled'
WHERE id = '82111111-1111-4111-8111-000000000013';

SELECT is(complete_league_season('82111111-1111-4111-8111-000000000003', 'owner')->>'ok', 'true',
  'season completion succeeds with reason constraints');
SELECT is((SELECT count(*) FROM pickup_bids WHERE league_id = '82111111-1111-4111-8111-000000000003' AND status = 'cancelled' AND resolution_reason = 'season_completed'),
  2::BIGINT, 'season completion records both pending pickup outcomes');
SELECT is((SELECT count(*) FROM counterpick_bids WHERE league_id = '82111111-1111-4111-8111-000000000003' AND status = 'cancelled' AND resolution_reason = 'season_completed'),
  2::BIGINT, 'season completion records both pending counterpick outcomes');
SELECT is((SELECT resolution_reason FROM pickup_bids WHERE id = '82111111-1111-4111-8111-000000000012'),
  NULL::TEXT, 'unknown pickup history is not fabricated by completion');
SELECT is((SELECT resolution_reason FROM counterpick_bids WHERE id = '82111111-1111-4111-8111-000000000022'),
  NULL::TEXT, 'unknown counterpick history is not fabricated by completion');
SELECT is((SELECT resolution_reason FROM pickup_bids WHERE id = '82111111-1111-4111-8111-000000000013'),
  'user_cancelled', 'season completion preserves an earlier explicit cancellation');
SELECT throws_ok($$UPDATE pickup_bids SET resolution_reason = 'no_slots' WHERE id = '82111111-1111-4111-8111-000000000010'$$,
  '55000', 'This season is finished.', 'completed terminal bid reasons remain immutable');

-- Model pending legacy bids from before atomic season completion without
-- bypassing the activity guard: create them while active, then freeze the season.
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('82111111-1111-4111-8111-000000000030', 'Legacy bid cleanup', '82111111-1111-4111-8111-000000000001', 'active', current_date - 1);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('82111111-1111-4111-8111-000000000040', '82111111-1111-4111-8111-000000000030', '82111111-1111-4111-8111-000000000001', 'owner'),
  ('82111111-1111-4111-8111-000000000041', '82111111-1111-4111-8111-000000000030', '82111111-1111-4111-8111-000000000002', 'member');
INSERT INTO teams(id, participant_id, name) VALUES
  ('82111111-1111-4111-8111-000000000042', '82111111-1111-4111-8111-000000000040', 'Legacy Alpha'),
  ('82111111-1111-4111-8111-000000000043', '82111111-1111-4111-8111-000000000041', 'Legacy Beta');
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('82111111-1111-4111-8111-000000000044', '82111111-1111-4111-8111-000000000030', '82111111-1111-4111-8111-000000000043', '82111111-1111-4111-8111-000000000008', 1, 1);
INSERT INTO pickup_bids(id, league_id, team_id, tmdb_id, amount, processing_deadline)
SELECT ('82111111-1111-4111-8111-' || lpad(n::TEXT, 12, '0'))::UUID,
  '82111111-1111-4111-8111-000000000030', '82111111-1111-4111-8111-000000000042',
  987620000 + n, 1, now()
FROM generate_series(31, 34) n;
INSERT INTO counterpick_bids(id, league_id, team_id, movie_id, target_team_id, draft_pick_id, amount, processing_deadline)
VALUES ('82111111-1111-4111-8111-000000000035', '82111111-1111-4111-8111-000000000030',
  '82111111-1111-4111-8111-000000000042', '82111111-1111-4111-8111-000000000008',
  '82111111-1111-4111-8111-000000000043', '82111111-1111-4111-8111-000000000044', 1, now());
UPDATE leagues SET status = 'completed' WHERE id = '82111111-1111-4111-8111-000000000030';
SELECT lives_ok($$UPDATE pickup_bids SET status = 'cancelled', resolution_reason = 'season_completed' WHERE id = '82111111-1111-4111-8111-000000000031'$$,
  'completed-season cleanup can persist its pickup reason');
SELECT lives_ok($$UPDATE counterpick_bids SET status = 'cancelled', resolution_reason = 'season_completed' WHERE id = '82111111-1111-4111-8111-000000000035'$$,
  'completed-season cleanup can persist its counterpick reason');
SELECT lives_ok($$UPDATE pickup_bids SET status = 'cancelled' WHERE id = '82111111-1111-4111-8111-000000000032'$$,
  'status-only legacy cleanup remains compatible');
SELECT throws_ok($$UPDATE pickup_bids SET status = 'cancelled', resolution_reason = 'no_slots' WHERE id = '82111111-1111-4111-8111-000000000033'$$,
  '55000', 'This season is finished.', 'completed-season cleanup rejects unrelated reasons');
SELECT throws_ok($$UPDATE pickup_bids SET status = 'cancelled', resolution_reason = 'season_completed', amount = 2 WHERE id = '82111111-1111-4111-8111-000000000034'$$,
  '55000', 'This season is finished.', 'completed-season cleanup cannot change the bid amount');

SELECT * FROM finish();
ROLLBACK;
