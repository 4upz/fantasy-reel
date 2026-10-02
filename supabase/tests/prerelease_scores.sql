BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- A movie can carry a score before it releases. Team totals count it only from
-- its release date (UTC), for the holder and against the counterpicker alike.

SELECT is(movie_has_released(NULL), false, 'an undated movie has not released');
SELECT is(movie_has_released((now() AT TIME ZONE 'UTC')::DATE), true, 'release day counts');
SELECT is(movie_has_released((now() AT TIME ZONE 'UTC')::DATE + 1), false, 'tomorrow does not');

INSERT INTO auth.users(id, email) VALUES
  ('83111111-1111-4111-8111-000000000001', 'prerelease-a@example.test'),
  ('83111111-1111-4111-8111-000000000002', 'prerelease-b@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('83111111-1111-4111-8111-000000000003', 'Pre-release live', '83111111-1111-4111-8111-000000000001', 'active', current_date + 60),
  ('83111111-1111-4111-8111-000000000004', 'Pre-release finished', '83111111-1111-4111-8111-000000000001', 'active', current_date + 60);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('83111111-1111-4111-8111-000000000005', '83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000001', 'owner'),
  ('83111111-1111-4111-8111-000000000006', '83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000002', 'member'),
  ('83111111-1111-4111-8111-000000000007', '83111111-1111-4111-8111-000000000004', '83111111-1111-4111-8111-000000000001', 'owner');
INSERT INTO teams(id, participant_id, name) VALUES
  ('83111111-1111-4111-8111-000000000008', '83111111-1111-4111-8111-000000000005', 'Holder'),
  ('83111111-1111-4111-8111-000000000009', '83111111-1111-4111-8111-000000000006', 'Counterpicker'),
  ('83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000007', 'Finished');
INSERT INTO movies(id, tmdb_id, title, release_date, fantasy_points, combined_score) VALUES
  ('83111111-1111-4111-8111-000000000011', 987630001, 'Out last week', current_date - 7, 20, 80),
  ('83111111-1111-4111-8111-000000000012', 987630002, 'Out today', (now() AT TIME ZONE 'UTC')::DATE, 10, 70),
  ('83111111-1111-4111-8111-000000000013', 987630003, 'Out tomorrow', (now() AT TIME ZONE 'UTC')::DATE + 1, 30, 90),
  ('83111111-1111-4111-8111-000000000014', 987630004, 'Counterpicked early score', current_date + 10, 15, 75),
  ('83111111-1111-4111-8111-000000000015', 987630005, 'Counterpicked flop', current_date - 3, -5, 55),
  ('83111111-1111-4111-8111-000000000016', 987630006, 'Unrostered', current_date + 10, NULL, NULL),
  ('83111111-1111-4111-8111-000000000017', 987630007, 'Finished season only', current_date + 10, NULL, NULL);
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('83111111-1111-4111-8111-000000000018', '83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000008', '83111111-1111-4111-8111-000000000011', 1, 1),
  ('83111111-1111-4111-8111-000000000019', '83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000008', '83111111-1111-4111-8111-000000000013', 2, 1),
  ('83111111-1111-4111-8111-000000000020', '83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000008', '83111111-1111-4111-8111-000000000014', 3, 1),
  ('83111111-1111-4111-8111-000000000021', '83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000008', '83111111-1111-4111-8111-000000000015', 4, 1),
  ('83111111-1111-4111-8111-000000000022', '83111111-1111-4111-8111-000000000004', '83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000017', 1, 1);
INSERT INTO pickup_bids(id, league_id, team_id, tmdb_id, amount, processing_deadline) VALUES
  ('83111111-1111-4111-8111-000000000023', '83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000008', 987630002, 3, now());
INSERT INTO pickups(league_id, team_id, movie_id, bid_id, amount_paid) VALUES
  ('83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000008', '83111111-1111-4111-8111-000000000012', '83111111-1111-4111-8111-000000000023', 3);
INSERT INTO counterpicks(league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pick_order, phase) VALUES
  ('83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000009', '83111111-1111-4111-8111-000000000008', '83111111-1111-4111-8111-000000000014', '83111111-1111-4111-8111-000000000020', 1, 'draft'),
  ('83111111-1111-4111-8111-000000000003', '83111111-1111-4111-8111-000000000009', '83111111-1111-4111-8111-000000000008', '83111111-1111-4111-8111-000000000015', '83111111-1111-4111-8111-000000000021', 2, 'draft');
UPDATE leagues SET status = 'completed' WHERE id = '83111111-1111-4111-8111-000000000004';

SELECT recalculate_team_score_with_counterpicks('83111111-1111-4111-8111-000000000008');
SELECT recalculate_team_score_with_counterpicks('83111111-1111-4111-8111-000000000009');

SELECT results_eq(
  $$SELECT total_points, draft_points, pickup_points, movies_scored, movies_pending, average_score
    FROM team_scores WHERE team_id = '83111111-1111-4111-8111-000000000008'$$,
  $$VALUES (25::DECIMAL, 15::DECIMAL, 10::DECIMAL, 3, 2, 8.33::DECIMAL)$$,
  'the holder counts released movies (including one out today) and leaves early scores pending'
);
SELECT results_eq(
  $$SELECT total_points, counterpick_points, counterpicks_made, counterpicks_scored
    FROM team_scores WHERE team_id = '83111111-1111-4111-8111-000000000009'$$,
  $$VALUES (5::DECIMAL, 5::DECIMAL, 2, 1)$$,
  'a counterpick inverts only a released movie''s points'
);
SELECT results_eq(
  $$SELECT total_points, movies_scored, movies_pending FROM calculate_team_score('83111111-1111-4111-8111-000000000008')$$,
  $$VALUES (25::DECIMAL, 3, 2)$$,
  'the read-only calculation agrees with the stored total'
);

-- Release day arrives for the early scores.
UPDATE movies SET release_date = (now() AT TIME ZONE 'UTC')::DATE
WHERE id IN ('83111111-1111-4111-8111-000000000013', '83111111-1111-4111-8111-000000000014');
SELECT recalculate_teams_for_movie('83111111-1111-4111-8111-000000000013');
SELECT recalculate_teams_for_movie('83111111-1111-4111-8111-000000000014');

SELECT is(
  (SELECT total_points FROM team_scores WHERE team_id = '83111111-1111-4111-8111-000000000008'),
  70::DECIMAL,
  'released early scores join the holder''s total'
);
SELECT is(
  (SELECT total_points FROM team_scores WHERE team_id = '83111111-1111-4111-8111-000000000009'),
  -10::DECIMAL,
  'and count against the counterpicker'
);

SELECT results_eq(
  $$SELECT title, in_live_season FROM score_update_candidates WHERE tmdb_id BETWEEN 987630001 AND 987630007 ORDER BY tmdb_id$$,
  $$VALUES ('Out last week'::VARCHAR, true), ('Out today', true), ('Out tomorrow', true),
           ('Counterpicked early score', true), ('Counterpicked flop', true), ('Unrostered', false)$$,
  'in_live_season marks movies on a live roster; finished-season-only movies stay out of the view'
);

SELECT is(
  (SELECT announced_before_release FROM movies WHERE id = '83111111-1111-4111-8111-000000000011'),
  false,
  'no release post is owed until a score is posted before release'
);

SELECT * FROM finish();
ROLLBACK;
