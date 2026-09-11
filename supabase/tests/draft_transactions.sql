BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();
-- Every fixture, fault-injection trigger, and queued webhook rolls back.
CREATE FUNCTION pg_temp.draft_id(n INTEGER) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('82222222-2222-4222-8222-' || lpad(n::TEXT, 12, '0'))::UUID;
$$;
INSERT INTO auth.users(id, email) SELECT pg_temp.draft_id(n), 'draft-' || n || '@example.test' FROM generate_series(1, 3) n;
INSERT INTO leagues(id, name, owner_id, season_year, season_end, draft_slots, draft_counterpick_slots, faab_budget, custom_draft_order) VALUES
  (pg_temp.draft_id(10), 'Atomic snake draft', pg_temp.draft_id(1), extract(YEAR FROM current_date)::INTEGER, current_date + 90, 2, 0, 175, TRUE),
  (pg_temp.draft_id(20), 'Atomic counterpicks', pg_temp.draft_id(1), extract(YEAR FROM current_date)::INTEGER, current_date + 90, 1, 1, 250, TRUE),
  (pg_temp.draft_id(30), 'Explicit counterpick ending', pg_temp.draft_id(1), extract(YEAR FROM current_date)::INTEGER, current_date + 90, 1, 1, 80, TRUE);
INSERT INTO league_participants(id, league_id, user_id, role, draft_order)
SELECT pg_temp.draft_id(l + u), pg_temp.draft_id(l), pg_temp.draft_id(u), CASE WHEN u = 1 THEN 'owner' ELSE 'member' END, u
FROM (VALUES(10,2),(20,2),(30,3)) fixture(l, members), generate_series(1, members) u;
INSERT INTO teams(id, participant_id, name)
SELECT pg_temp.draft_id(1000 + l + u), pg_temp.draft_id(l + u), 'Team ' || u
FROM (VALUES(10,2),(20,2),(30,3)) fixture(l, members), generate_series(1, members) u;
INSERT INTO movies(id, tmdb_id, title, release_date, fantasy_points)
SELECT pg_temp.draft_id(n), 1987600000 + n, 'Atomic draft movie ' || n, current_date + 30, CASE WHEN n = 101 THEN 0 ELSE NULL END
FROM generate_series(101, 108) n;
INSERT INTO discord_channels(id, league_id, guild_id, channel_id, webhook_id, webhook_url)
VALUES(pg_temp.draft_id(500), pg_temp.draft_id(10), 'draft-test', 'draft-test-channel', 'draft-test', 'https://example.invalid/inert');

