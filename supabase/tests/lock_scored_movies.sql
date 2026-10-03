BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- A movie with a score is locked against bids and trades, released or not.

INSERT INTO auth.users(id, email) VALUES
  ('84111111-1111-4111-8111-000000000001', 'scored-lock-a@example.test'),
  ('84111111-1111-4111-8111-000000000002', 'scored-lock-b@example.test');
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('84111111-1111-4111-8111-000000000003', 'Scored lock live', '84111111-1111-4111-8111-000000000001', 'active', current_date + 60),
  ('84111111-1111-4111-8111-000000000004', 'Scored lock finished', '84111111-1111-4111-8111-000000000001', 'active', current_date + 60);
INSERT INTO league_participants(id, league_id, user_id, role) VALUES
  ('84111111-1111-4111-8111-000000000005', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000001', 'owner'),
  ('84111111-1111-4111-8111-000000000006', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000002', 'member'),
  ('84111111-1111-4111-8111-000000000007', '84111111-1111-4111-8111-000000000004', '84111111-1111-4111-8111-000000000001', 'owner'),
  ('84111111-1111-4111-8111-000000000008', '84111111-1111-4111-8111-000000000004', '84111111-1111-4111-8111-000000000002', 'member');
INSERT INTO teams(id, participant_id, name) VALUES
  ('84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000005', 'Lock Alpha'),
  ('84111111-1111-4111-8111-000000000010', '84111111-1111-4111-8111-000000000006', 'Lock Beta'),
  ('84111111-1111-4111-8111-000000000011', '84111111-1111-4111-8111-000000000007', 'Finished Alpha'),
  ('84111111-1111-4111-8111-000000000012', '84111111-1111-4111-8111-000000000008', 'Finished Beta');
INSERT INTO movies(id, tmdb_id, title, release_date, fantasy_points, combined_score) VALUES
  ('84111111-1111-4111-8111-000000000013', 987640001, 'Scored pick', current_date + 20, 12, 72),
  ('84111111-1111-4111-8111-000000000014', 987640002, 'Unscored pick', current_date + 20, NULL, NULL),
  ('84111111-1111-4111-8111-000000000015', 987640003, 'Scored pickup', current_date + 20, -8, 44),
  ('84111111-1111-4111-8111-000000000016', 987640004, 'Counterpicked scored', current_date + 20, 30, 90),
  ('84111111-1111-4111-8111-000000000017', 987640005, 'Scored free agent', current_date + 20, 5, 65),
  ('84111111-1111-4111-8111-000000000018', 987640006, 'Unscored free agent', current_date + 20, NULL, NULL),
  ('84111111-1111-4111-8111-000000000019', 987640007, 'Finished season scored', current_date + 20, 9, 69);
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('84111111-1111-4111-8111-000000000020', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000013', 1, 1),
  ('84111111-1111-4111-8111-000000000021', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000010', '84111111-1111-4111-8111-000000000014', 1, 2),
  ('84111111-1111-4111-8111-000000000022', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000010', '84111111-1111-4111-8111-000000000016', 2, 1),
  ('84111111-1111-4111-8111-000000000023', '84111111-1111-4111-8111-000000000004', '84111111-1111-4111-8111-000000000011', '84111111-1111-4111-8111-000000000019', 1, 1);
INSERT INTO pickup_bids(id, league_id, team_id, tmdb_id, amount, status, processing_deadline) VALUES
  ('84111111-1111-4111-8111-000000000024', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000010', 987640003, 4, 'won', now()),
  ('84111111-1111-4111-8111-000000000025', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', 987640005, 2, 'active', now());
INSERT INTO pickups(id, league_id, team_id, movie_id, bid_id, amount_paid) VALUES
  ('84111111-1111-4111-8111-000000000026', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000010', '84111111-1111-4111-8111-000000000015', '84111111-1111-4111-8111-000000000024', 4);
INSERT INTO counterpicks(id, league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pick_order, phase) VALUES
  ('84111111-1111-4111-8111-000000000027', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000010', '84111111-1111-4111-8111-000000000016', '84111111-1111-4111-8111-000000000022', 1, 'draft');

-- ----------------------------------------------------------------------------
-- Bids
-- ----------------------------------------------------------------------------

SELECT is(is_movie_eligible_for_pickup('84111111-1111-4111-8111-000000000003', 987640005),
  false, 'a scored free agent cannot be picked up');
SELECT is(is_movie_eligible_for_pickup('84111111-1111-4111-8111-000000000003', 987640005, '84111111-1111-4111-8111-000000000017'),
  false, 'nor when it is named by id');
SELECT is(is_movie_eligible_for_pickup('84111111-1111-4111-8111-000000000003', 987640006),
  true, 'an unscored free agent still can');

SELECT lives_ok($$UPDATE pickup_bids SET status = 'cancelled', resolution_reason = 'movie_scored'
  WHERE id = '84111111-1111-4111-8111-000000000025'$$,
  'a pickup bid can be cancelled because its movie was scored');
SELECT lives_ok($$INSERT INTO counterpick_bids(league_id, team_id, movie_id, target_team_id, draft_pick_id, amount, status, resolution_reason, processing_deadline)
  VALUES ('84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000014',
    '84111111-1111-4111-8111-000000000010', '84111111-1111-4111-8111-000000000021', 1, 'cancelled', 'movie_scored', now())$$,
  'so can a counterpick bid');

-- ----------------------------------------------------------------------------
-- Trade validation
-- ----------------------------------------------------------------------------

SELECT is(validate_trade_items('84111111-1111-4111-8111-000000000009',
    '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000013", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000020"}]}'),
  '"Scored pick" already has a score, so it can no longer be traded.',
  'a scored draft pick cannot be traded');
SELECT is(validate_trade_items('84111111-1111-4111-8111-000000000010',
    '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000015", "source": "pickup", "source_id": "84111111-1111-4111-8111-000000000026"}]}'),
  '"Scored pickup" already has a score, so it can no longer be traded.',
  'nor a scored pickup');
SELECT is(validate_trade_items('84111111-1111-4111-8111-000000000009',
    '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000016", "source": "counterpick", "source_id": "84111111-1111-4111-8111-000000000027"}]}'),
  '"Counterpicked scored" already has a score, so the counterpick on it can no longer be traded.',
  'nor the counterpick on a scored movie');
SELECT is(validate_trade_items('84111111-1111-4111-8111-000000000010',
    '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000013", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000020"}]}'),
  '"Scored pick" is no longer on that team''s roster, so it can''t be traded.',
  'ownership is judged before the score, as in the TypeScript validator');
SELECT is(validate_trade_items('84111111-1111-4111-8111-000000000010',
    '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000014", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000021"}]}'),
  NULL, 'an unscored movie still trades');

-- An agreed trade whose movie was scored is refused at execution, untouched.
INSERT INTO trade_offers(id, league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status, accepted_at) VALUES
  ('84111111-1111-4111-8111-000000000030', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000010',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000013", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000020"}]}',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000014", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000021"}]}',
   'accepted', now());
SELECT is(execute_trade('84111111-1111-4111-8111-000000000030')->>'error',
  'Initiator validation failed: "Scored pick" already has a score, so it can no longer be traded.',
  'execute_trade refuses a trade naming a scored movie');
SELECT is((SELECT team_id FROM draft_picks WHERE id = '84111111-1111-4111-8111-000000000020'),
  '84111111-1111-4111-8111-000000000009'::UUID, 'and moves nothing');

-- ----------------------------------------------------------------------------
-- Open offers naming a scored movie expire
-- ----------------------------------------------------------------------------

INSERT INTO trade_offers(id, league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status, accepted_at) VALUES
  -- Proposed, giving a scored movie
  ('84111111-1111-4111-8111-000000000031', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000010',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000013", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000020"}]}',
   '{"faab": 3, "movies": []}', 'proposed', NULL),
  -- In review, asking for the counterpick on a scored movie
  ('84111111-1111-4111-8111-000000000032', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000010', '84111111-1111-4111-8111-000000000009',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000014", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000021"}]}',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000016", "source": "counterpick", "source_id": "84111111-1111-4111-8111-000000000027"}]}',
   'review', now()),
  -- Countered, scored on both sides: the initiator's first scored item is named
  ('84111111-1111-4111-8111-000000000033', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000010', '84111111-1111-4111-8111-000000000009',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000014", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000021"}, {"movie_id": "84111111-1111-4111-8111-000000000015", "source": "pickup", "source_id": "84111111-1111-4111-8111-000000000026"}]}',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000013", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000020"}]}',
   'countered', NULL),
  -- Nothing scored: stays open
  ('84111111-1111-4111-8111-000000000034', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000010',
   '{"faab": 5, "movies": []}',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000014", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000021"}]}',
   'proposed', NULL),
  -- The items' movie_id says scored, the source row does not: the row decides
  ('84111111-1111-4111-8111-000000000035', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000010',
   '{"faab": 2, "movies": []}',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000013", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000021"}]}',
   'proposed', NULL),
  -- Already finished
  ('84111111-1111-4111-8111-000000000036', '84111111-1111-4111-8111-000000000003', '84111111-1111-4111-8111-000000000009', '84111111-1111-4111-8111-000000000010',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000013", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000020"}]}',
   '{"faab": 0, "movies": []}', 'rejected', NULL),
  -- A finished season's offer is expireFinishedSeasonOffers' to end
  ('84111111-1111-4111-8111-000000000037', '84111111-1111-4111-8111-000000000004', '84111111-1111-4111-8111-000000000011', '84111111-1111-4111-8111-000000000012',
   '{"faab": 0, "movies": [{"movie_id": "84111111-1111-4111-8111-000000000019", "source": "draft_pick", "source_id": "84111111-1111-4111-8111-000000000023"}]}',
   '{"faab": 0, "movies": []}', 'proposed', NULL);
