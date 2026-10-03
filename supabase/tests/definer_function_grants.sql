BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Internal SECURITY DEFINER functions that check nothing about the caller are
-- service-role only. Their only callers are Edge Functions (service role) and
-- other SECURITY DEFINER functions, which run as the owner.

CREATE TEMP TABLE internal_fns(fn) AS VALUES
  ('calculate_movie_score(uuid)'),
  ('recalculate_teams_for_movie(uuid)'),
  ('recalculate_team_score_with_counterpicks(uuid)'),
  ('queue_movies_for_scoring()'),
  ('queue_movie_for_scoring(uuid)'),
  ('process_score_queue()'),
  ('delete_score_queue_message(bigint)'),
  ('get_trade_offer_for_update(uuid)'),
  ('get_team_budget_for_update(uuid)'),
  ('validate_trade_items(uuid,jsonb)'),
  ('get_contested_source_ids(uuid)'),
  ('get_team_movie_count(uuid)'),
  ('get_league_faab_budget(uuid)'),
  ('get_team_league_id(uuid)'),
  ('log_notification_delivery(uuid,text,text,uuid,notification_delivery_status,text,text,jsonb)');
GRANT SELECT ON internal_fns TO anon, authenticated, service_role;

SELECT ok(NOT has_function_privilege(r, fn, 'EXECUTE'), r || ' cannot execute ' || fn)
FROM internal_fns, unnest(ARRAY['anon', 'authenticated']) AS r;

SELECT ok(has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role can execute ' || fn)
FROM internal_fns;

-- A season in its draft, where the owner may still change the scoring rule.
INSERT INTO auth.users(id, email) VALUES
  ('85111111-1111-4111-8111-000000000001', 'grants-owner@example.test'),
  ('85111111-1111-4111-8111-000000000002', 'grants-member@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('85111111-1111-4111-8111-000000000003', 'Grants league', '85111111-1111-4111-8111-000000000001', 'drafting', current_date + 60);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('85111111-1111-4111-8111-000000000004', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000001', 'owner'),
  ('85111111-1111-4111-8111-000000000005', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000002', 'member');
INSERT INTO teams(id, participant_id, name) VALUES
  ('85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000004', 'Grants Owner'),
  ('85111111-1111-4111-8111-000000000007', '85111111-1111-4111-8111-000000000005', 'Grants Member');
INSERT INTO movies(id, tmdb_id, title, release_date) VALUES
  ('85111111-1111-4111-8111-000000000008', 987650001, 'Grants hit', current_date - 30);
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('85111111-1111-4111-8111-000000000009', '85111111-1111-4111-8111-000000000003', '85111111-1111-4111-8111-000000000006', '85111111-1111-4111-8111-000000000008', 1, 1);
INSERT INTO reviews(movie_id, source, score) VALUES
  ('85111111-1111-4111-8111-000000000008', 'rotten_tomatoes', 95);

-- Clients are refused at the door.
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT calculate_movie_score('85111111-1111-4111-8111-000000000008')$$,
  '42501', NULL, 'anon cannot rescore a movie');
SELECT throws_ok($$SELECT log_notification_delivery(NULL, 'x', 'x@example.test', NULL, 'sent', NULL, NULL, '{}')$$,
  '42501', NULL, 'anon cannot write notification_log rows');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '85111111-1111-4111-8111-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT recalculate_team_score_with_counterpicks('85111111-1111-4111-8111-000000000006')$$,
  '42501', NULL, 'a member cannot rewrite a team score');
SELECT throws_ok($$SELECT validate_trade_items('85111111-1111-4111-8111-000000000006', '{"faab": 0, "movies": []}')$$,
  '42501', NULL, 'a member cannot probe another team through trade validation');
SELECT throws_ok($$SELECT * FROM get_contested_source_ids('85111111-1111-4111-8111-000000000003')$$,
  '42501', NULL, 'a member cannot call get_contested_source_ids directly');
SELECT throws_ok($$SELECT get_trade_offer_for_update('85111111-1111-4111-8111-000000000003')$$,
  '42501', NULL, 'a member cannot lock a trade offer');
RESET ROLE;

-- The service role (update-scores) still scores, which cascades through
-- recalculate_teams_for_movie into recalculate_team_score_with_counterpicks.
SET LOCAL ROLE service_role;
SELECT is(calculate_movie_score('85111111-1111-4111-8111-000000000008'), 35::NUMERIC,
  'service_role scores a movie');
RESET ROLE;
SELECT is((SELECT total_points FROM team_scores WHERE team_id = '85111111-1111-4111-8111-000000000006'),
  35::NUMERIC, 'and the nested team rescore ran');

-- The owner's direct scoring-rule change still rescores the season through
-- the SECURITY DEFINER trigger, which calls the now-revoked rescore function.
SELECT set_config('request.jwt.claim.sub', '85111111-1111-4111-8111-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$UPDATE leagues SET double_points_over_90 = true WHERE id = '85111111-1111-4111-8111-000000000003'$$,
  'the owner can still change the scoring rule');
RESET ROLE;
SELECT is((SELECT total_points FROM team_scores WHERE team_id = '85111111-1111-4111-8111-000000000006'),
  40::NUMERIC, 'and the season is rescored under the new rule');

SELECT * FROM finish();
ROLLBACK;