SELECT set_config('request.jwt.claim.sub', pg_temp.draft_id(1)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT start_draft(pg_temp.draft_id(10))$$, 'owner starts draft with transactional outbox');
SELECT lives_ok($$SELECT start_draft(pg_temp.draft_id(20))$$, 'owner starts counterpick league draft');
SELECT lives_ok($$SELECT start_draft(pg_temp.draft_id(30))$$, 'owner starts three-team draft');
SELECT throws_ok($$UPDATE leagues SET status = 'active' WHERE id = pg_temp.draft_id(10)$$, '42501', NULL, 'owner cannot bypass draft phases');
SELECT throws_ok($$UPDATE leagues SET draft_slots = 1 WHERE id = pg_temp.draft_id(10)$$, 'PT409', NULL, 'draft slots freeze at start');
SELECT throws_ok($$UPDATE leagues SET draft_counterpick_slots = 7 WHERE id = pg_temp.draft_id(10)$$, 'PT409', NULL, 'counterpick quota freezes at start');
DELETE FROM teams WHERE id = pg_temp.draft_id(1011);
SELECT is((SELECT count(*) FROM teams WHERE id = pg_temp.draft_id(1011)), 1::BIGINT, 'RLS hides team deletion and preserves live team');
SELECT throws_ok($$UPDATE teams SET participant_id = pg_temp.draft_id(1021) WHERE id = pg_temp.draft_id(1011)$$, '42501', NULL, 'team identity relocation cannot move a live roster');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(101), 1, pg_temp.draft_id(201))$$, '42501', NULL, 'authenticated cannot call service pick commit');
SELECT throws_ok($$SELECT commit_counterpick(pg_temp.draft_id(20), pg_temp.draft_id(2), pg_temp.draft_id(101), 1, pg_temp.draft_id(220))$$, '42501', NULL, 'authenticated cannot call service counterpick commit');
SELECT throws_ok($$SELECT transition_draft_phase(pg_temp.draft_id(20), pg_temp.draft_id(1), 'start_counterpicks')$$, '42501', NULL, 'authenticated cannot impersonate phase actor');
SELECT throws_ok($$SELECT get_counterpick_options(pg_temp.draft_id(20), pg_temp.draft_id(1022))$$, 'PT403', NULL, 'member cannot request options for another team');
SELECT lives_ok($$SELECT get_counterpick_options(pg_temp.draft_id(20), pg_temp.draft_id(1021))$$, 'member can request own team options');
SELECT throws_ok($$SELECT * FROM draft_submissions$$, '42501', NULL, 'attempt records are private');
SELECT throws_ok($$SELECT * FROM draft_notification_outbox$$, '42501', NULL, 'outbox read denied to authenticated');
SELECT throws_ok($$SELECT claim_draft_notifications(10)$$, '42501', NULL, 'outbox claim denied to authenticated');
SELECT throws_ok($$SELECT enqueue_draft_notification(pg_temp.draft_id(10), 'fake', 'draft_started')$$, '42501', NULL, 'outbox enqueue denied to authenticated');
SELECT throws_ok($$INSERT INTO counterpicks(league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pick_order, phase) VALUES(pg_temp.draft_id(20), pg_temp.draft_id(1021), pg_temp.draft_id(1022), pg_temp.draft_id(101), gen_random_uuid(), 1, 'draft')$$, '42501', NULL, 'direct counterpick insert cannot bypass turn checks');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', pg_temp.draft_id(3)::TEXT, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT get_next_counterpick_turn(pg_temp.draft_id(20))$$, 'PT403', NULL, 'outsider cannot read counterpick user identifiers');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT get_counterpick_options(pg_temp.draft_id(20), pg_temp.draft_id(1021))$$, '42501', NULL, 'anonymous cannot read counterpick options');
SELECT throws_ok($$SELECT get_next_counterpick_turn(pg_temp.draft_id(20))$$, '42501', NULL, 'anonymous cannot read counterpick user identifiers');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(101), 1, pg_temp.draft_id(201))$$, '42501', NULL, 'anonymous cannot commit a draft pick');
SELECT throws_ok($$SELECT claim_draft_notifications(10)$$, '42501', NULL, 'outbox claim denied to anonymous');
SELECT throws_ok($$SELECT * FROM draft_notification_outbox$$, '42501', NULL, 'outbox read denied to anonymous');
SELECT throws_ok($$SELECT enqueue_draft_notification(pg_temp.draft_id(10), 'fake', 'draft_started')$$, '42501', NULL, 'outbox enqueue denied to anonymous');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$DELETE FROM teams WHERE id = pg_temp.draft_id(1011)$$, 'PT409', NULL, 'service API team deletion cannot erase a live roster');
SELECT throws_ok($$SELECT enqueue_draft_notification(pg_temp.draft_id(10), 'fake', 'draft_started')$$, '42501', NULL, 'enqueue is internal even for service API');
SELECT throws_ok($$SELECT transition_draft_phase(pg_temp.draft_id(20), pg_temp.draft_id(1), 'start_counterpicks')$$, 'PT409', NULL, 'cannot start counterpicks before every draft pick');
SELECT throws_ok($$SELECT transition_draft_phase(pg_temp.draft_id(20), pg_temp.draft_id(1), 'skip_counterpicks')$$, 'PT409', NULL, 'cannot skip an unfinished draft');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(3), pg_temp.draft_id(101), 1, pg_temp.draft_id(299))$$, 'PT403', NULL, 'transaction rechecks membership');
SELECT is(commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(101), 1, pg_temp.draft_id(201))->>'replayed', 'false', 'first selection commits');
SELECT is(commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(101), 1, pg_temp.draft_id(201))->>'replayed', 'true', 'same attempt replays without another selection');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(102), 1, pg_temp.draft_id(201))$$, 'PT409', NULL, 'request key cannot be reused with different movie');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(2), pg_temp.draft_id(101), 1, pg_temp.draft_id(201))$$, 'PT409', NULL, 'request key binds original actor');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(20), pg_temp.draft_id(1), pg_temp.draft_id(101), 1, pg_temp.draft_id(201))$$, 'PT409', NULL, 'request key binds original league');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(101), 2, pg_temp.draft_id(201))$$, 'PT409', NULL, 'request key binds original slot');
SELECT is(commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(2), pg_temp.draft_id(102), 2, pg_temp.draft_id(202))->'next_pick'->>'user_id', pg_temp.draft_id(2)::TEXT, 'snake turnaround gives same player the next turn');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(2), pg_temp.draft_id(103), 2, pg_temp.draft_id(203))$$, 'PT409', NULL, 'stale slot cannot consume consecutive snake turn');
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(103), 3, pg_temp.draft_id(203))$$, 'PT403', NULL, 'transaction rechecks current player');
SELECT lives_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(2), pg_temp.draft_id(103), 3, pg_temp.draft_id(203))$$, 'correct snake turnaround selection succeeds');
RESET ROLE;
-- Force activation failure after it has started writing budgets/scores.
INSERT INTO team_budgets(team_id, remaining_budget) VALUES(pg_temp.draft_id(1012), 73);
CREATE FUNCTION pg_temp.fail_draft_score() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected activation failure'; END; $$;
CREATE TRIGGER test_fail_draft_score BEFORE INSERT OR UPDATE ON team_scores FOR EACH ROW
WHEN (NEW.team_id = '82222222-2222-4222-8222-000000001012') EXECUTE FUNCTION pg_temp.fail_draft_score();
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(104), 4, pg_temp.draft_id(204))$$, 'P0001', 'injected activation failure', 'activation failure aborts final pick transaction');
SELECT is((SELECT count(*) FROM draft_picks WHERE league_id = pg_temp.draft_id(10)), 3::BIGINT, 'failed activation leaves final slot available');
SELECT is((SELECT count(*) FROM draft_submissions WHERE request_id = pg_temp.draft_id(204)), 0::BIGINT, 'failed attempt reservation rolls back');
SELECT is((SELECT count(*) FROM team_budgets WHERE team_id = pg_temp.draft_id(1011)), 0::BIGINT, 'earlier budget insert rolls back');
SELECT is((SELECT count(*) FROM team_scores WHERE team_id = pg_temp.draft_id(1011)), 0::BIGINT, 'earlier score insert rolls back');
SELECT is((SELECT status::TEXT FROM leagues WHERE id = pg_temp.draft_id(10)), 'drafting', 'failed activation does not change phase');
SELECT is((SELECT count(*) FROM draft_notification_outbox WHERE league_id = pg_temp.draft_id(10)), 4::BIGINT, 'failed final pick does not enqueue a notification');
RESET ROLE;
DROP TRIGGER test_fail_draft_score ON team_scores;
SET LOCAL ROLE service_role;
SELECT is(commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(104), 4, pg_temp.draft_id(204))->'league'->>'status', 'active', 'same attempt retries successfully and activates atomically');
SELECT is((SELECT remaining_budget FROM team_budgets WHERE team_id = pg_temp.draft_id(1011)), 175, 'activation uses configured Fantasy Budget');
SELECT is((SELECT remaining_budget FROM team_budgets WHERE team_id = pg_temp.draft_id(1012)), 73, 'activation preserves an existing balance');
SELECT is((SELECT movies_pending FROM team_scores WHERE team_id = pg_temp.draft_id(1011)), 1, 'activation recalculates pending movies');
SELECT is((SELECT movies_scored FROM team_scores WHERE team_id = pg_temp.draft_id(1011)), 1, 'zero-point movie counts as scored');
SELECT is(commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(104), 4, pg_temp.draft_id(204))->>'replayed', 'true', 'lost final response replays after activation');
SELECT is(commit_draft_pick(pg_temp.draft_id(10), pg_temp.draft_id(1), pg_temp.draft_id(101), 1, pg_temp.draft_id(201))->'league'->>'status', 'active', 'old replay returns current league phase');
SELECT is((SELECT count(*) FROM draft_notification_outbox WHERE league_id = pg_temp.draft_id(10)), 6::BIGINT, 'replays do not duplicate durable notifications');

