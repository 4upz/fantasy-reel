BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id, email) VALUES ('81111111-1111-4111-8111-000000000001', 'season-a@example.test'), ('81111111-1111-4111-8111-000000000002', 'season-b@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('81111111-1111-4111-8111-000000000003', 'Season integrity A', '81111111-1111-4111-8111-000000000001', 'active', current_date - 1),
  ('81111111-1111-4111-8111-000000000004', 'Season integrity B', '81111111-1111-4111-8111-000000000002', 'active', current_date + 30);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('81111111-1111-4111-8111-000000000005', '81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000001', 'owner'), ('81111111-1111-4111-8111-000000000006', '81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000002', 'member'),
  ('81111111-1111-4111-8111-000000000007', '81111111-1111-4111-8111-000000000004', '81111111-1111-4111-8111-000000000002', 'owner'), ('81111111-1111-4111-8111-000000000008', '81111111-1111-4111-8111-000000000004', '81111111-1111-4111-8111-000000000001', 'member');
INSERT INTO teams(id, participant_id, name) VALUES
  ('81111111-1111-4111-8111-000000000009', '81111111-1111-4111-8111-000000000005', 'Alpha'), ('81111111-1111-4111-8111-000000000010', '81111111-1111-4111-8111-000000000006', 'Beta'),
  ('81111111-1111-4111-8111-000000000011', '81111111-1111-4111-8111-000000000007', 'Gamma'), ('81111111-1111-4111-8111-000000000012', '81111111-1111-4111-8111-000000000008', 'Delta');
INSERT INTO movies(id, tmdb_id, title, release_date, fantasy_points) VALUES
  ('81111111-1111-4111-8111-000000000013', 987610001, 'Shared movie', current_date - 5, 50),
  ('81111111-1111-4111-8111-000000000014', 987610002, 'Counterpick after drop', current_date - 5, 10),
  ('81111111-1111-4111-8111-000000000015', 987610003, 'Unheld movie', current_date - 5, 5),
  ('81111111-1111-4111-8111-000000000016', 987610004, 'Frozen only movie', current_date - 5, 5);
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number, dropped_at) VALUES
  ('81111111-1111-4111-8111-000000000017', '81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000009', '81111111-1111-4111-8111-000000000013', 1, 1, NULL),
  ('81111111-1111-4111-8111-000000000018', '81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000010', '81111111-1111-4111-8111-000000000014', 1, 2, NULL),
  ('81111111-1111-4111-8111-000000000019', '81111111-1111-4111-8111-000000000004', '81111111-1111-4111-8111-000000000011', '81111111-1111-4111-8111-000000000013', 1, 1, NULL),
  ('81111111-1111-4111-8111-000000000020', '81111111-1111-4111-8111-000000000004', '81111111-1111-4111-8111-000000000012', '81111111-1111-4111-8111-000000000014', 1, 2, now()),
  ('81111111-1111-4111-8111-000000000021', '81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000009', '81111111-1111-4111-8111-000000000016', 2, 1, NULL);
INSERT INTO counterpicks(league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pick_order, phase)
VALUES ('81111111-1111-4111-8111-000000000004', '81111111-1111-4111-8111-000000000011', '81111111-1111-4111-8111-000000000012', '81111111-1111-4111-8111-000000000014', '81111111-1111-4111-8111-000000000020', 1, 'bidding');
INSERT INTO counterpicks(league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pick_order, phase, fantasy_points)
VALUES ('81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000010', '81111111-1111-4111-8111-000000000009', '81111111-1111-4111-8111-000000000013', '81111111-1111-4111-8111-000000000017', 1, 'bidding', -50);
UPDATE draft_picks SET counterpicked_by_team_id = '81111111-1111-4111-8111-000000000010'
WHERE id = '81111111-1111-4111-8111-000000000017';
-- More frozen entries than a complete score-worker page, sorting before live movies.
INSERT INTO movies(id, tmdb_id, title, release_date, fantasy_points)
SELECT ('70000000-0000-4000-8000-' || lpad(i::TEXT, 12, '0'))::UUID,
  987611000 + i, 'Frozen queue ' || i, current_date - 5, 0