UPDATE leagues SET status = 'completed' WHERE id = '84111111-1111-4111-8111-000000000004';

SELECT results_eq(
  $$SELECT id, status::TEXT, veto_reason, expired_reason FROM expire_scored_trade_offers() ORDER BY id$$,
  $$VALUES
    ('84111111-1111-4111-8111-000000000030'::UUID, 'expired', '"Scored pick" already has a score, so it can no longer be traded.', NULL::TEXT),
    ('84111111-1111-4111-8111-000000000031'::UUID, 'expired', '"Scored pick" already has a score, so it can no longer be traded.', NULL::TEXT),
    ('84111111-1111-4111-8111-000000000032'::UUID, 'expired', '"Counterpicked scored" already has a score, so the counterpick on it can no longer be traded.', NULL::TEXT),
    ('84111111-1111-4111-8111-000000000033'::UUID, 'expired', '"Scored pickup" already has a score, so it can no longer be traded.', NULL::TEXT)$$,
  'every open offer naming a scored movie expires, naming it as the validator would'
);
SELECT results_eq(
  $$SELECT id, status::TEXT FROM trade_offers
    WHERE id IN ('84111111-1111-4111-8111-000000000034', '84111111-1111-4111-8111-000000000035',
                 '84111111-1111-4111-8111-000000000036', '84111111-1111-4111-8111-000000000037')
    ORDER BY id$$,
  $$VALUES
    ('84111111-1111-4111-8111-000000000034'::UUID, 'proposed'),
    ('84111111-1111-4111-8111-000000000035'::UUID, 'proposed'),
    ('84111111-1111-4111-8111-000000000036'::UUID, 'rejected'),
    ('84111111-1111-4111-8111-000000000037'::UUID, 'proposed')$$,
  'offers without a scored movie, closed offers and finished seasons are left alone'
);
SELECT is_empty($$SELECT id FROM expire_scored_trade_offers()$$, 'a second sweep claims nothing');

SELECT * FROM finish();
ROLLBACK;