SELECT lives_ok($$SELECT commit_draft_pick(pg_temp.draft_id(20), pg_temp.draft_id(1), pg_temp.draft_id(101), 1, pg_temp.draft_id(211))$$, 'counterpick league first draft selection');
SELECT is(commit_draft_pick(pg_temp.draft_id(20), pg_temp.draft_id(2), pg_temp.draft_id(102), 2, pg_temp.draft_id(212))->'league'->>'status', 'drafting', 'configured counterpicks await explicit owner action');
SELECT throws_ok($$SELECT transition_draft_phase(pg_temp.draft_id(20), pg_temp.draft_id(2), 'start_counterpicks')$$, 'PT403', NULL, 'nonowner cannot start counterpicks');
SELECT is(transition_draft_phase(pg_temp.draft_id(20), pg_temp.draft_id(1), 'start_counterpicks')->'first_pick'->>'user_id', pg_temp.draft_id(2)::TEXT, 'counterpicks begin in reverse order');
SELECT is(transition_draft_phase(pg_temp.draft_id(20), pg_temp.draft_id(1), 'start_counterpicks')->'league'->>'status', 'counterpicking', 'owner start can replay');
SELECT throws_ok($$SELECT commit_counterpick(pg_temp.draft_id(20), pg_temp.draft_id(2), pg_temp.draft_id(102), 1, pg_temp.draft_id(221))$$, 'PT400', NULL, 'cannot counterpick own holding');
SELECT is(commit_counterpick(pg_temp.draft_id(20), pg_temp.draft_id(2), pg_temp.draft_id(101), 1, pg_temp.draft_id(221))->'counterpick'->>'fantasy_points', '0.00', 'zero score inverts to zero rather than pending');
SELECT is(commit_counterpick(pg_temp.draft_id(20), pg_temp.draft_id(2), pg_temp.draft_id(101), 1, pg_temp.draft_id(221))->>'replayed', 'true', 'counterpick attempt is idempotent');
SELECT is((SELECT counterpicked_by_team_id FROM draft_picks WHERE league_id = pg_temp.draft_id(20) AND movie_id = pg_temp.draft_id(101)), pg_temp.draft_id(1022), 'denormalized holding marker commits with counterpick');
SELECT is(commit_counterpick(pg_temp.draft_id(20), pg_temp.draft_id(1), pg_temp.draft_id(102), 2, pg_temp.draft_id(222))->'league'->>'status', 'active', 'final counterpick activates league');
SELECT is(commit_counterpick(pg_temp.draft_id(20), pg_temp.draft_id(1), pg_temp.draft_id(102), 2, pg_temp.draft_id(222))->>'round_complete', 'true', 'final counterpick replay succeeds after activation');