FROM generate_series(1, 501) i;
INSERT INTO draft_picks(league_id, team_id, movie_id, round, pick_number)
SELECT '81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000009', id, tmdb_id - 987611000 + 10, 1
FROM movies WHERE tmdb_id BETWEEN 987611001 AND 987611501;
INSERT INTO team_budgets(team_id) VALUES ('81111111-1111-4111-8111-000000000009'), ('81111111-1111-4111-8111-000000000010'), ('81111111-1111-4111-8111-000000000011'), ('81111111-1111-4111-8111-000000000012');
INSERT INTO team_scores(team_id, total_points) VALUES ('81111111-1111-4111-8111-000000000009', 0), ('81111111-1111-4111-8111-000000000010', 999);
INSERT INTO pickup_bids(id, league_id, team_id, tmdb_id, amount, processing_deadline)
VALUES ('81111111-1111-4111-8111-000000000022', '81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000009', 987610003, 2, now());
INSERT INTO trade_offers(id, league_id, initiator_team_id, recipient_team_id, initiator_items, status)
VALUES ('81111111-1111-4111-8111-000000000023', '81111111-1111-4111-8111-000000000003', '81111111-1111-4111-8111-000000000009', '81111111-1111-4111-8111-000000000010', '{"movies":[],"faab":1}', 'accepted');

SELECT is(complete_league_season('81111111-1111-4111-8111-000000000004', 'cron')->>'reason', 'not_due', 'cron rechecks extended deadline under the lock');

-- Force a real score failure: completion must leave both scores and status retryable.
CREATE FUNCTION pg_temp.fail_score_refresh() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected score failure'; END $$;
CREATE TRIGGER test_fail_score BEFORE UPDATE ON team_scores FOR EACH ROW
WHEN (NEW.team_id = '81111111-1111-4111-8111-000000000010') EXECUTE FUNCTION pg_temp.fail_score_refresh();
SELECT throws_ok($$SELECT complete_league_season('81111111-1111-4111-8111-000000000003', 'owner')$$, 'P0001', 'injected score failure', 'score failure aborts completion');
SELECT is((SELECT status::TEXT FROM leagues WHERE id = '81111111-1111-4111-8111-000000000003'), 'active', 'score failure leaves season active');
SELECT is((SELECT total_points::NUMERIC FROM team_scores WHERE team_id = '81111111-1111-4111-8111-000000000009'), 0::NUMERIC, 'earlier refresh also rolls back');
DROP TRIGGER test_fail_score ON team_scores;

CREATE FUNCTION pg_temp.fail_bid_cleanup() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected cleanup failure'; END $$;
CREATE TRIGGER test_fail_cleanup BEFORE UPDATE ON pickup_bids FOR EACH ROW
WHEN (NEW.id = '81111111-1111-4111-8111-000000000022') EXECUTE FUNCTION pg_temp.fail_bid_cleanup();
SELECT throws_ok($$SELECT complete_league_season('81111111-1111-4111-8111-000000000003', 'owner')$$, 'P0001', 'injected cleanup failure', 'cleanup failure aborts completion');
SELECT is((SELECT final_standings FROM leagues WHERE id = '81111111-1111-4111-8111-000000000003'), NULL::JSONB, 'cleanup failure does not write a partial result');
SELECT is((SELECT total_points::NUMERIC FROM team_scores WHERE team_id = '81111111-1111-4111-8111-000000000009'), 0::NUMERIC, 'cleanup failure rolls back rescoring');
DROP TRIGGER test_fail_cleanup ON pickup_bids;

SELECT is(complete_league_season('81111111-1111-4111-8111-000000000003', 'owner')->>'ok', 'true', 'retry completes successfully');
SELECT is((SELECT winner_team_ids FROM leagues WHERE id = '81111111-1111-4111-8111-000000000003'), ARRAY['81111111-1111-4111-8111-000000000009'::UUID], 'freshly rescored winner replaces stale cached leader');
SELECT is((SELECT (final_standings->0->>'total_points')::NUMERIC FROM leagues WHERE id = '81111111-1111-4111-8111-000000000003'), 55::NUMERIC, 'snapshot contains refreshed score');
SELECT is((SELECT status::TEXT FROM pickup_bids WHERE id = '81111111-1111-4111-8111-000000000022'), 'cancelled', 'pending bid is cancelled atomically');
SELECT is((SELECT expired_reason FROM trade_offers WHERE id = '81111111-1111-4111-8111-000000000023'), 'season_completed', 'accepted trade expires atomically');
SELECT is(complete_league_season('81111111-1111-4111-8111-000000000003', 'owner')->>'reason', 'not_active', 'completion cannot run twice');

