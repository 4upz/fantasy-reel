BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Two active seasons holding the same 95% movie: one on the default rule,
-- one with double points over 90. Each has a holder and a counterpicker.
INSERT INTO auth.users(id, email) VALUES
  ('83111111-1111-4111-8111-000000000001', 'rule-owner@example.test'),
  ('83111111-1111-4111-8111-000000000002', 'rule-member@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('83111111-1111-4111-8111-000000000010', 'Default rule', '83111111-1111-4111-8111-000000000001', 'active', current_date - 1);
INSERT INTO leagues(id, name, owner_id, status, season_end, double_points_over_90) VALUES
  ('83111111-1111-4111-8111-000000000020', 'Double rule', '83111111-1111-4111-8111-000000000001', 'active', current_date - 1, true);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('83111111-1111-4111-8111-000000000011', '83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000001', 'owner'),
  ('83111111-1111-4111-8111-000000000012', '83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000002', 'member'),
  ('83111111-1111-4111-8111-000000000021', '83111111-1111-4111-8111-000000000020', '83111111-1111-4111-8111-000000000001', 'owner'),
  ('83111111-1111-4111-8111-000000000022', '83111111-1111-4111-8111-000000000020', '83111111-1111-4111-8111-000000000002', 'member');
INSERT INTO teams(id, participant_id, name) VALUES
  ('83111111-1111-4111-8111-000000000013', '83111111-1111-4111-8111-000000000011', 'Default Holder'),
  ('83111111-1111-4111-8111-000000000014', '83111111-1111-4111-8111-000000000012', 'Default Counter'),
  ('83111111-1111-4111-8111-000000000023', '83111111-1111-4111-8111-000000000021', 'Double Holder'),
  ('83111111-1111-4111-8111-000000000024', '83111111-1111-4111-8111-000000000022', 'Double Counter');
INSERT INTO movies(id, tmdb_id, title, release_date) VALUES
  ('83111111-1111-4111-8111-000000000030', 987630001, 'Rule hit', current_date - 30),
  ('83111111-1111-4111-8111-000000000031', 987630002, 'Rule flop', current_date - 30);
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('83111111-1111-4111-8111-000000000015', '83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000013', '83111111-1111-4111-8111-000000000030', 1, 1),
  ('83111111-1111-4111-8111-000000000016', '83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000014', '83111111-1111-4111-8111-000000000031', 1, 2),
  ('83111111-1111-4111-8111-000000000025', '83111111-1111-4111-8111-000000000020', '83111111-1111-4111-8111-000000000023', '83111111-1111-4111-8111-000000000030', 1, 1),
  ('83111111-1111-4111-8111-000000000026', '83111111-1111-4111-8111-000000000020', '83111111-1111-4111-8111-000000000024', '83111111-1111-4111-8111-000000000031', 1, 2);
INSERT INTO counterpicks(league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pick_order, phase) VALUES
  ('83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000014', '83111111-1111-4111-8111-000000000013',
   '83111111-1111-4111-8111-000000000030', '83111111-1111-4111-8111-000000000015', 1, 'draft'),
  ('83111111-1111-4111-8111-000000000020', '83111111-1111-4111-8111-000000000024', '83111111-1111-4111-8111-000000000023',
   '83111111-1111-4111-8111-000000000030', '83111111-1111-4111-8111-000000000025', 1, 'draft');

SELECT is((SELECT double_points_over_90 FROM leagues WHERE id = '83111111-1111-4111-8111-000000000010'),
  false, 'new seasons default to 1 point per point over 90');

SELECT is(league_fantasy_points(35, 95, true), 40::NUMERIC, 'double points add the points above 90');
SELECT is(league_fantasy_points(35, 95, false), 35::NUMERIC, 'the default rule leaves points alone');
SELECT is(league_fantasy_points(-12.5, 45, true), -12.5, 'double points only apply above 90');
SELECT is(league_fantasy_points(NULL, 95, true), NULL::NUMERIC, 'pending movies stay pending');
SELECT is(league_fantasy_points(35, NULL, true), 35::NUMERIC, 'points without a Tomatometer get no bonus');

-- Score both movies through the real path: reviews -> calculate_movie_score.
INSERT INTO reviews(movie_id, source, score) VALUES
  ('83111111-1111-4111-8111-000000000030', 'rotten_tomatoes', 95),
  ('83111111-1111-4111-8111-000000000031', 'rotten_tomatoes', 45);
SELECT calculate_movie_score('83111111-1111-4111-8111-000000000030');
SELECT calculate_movie_score('83111111-1111-4111-8111-000000000031');

SELECT is((SELECT fantasy_points FROM movies WHERE id = '83111111-1111-4111-8111-000000000030'),
  35.00, 'movies store the default rule (RT - 60 at 90+)');
SELECT is((SELECT fantasy_points FROM team_holdings WHERE holding_id = '83111111-1111-4111-8111-000000000015'),
  35.00, 'team_holdings shows default-rule points in a default season');
SELECT is((SELECT fantasy_points FROM team_holdings WHERE holding_id = '83111111-1111-4111-8111-000000000025'),
  40.00, 'team_holdings shows double points in a double season');
SELECT is((SELECT fantasy_points FROM counterpicks WHERE league_id = '83111111-1111-4111-8111-000000000010'),
  -35.00, 'a counterpick inverts the default rule');
SELECT is((SELECT fantasy_points FROM counterpicks WHERE league_id = '83111111-1111-4111-8111-000000000020'),
  -40.00, 'a counterpick inverts the double rule');
SELECT results_eq(
  $$SELECT team_id, total_points FROM team_scores WHERE team_id::TEXT LIKE '83111111-%' ORDER BY team_id$$,
  $$VALUES ('83111111-1111-4111-8111-000000000013'::UUID, 35.00),
           ('83111111-1111-4111-8111-000000000014'::UUID, -47.50),
           ('83111111-1111-4111-8111-000000000023'::UUID, 40.00),
           ('83111111-1111-4111-8111-000000000024'::UUID, -52.50)$$,
  'team totals score every movie and counterpick under their own season''s rule');

-- Changing the rule re-scores the season, and only that season.
UPDATE leagues SET double_points_over_90 = true WHERE id = '83111111-1111-4111-8111-000000000010';
SELECT results_eq(
  $$SELECT total_points FROM team_scores WHERE team_id IN ('83111111-1111-4111-8111-000000000013', '83111111-1111-4111-8111-000000000014') ORDER BY team_id$$,
  $$VALUES (40.00), (-52.50)$$,
  'turning double points on re-scores the holder and the counterpicker');
SELECT is((SELECT fantasy_points FROM counterpicks WHERE league_id = '83111111-1111-4111-8111-000000000010'),
  -40.00, 'turning double points on refreshes the counterpick row');
UPDATE leagues SET double_points_over_90 = false WHERE id = '83111111-1111-4111-8111-000000000010';
SELECT results_eq(
  $$SELECT team_id, total_points FROM team_scores WHERE team_id::TEXT LIKE '83111111-%' ORDER BY team_id$$,
  $$VALUES ('83111111-1111-4111-8111-000000000013'::UUID, 35.00),
           ('83111111-1111-4111-8111-000000000014'::UUID, -47.50),
           ('83111111-1111-4111-8111-000000000023'::UUID, 40.00),
           ('83111111-1111-4111-8111-000000000024'::UUID, -52.50)$$,
  'turning it back off restores the default totals without touching the other season');

-- A new Tomatometer reaches each season under its own rule.
UPDATE reviews SET score = 97
WHERE movie_id = '83111111-1111-4111-8111-000000000030' AND source = 'rotten_tomatoes';
SELECT calculate_movie_score('83111111-1111-4111-8111-000000000030');
SELECT results_eq(
  $$SELECT league_id, fantasy_points FROM counterpicks WHERE movie_id = '83111111-1111-4111-8111-000000000030' ORDER BY league_id$$,
  $$VALUES ('83111111-1111-4111-8111-000000000010'::UUID, -37.00),
           ('83111111-1111-4111-8111-000000000020'::UUID, -44.00)$$,
  'a rescored movie refreshes each season''s counterpick under its own rule');
SELECT is((SELECT total_points FROM team_scores WHERE team_id = '83111111-1111-4111-8111-000000000023'),
  44.00, 'a rescored movie reaches the double season''s totals');

-- Completed seasons keep the rule they finished under.
SELECT is(complete_league_season('83111111-1111-4111-8111-000000000020', 'owner')->>'ok', 'true',
  'the double season completes');
SELECT throws_ok($$UPDATE leagues SET double_points_over_90 = false WHERE id = '83111111-1111-4111-8111-000000000020'$$,
  '42501', 'This season is finished.', 'a completed season cannot change its 90+ rule');
UPDATE reviews SET score = 99
WHERE movie_id = '83111111-1111-4111-8111-000000000030' AND source = 'rotten_tomatoes';
SELECT calculate_movie_score('83111111-1111-4111-8111-000000000030');
SELECT is((SELECT total_points FROM team_scores WHERE team_id = '83111111-1111-4111-8111-000000000023'),
  44.00, 'a completed season keeps its final totals when a shared movie rescores');
SELECT is((SELECT fantasy_points FROM counterpicks WHERE league_id = '83111111-1111-4111-8111-000000000020'),
  -44.00, 'a completed season keeps its counterpick value when a shared movie rescores');
SELECT is((SELECT total_points FROM team_scores WHERE team_id = '83111111-1111-4111-8111-000000000013'),
  39.00, 'the live season still picks up the new score');

-- A new counterpick derives its own points, whatever the writer passed.
UPDATE leagues SET double_points_over_90 = true WHERE id = '83111111-1111-4111-8111-000000000010';
INSERT INTO movies(id, tmdb_id, title, release_date) VALUES
  ('83111111-1111-4111-8111-000000000032', 987630003, 'Rule second hit', current_date - 30);
INSERT INTO reviews(movie_id, source, score) VALUES
  ('83111111-1111-4111-8111-000000000032', 'rotten_tomatoes', 92);
SELECT calculate_movie_score('83111111-1111-4111-8111-000000000032');
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('83111111-1111-4111-8111-000000000017', '83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000014', '83111111-1111-4111-8111-000000000032', 2, 1);
INSERT INTO counterpicks(league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pick_order, phase, fantasy_points) VALUES
  ('83111111-1111-4111-8111-000000000010', '83111111-1111-4111-8111-000000000013', '83111111-1111-4111-8111-000000000014',
   '83111111-1111-4111-8111-000000000032', '83111111-1111-4111-8111-000000000017', 2, 'draft', 999);
SELECT is((SELECT fantasy_points FROM counterpicks WHERE draft_pick_id = '83111111-1111-4111-8111-000000000017'),
  -34.00, 'a new counterpick takes its points from the movie and its season''s rule');

SELECT * FROM finish();
ROLLBACK;