SELECT commit_draft_pick(pg_temp.draft_id(30), pg_temp.draft_id(1), pg_temp.draft_id(105), 1, pg_temp.draft_id(231));
SELECT commit_draft_pick(pg_temp.draft_id(30), pg_temp.draft_id(2), pg_temp.draft_id(106), 2, pg_temp.draft_id(232));
SELECT commit_draft_pick(pg_temp.draft_id(30), pg_temp.draft_id(3), pg_temp.draft_id(107), 3, pg_temp.draft_id(233));
SELECT transition_draft_phase(pg_temp.draft_id(30), pg_temp.draft_id(1), 'start_counterpicks');
SELECT commit_counterpick(pg_temp.draft_id(30), pg_temp.draft_id(3), pg_temp.draft_id(106), 1, pg_temp.draft_id(241));
SELECT commit_counterpick(pg_temp.draft_id(30), pg_temp.draft_id(2), pg_temp.draft_id(107), 2, pg_temp.draft_id(242));
SELECT is((SELECT status::TEXT FROM leagues WHERE id = pg_temp.draft_id(30)), 'counterpicking', 'exhausted eligible choices do not end round automatically');
SELECT throws_ok($$SELECT transition_draft_phase(pg_temp.draft_id(30), pg_temp.draft_id(2), 'end_counterpicks')$$, 'PT403', NULL, 'only owner can explicitly end remaining counterpicks');
SELECT is(transition_draft_phase(pg_temp.draft_id(30), pg_temp.draft_id(1), 'end_counterpicks')->>'round_complete', 'true', 'owner can end remaining counterpicks');
SELECT is((SELECT count(*) FROM counterpicks WHERE league_id = pg_temp.draft_id(30)), 2::BIGINT, 'explicit ending retains existing counterpicks');

-- Claim one oldest item per channel. A delayed retry also blocks later events.
RESET ROLE;
CREATE TEMP TABLE first_claim AS SELECT * FROM claim_draft_notifications(10);
SELECT is((SELECT count(*) FROM first_claim), 1::BIGINT, 'only oldest pending item is claimed for a channel');
SELECT is((SELECT kind FROM first_claim), 'draft_started', 'draft-start delivery precedes selections');
SELECT is((SELECT count(*) FROM claim_draft_notifications(10)), 0::BIGINT, 'active lease blocks both reclaim and later channel items');
SELECT is(finish_draft_notification((SELECT id FROM first_claim), gen_random_uuid(), 'sent'), FALSE, 'wrong lease cannot acknowledge a delivery');
SELECT is(finish_draft_notification((SELECT id FROM first_claim), (SELECT lease_token FROM first_claim), 'retry', 'test retry'), TRUE, 'correct lease schedules retry');
SELECT ok((SELECT available_at > now() FROM draft_notification_outbox WHERE id = (SELECT id FROM first_claim)), 'retry has a future retry time');
SELECT is((SELECT count(*) FROM claim_draft_notifications(10)), 0::BIGINT, 'delayed oldest retry blocks later messages');
UPDATE draft_notification_outbox SET available_at = now() WHERE id = (SELECT id FROM first_claim);
CREATE TEMP TABLE retried AS SELECT * FROM claim_draft_notifications(10);
SELECT is((SELECT id FROM retried), (SELECT id FROM first_claim), 'retry reclaims original oldest item');
SELECT is((SELECT attempts FROM retried), 2, 'claim advances attempt count');
SELECT is(finish_draft_notification((SELECT id FROM retried), (SELECT lease_token FROM retried), 'sent'), TRUE, 'correct lease acknowledges delivery');
CREATE TEMP TABLE next_claim AS SELECT * FROM claim_draft_notifications(10);
SELECT is((SELECT kind FROM next_claim), 'draft_pick', 'next selection becomes claimable after predecessor acknowledgement');
SELECT * FROM finish();
ROLLBACK;