SELECT lives_ok($$UPDATE movies SET fantasy_points = 100 WHERE id = '81111111-1111-4111-8111-000000000013'$$, 'shared movie updates succeed with a completed counterpick');
SELECT is((SELECT fantasy_points::NUMERIC FROM counterpicks WHERE league_id = '81111111-1111-4111-8111-000000000003'), -50::NUMERIC, 'completed counterpick retains its final score');
SELECT recalculate_teams_for_movie('81111111-1111-4111-8111-000000000013');
SELECT is((SELECT total_points::NUMERIC FROM team_scores WHERE team_id = '81111111-1111-4111-8111-000000000009'), 55::NUMERIC, 'shared movie fan-out preserves completed team scores');
SELECT is((SELECT total_points::NUMERIC FROM team_scores WHERE team_id = '81111111-1111-4111-8111-000000000011'), 90::NUMERIC, 'shared movie fan-out still refreshes active team and retained counterpick');
SELECT throws_ok($$UPDATE draft_picks SET dropped_at = now() WHERE id = '81111111-1111-4111-8111-000000000017'$$, '55000', 'This season is finished.', 'in-flight roster write cannot cross completion');
SELECT throws_ok($$UPDATE team_budgets SET remaining_budget = 99 WHERE team_id = '81111111-1111-4111-8111-000000000009'$$, '55000', 'This season is finished.', 'in-flight award cannot charge completed team');
SELECT throws_ok($$UPDATE pickup_bids SET status = 'won' WHERE id = '81111111-1111-4111-8111-000000000022'$$, '55000', 'This season is finished.', 'cancelled bid cannot be awarded later');

SELECT ok(EXISTS(SELECT 1 FROM score_update_candidates WHERE id = '81111111-1111-4111-8111-000000000013'), 'mixed active/completed movie stays eligible');
SELECT ok(EXISTS(SELECT 1 FROM score_update_candidates WHERE id = '81111111-1111-4111-8111-000000000014'), 'active counterpick after underlying drop keeps movie eligible');
SELECT ok(EXISTS(SELECT 1 FROM score_update_candidates WHERE id = '81111111-1111-4111-8111-000000000015'), 'unheld movie stays eligible');
SELECT ok(NOT EXISTS(SELECT 1 FROM score_update_candidates WHERE id = '81111111-1111-4111-8111-000000000016'), 'exclusively completed movie is excluded before batching');

SELECT is((SELECT count(*) FROM score_update_candidates WHERE tmdb_id BETWEEN 987610001 AND 987611501), 3::BIGINT, '501 frozen movies do not inflate the live backlog');
SELECT is((SELECT count(*) FROM (SELECT id FROM score_update_candidates WHERE tmdb_id BETWEEN 987610001 AND 987611501 ORDER BY scores_updated_at NULLS FIRST, id LIMIT 30) batch), 3::BIGINT, 'frozen pages cannot starve the live batch');

CREATE TEMP TABLE next_season AS SELECT start_next_season('81111111-1111-4111-8111-000000000003', (SELECT season_year + 1 FROM leagues WHERE id = '81111111-1111-4111-8111-000000000003')) AS id;
SELECT is((SELECT final_standings FROM leagues WHERE id = (SELECT id FROM next_season)), NULL::JSONB, 'rollover does not inherit final standings');

SELECT set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT complete_league_season('81111111-1111-4111-8111-000000000003', 'owner')$$, '42501', NULL, 'authenticated clients cannot call privileged completion RPC');
SELECT throws_ok($$SELECT * FROM score_update_candidates$$, '42501', NULL, 'score candidate view is service-only');
SELECT throws_ok($$UPDATE leagues SET status = 'active' WHERE id = '81111111-1111-4111-8111-000000000003'$$, '42501', 'This season is finished.', 'owner cannot reopen completed season through Data API');
SELECT throws_ok($$UPDATE leagues SET final_standings = '[]' WHERE id = '81111111-1111-4111-8111-000000000003'$$, '42501', 'This season is finished.', 'owner cannot replace frozen result through Data API');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO leagues(name, owner_id, series_id, season_year) SELECT 'Foreign attachment', '81111111-1111-4111-8111-000000000002', series_id, season_year + 4 FROM leagues WHERE id = '81111111-1111-4111-8111-000000000003'$$,
  '42501', 'Only the series owner can create its seasons', 'member cannot attach a season to another owner series');
SELECT throws_ok($$UPDATE leagues SET status = 'completed' WHERE id = '81111111-1111-4111-8111-000000000004'$$, '42501', 'Season results are managed by completion', 'owner cannot bypass finalization with a direct status update');
RESET ROLE;

SELECT lives_ok($$DELETE FROM auth.users WHERE id = '81111111-1111-4111-8111-000000000002'$$, 'account deletion cascades through completed counterpick references');
SELECT is((SELECT counterpicked_by_team_id FROM draft_picks WHERE id = '81111111-1111-4111-8111-000000000017'), NULL::UUID, 'counterpick team FK is detached');
SELECT is((SELECT jsonb_array_length(final_standings) FROM leagues WHERE id = '81111111-1111-4111-8111-000000000003'), 2, 'frozen history retains the deleted participant');
SELECT * FROM finish();
ROLLBACK;
