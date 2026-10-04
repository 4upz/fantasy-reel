-- Deleting an account removes that person, not the leagues other people play in.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id, email) VALUES
  ('8c000000-0000-4000-8000-000000000001', 'Leaving@Example.test'),
  ('8c000000-0000-4000-8000-000000000002', 'stays-a@example.test'),
  ('8c000000-0000-4000-8000-000000000003', 'stays-b@example.test'),
  ('8c000000-0000-4000-8000-000000000004', 'drafter-a@example.test'),
  ('8c000000-0000-4000-8000-000000000005', 'drafter-b@example.test'),
  ('8c000000-0000-4000-8000-000000000006', 'shared@example.test'),
  ('8c000000-0000-4000-8000-000000000007', 'Shared@Example.test'),
  ('8c000000-0000-4000-8000-000000000008', 'loner@example.test');
UPDATE profiles SET display_name = 'Leaving Person', avatar_url = 'https://cdn.discordapp.com/avatars/1/a.png', wishlist_public = TRUE
WHERE user_id = '8c000000-0000-4000-8000-000000000001';

-- Seasons: an active one they own, a setup one only they are in, a setup one
-- they joined, a completed one they played in, and a live draft elsewhere.
INSERT INTO leagues(id, name, owner_id, status, season_end) VALUES
  ('8c000000-0000-4000-8000-000000000011', 'Owned active', '8c000000-0000-4000-8000-000000000001', 'active', current_date + 30),
  ('8c000000-0000-4000-8000-000000000012', 'Owned alone', '8c000000-0000-4000-8000-000000000001', 'setup', current_date + 30),
  ('8c000000-0000-4000-8000-000000000013', 'Joined setup', '8c000000-0000-4000-8000-000000000002', 'setup', current_date + 30),
  ('8c000000-0000-4000-8000-000000000015', 'Live draft', '8c000000-0000-4000-8000-000000000004', 'drafting', current_date + 30);
INSERT INTO leagues(id, name, owner_id, status, season_end, completed_at, final_standings) VALUES
  ('8c000000-0000-4000-8000-000000000014', 'Finished', '8c000000-0000-4000-8000-000000000001', 'completed', current_date - 1, now(),
   '[{"user_id": "8c000000-0000-4000-8000-000000000001", "display_name": "Leaving Person", "team_name": "Leavers", "rank": 1},
     {"user_id": "8c000000-0000-4000-8000-000000000002", "display_name": "Stays A", "team_name": "Stayers", "rank": 2}]');

INSERT INTO league_participants(id, league_id, user_id, role, status, joined_at) VALUES
  ('8c000000-0000-4000-8000-000000000021', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000001', 'owner', 'active', now() - interval '3 days'),
  ('8c000000-0000-4000-8000-000000000022', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000003', 'member', 'active', now() - interval '1 day'),
  ('8c000000-0000-4000-8000-000000000023', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000002', 'member', 'active', now() - interval '2 days'),
  ('8c000000-0000-4000-8000-000000000024', '8c000000-0000-4000-8000-000000000012', '8c000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('8c000000-0000-4000-8000-000000000025', '8c000000-0000-4000-8000-000000000013', '8c000000-0000-4000-8000-000000000002', 'owner', 'active', now()),
  ('8c000000-0000-4000-8000-000000000026', '8c000000-0000-4000-8000-000000000013', '8c000000-0000-4000-8000-000000000001', 'member', 'active', now()),
  ('8c000000-0000-4000-8000-000000000027', '8c000000-0000-4000-8000-000000000014', '8c000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('8c000000-0000-4000-8000-000000000028', '8c000000-0000-4000-8000-000000000014', '8c000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('8c000000-0000-4000-8000-000000000029', '8c000000-0000-4000-8000-000000000015', '8c000000-0000-4000-8000-000000000004', 'owner', 'active', now()),
  ('8c000000-0000-4000-8000-000000000030', '8c000000-0000-4000-8000-000000000015', '8c000000-0000-4000-8000-000000000005', 'member', 'active', now());

INSERT INTO teams(id, participant_id, name, avatar_url) VALUES
  ('8c000000-0000-4000-8000-000000000031', '8c000000-0000-4000-8000-000000000021', 'Leavers', 'https://cdn.discordapp.com/avatars/1/t.png'),
  ('8c000000-0000-4000-8000-000000000032', '8c000000-0000-4000-8000-000000000022', 'Bees', NULL),
  ('8c000000-0000-4000-8000-000000000033', '8c000000-0000-4000-8000-000000000023', 'Stayers', NULL),
  ('8c000000-0000-4000-8000-000000000034', '8c000000-0000-4000-8000-000000000026', 'Setup leavers', NULL),
  ('8c000000-0000-4000-8000-000000000035', '8c000000-0000-4000-8000-000000000028', 'Finished leavers', NULL);

INSERT INTO movies(id, tmdb_id, title, release_date, fantasy_points) VALUES
  ('8c000000-0000-4000-8000-000000000041', 987620001, 'Leaver pick', current_date - 5, 20),
  ('8c000000-0000-4000-8000-000000000042', 987620002, 'Wanted movie', current_date + 50, NULL);
INSERT INTO draft_picks(id, league_id, team_id, movie_id, round, pick_number) VALUES
  ('8c000000-0000-4000-8000-000000000043', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000031', '8c000000-0000-4000-8000-000000000041', 1, 1);
INSERT INTO counterpicks(id, league_id, counterpicker_team_id, target_team_id, movie_id, draft_pick_id, pick_order, phase) VALUES
  ('8c000000-0000-4000-8000-000000000044', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000033', '8c000000-0000-4000-8000-000000000031', '8c000000-0000-4000-8000-000000000041', '8c000000-0000-4000-8000-000000000043', 1, 'bidding');
INSERT INTO pickup_bids(id, league_id, team_id, tmdb_id, amount, status, processing_deadline) VALUES
  ('8c000000-0000-4000-8000-000000000045', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000031', 987620002, 5, 'active', now() + interval '2 days'),
  ('8c000000-0000-4000-8000-000000000046', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000032', 987620002, 4, 'outbid', now() + interval '2 days');
INSERT INTO trade_offers(id, league_id, initiator_team_id, recipient_team_id, initiator_items, recipient_items, status) VALUES
  ('8c000000-0000-4000-8000-000000000047', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000032', '8c000000-0000-4000-8000-000000000031',
   '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}', 'proposed'),
  ('8c000000-0000-4000-8000-000000000048', '8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000032', '8c000000-0000-4000-8000-000000000033',
   '{"faab": 1, "movies": []}', '{"faab": 0, "movies": []}', 'proposed');

INSERT INTO notification_log(id, notification_type, recipient_email, recipient_user_id, status) VALUES
  ('8c000000-0000-4000-8000-000000000051', 'trade_proposed', 'leaving@example.test', '8c000000-0000-4000-8000-000000000001', 'sent'),
  ('8c000000-0000-4000-8000-000000000052', 'invitation', 'LEAVING@example.test', NULL, 'failed'),
  ('8c000000-0000-4000-8000-000000000053', 'trade_proposed', 'stays-a@example.test', '8c000000-0000-4000-8000-000000000002', 'sent'),
  ('8c000000-0000-4000-8000-000000000054', 'invitation', 'shared@example.test', NULL, 'sent');
INSERT INTO invitations(id, league_id, invited_by, email, status) VALUES
  ('8c000000-0000-4000-8000-000000000061', '8c000000-0000-4000-8000-000000000013', '8c000000-0000-4000-8000-000000000002', 'leaving@example.test', 'declined'),
  ('8c000000-0000-4000-8000-000000000062', '8c000000-0000-4000-8000-000000000013', '8c000000-0000-4000-8000-000000000002', 'someone@example.test', 'pending'),
  ('8c000000-0000-4000-8000-000000000063', '8c000000-0000-4000-8000-000000000013', '8c000000-0000-4000-8000-000000000002', 'shared@example.test', 'pending');

-- Clients cannot ask what blocks someone else's deletion.
SELECT set_config('request.jwt.claim.sub', '8c000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM account_deletion_blockers('8c000000-0000-4000-8000-000000000005')$$,
  '42501', NULL, 'clients cannot call account_deletion_blockers');
RESET ROLE;

-- A live draft blocks deletion, and the refusal changes nothing.
SELECT results_eq($$SELECT league_name FROM account_deletion_blockers('8c000000-0000-4000-8000-000000000005')$$,
  ARRAY['Live draft'], 'a live draft member is blocked');
SELECT throws_ok($$DELETE FROM auth.users WHERE id = '8c000000-0000-4000-8000-000000000005'$$,
  'PT409', 'Finish the draft in Live draft before deleting this account', 'deleting a drafting member is refused');
SELECT throws_ok($$DELETE FROM auth.users WHERE id = '8c000000-0000-4000-8000-000000000004'$$,
  'PT409', NULL, 'deleting a drafting owner is refused');
SELECT is((SELECT count(*) FROM league_participants WHERE league_id = '8c000000-0000-4000-8000-000000000015'), 2::BIGINT,
  'the live draft is untouched');

SELECT is((SELECT count(*) FROM account_deletion_blockers('8c000000-0000-4000-8000-000000000001')), 0::BIGINT,
  'nothing blocks the account being deleted');
SELECT lives_ok($$DELETE FROM auth.users WHERE id = '8c000000-0000-4000-8000-000000000001'$$, 'the account is deleted');

-- Owned seasons pass to the longest-standing member, or go when nobody else played.
SELECT is((SELECT owner_id FROM leagues WHERE id = '8c000000-0000-4000-8000-000000000011'), '8c000000-0000-4000-8000-000000000002'::UUID,
  'an owned season passes to the longest-standing member');
SELECT is((SELECT role::TEXT FROM league_participants WHERE id = '8c000000-0000-4000-8000-000000000023'), 'owner',
  'the new owner gets the owner role');
SELECT is((SELECT s.owner_id FROM league_series s JOIN leagues l ON l.series_id = s.id WHERE l.id = '8c000000-0000-4000-8000-000000000011'),
  '8c000000-0000-4000-8000-000000000002'::UUID, 'the series follows its newest season''s owner');
SELECT ok(NOT EXISTS (SELECT 1 FROM leagues WHERE id = '8c000000-0000-4000-8000-000000000012'), 'a season nobody else joined is deleted');
SELECT is((SELECT owner_id FROM leagues WHERE id = '8c000000-0000-4000-8000-000000000014'), '8c000000-0000-4000-8000-000000000002'::UUID,
  'a completed season passes to another member too');
SELECT ok(NOT EXISTS (SELECT 1 FROM league_series WHERE owner_id = '8c000000-0000-4000-8000-000000000001'), 'no series is left owned by the deleted account');

-- Setup seasons lose the person; active ones keep the team as a former member's.
SELECT ok(NOT EXISTS (SELECT 1 FROM league_participants WHERE id = '8c000000-0000-4000-8000-000000000026'), 'a setup season drops the participant');
SELECT ok(NOT EXISTS (SELECT 1 FROM teams WHERE id = '8c000000-0000-4000-8000-000000000034'), 'and their setup team');
SELECT is((SELECT status::TEXT || '/' || role::TEXT FROM league_participants WHERE id = '8c000000-0000-4000-8000-000000000021'), 'left/member',
  'an active season keeps the participant as a member who left');
SELECT ok(EXISTS (SELECT 1 FROM draft_picks WHERE id = '8c000000-0000-4000-8000-000000000043'), 'their roster stays');
SELECT ok(EXISTS (SELECT 1 FROM counterpicks WHERE id = '8c000000-0000-4000-8000-000000000044'), 'another team''s counterpick on them stays');
SELECT is((SELECT avatar_url FROM teams WHERE id = '8c000000-0000-4000-8000-000000000031'), NULL, 'their team photo is removed');
SELECT is((SELECT status::TEXT || '/' || resolution_reason FROM pickup_bids WHERE id = '8c000000-0000-4000-8000-000000000045'), 'cancelled/user_cancelled',
  'their pending bid is cancelled');
SELECT is((SELECT status::TEXT FROM pickup_bids WHERE id = '8c000000-0000-4000-8000-000000000046'), 'outbid', 'other teams'' bids are untouched');
SELECT is((SELECT status::TEXT FROM trade_offers WHERE id = '8c000000-0000-4000-8000-000000000047'), 'cancelled', 'an open trade with them is cancelled');
SELECT is((SELECT status::TEXT FROM trade_offers WHERE id = '8c000000-0000-4000-8000-000000000048'), 'proposed', 'other trades are untouched');
SELECT is((SELECT count(*) FROM league_standings('8c000000-0000-4000-8000-000000000011')), 2::BIGINT, 'standings list the members still playing');

-- History keeps the result but not the name.
SELECT is((SELECT final_standings FROM leagues WHERE id = '8c000000-0000-4000-8000-000000000014'),
  '[{"user_id": "8c000000-0000-4000-8000-000000000001", "display_name": "Former member", "team_name": "Leavers", "rank": 1},
    {"user_id": "8c000000-0000-4000-8000-000000000002", "display_name": "Stays A", "team_name": "Stayers", "rank": 2}]'::JSONB,
  'final standings show a former member and nothing else changes');
SELECT is((SELECT display_name::TEXT || '/' || coalesce(avatar_url, 'none') || '/' || wishlist_public::TEXT FROM profiles WHERE user_id = '8c000000-0000-4000-8000-000000000001'),
  'Former member/none/false', 'the profile becomes an anonymous former member');

-- Personal data addressed to them goes.
SELECT is((SELECT array_agg(id ORDER BY id) FROM notification_log WHERE id::TEXT LIKE '8c%'),
  ARRAY['8c000000-0000-4000-8000-000000000053', '8c000000-0000-4000-8000-000000000054']::UUID[], 'their delivery log rows are deleted, by id and by email');
SELECT is((SELECT array_agg(id ORDER BY id) FROM invitations WHERE id::TEXT LIKE '8c%'),
  ARRAY['8c000000-0000-4000-8000-000000000062', '8c000000-0000-4000-8000-000000000063']::UUID[], 'invitations to their email are deleted');

-- The finished season's result still cannot be rewritten in any other way.
SELECT set_config('app.deleting_user_id', '8c000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$UPDATE leagues SET final_standings = '[]' WHERE id = '8c000000-0000-4000-8000-000000000014'$$,
  '42501', 'This season is finished.', 'final standings stay frozen apart from anonymizing');
SELECT set_config('app.deleting_user_id', '', true);

-- A former member is no longer a notification recipient, without failing the batch.
SELECT lives_ok($$INSERT INTO notifications(user_id, league_id, type, title, body) VALUES
  ('8c000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000011', 'season_started', 't', 'b'),
  ('8c000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000011', 'season_started', 't', 'b')$$,
  'a batch naming a former member still inserts');
SELECT is((SELECT array_agg(user_id) FROM notifications WHERE league_id = '8c000000-0000-4000-8000-000000000011'),
  ARRAY['8c000000-0000-4000-8000-000000000002']::UUID[], 'only the remaining member is notified');

-- merge-accounts deletes a duplicate that shares the original's email (auth.users
-- keeps emails unique byte-for-byte, so the duplicate differs only in case).
SELECT lives_ok($$DELETE FROM auth.users WHERE id = '8c000000-0000-4000-8000-000000000007'$$, 'a duplicate account is deleted');
SELECT ok(EXISTS (SELECT 1 FROM invitations WHERE id = '8c000000-0000-4000-8000-000000000063'), 'data addressed to the shared email stays with the original');
SELECT ok(EXISTS (SELECT 1 FROM notification_log WHERE id = '8c000000-0000-4000-8000-000000000054'), 'including its delivery log');

-- Someone who never played leaves nothing behind.
SELECT lives_ok($$DELETE FROM auth.users WHERE id = '8c000000-0000-4000-8000-000000000008'$$, 'an account with no leagues is deleted');
SELECT ok(NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = '8c000000-0000-4000-8000-000000000008'), 'its profile is deleted');

-- The owner FKs no longer cascade.
SELECT is((SELECT confdeltype::TEXT FROM pg_constraint WHERE conname = 'leagues_owner_id_fkey'), 'r', 'leagues.owner_id restricts deletes');
SELECT is((SELECT confdeltype::TEXT FROM pg_constraint WHERE conname = 'league_series_owner_id_fkey'), 'r', 'league_series.owner_id restricts deletes');

SELECT * FROM finish();
ROLLBACK;
