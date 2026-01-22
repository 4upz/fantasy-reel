-- ============================================================
-- Fantasy Reel Test Seed Data
-- Run: npx supabase db reset
-- ============================================================

-- ============================================================
-- 1. TEST USERS
-- Password: testpass123!
-- ============================================================

INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, raw_app_meta_data, created_at, updated_at, role, aud,
  confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
  email_change, phone_change, phone_change_token, reauthentication_token,
  is_sso_user, is_anonymous
) VALUES
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'alice@fantasyreel.test', crypt('testpass123!', gen_salt('bf')), NOW(),
   '{"display_name": "Alice Spielberg"}'::jsonb, '{"provider": "email", "providers": ["email"]}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '', false, false),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'bob@fantasyreel.test', crypt('testpass123!', gen_salt('bf')), NOW(),
   '{"display_name": "Bob Nolan"}'::jsonb, '{"provider": "email", "providers": ["email"]}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '', false, false),
  ('c3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'carol@fantasyreel.test', crypt('testpass123!', gen_salt('bf')), NOW(),
   '{"display_name": "Carol Coppola"}'::jsonb, '{"provider": "email", "providers": ["email"]}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '', false, false),
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
   'dave@fantasyreel.test', crypt('testpass123!', gen_salt('bf')), NOW(),
   '{"display_name": "Dave Kubrick"}'::jsonb, '{"provider": "email", "providers": ["email"]}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '', false, false),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
   'eve@fantasyreel.test', crypt('testpass123!', gen_salt('bf')), NOW(),
   '{"display_name": "Eve Tarantino"}'::jsonb, '{"provider": "email", "providers": ["email"]}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '', false, false),
  ('f6666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000',
   'frank@fantasyreel.test', crypt('testpass123!', gen_salt('bf')), NOW(),
   '{"display_name": "Frank Scorsese"}'::jsonb, '{"provider": "email", "providers": ["email"]}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '', false, false);

-- Auth identities (required for login)
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '{"sub": "a1111111-1111-1111-1111-111111111111", "email": "alice@fantasyreel.test"}'::jsonb, 'email', 'a1111111-1111-1111-1111-111111111111', NOW(), NOW()),
  ('b2222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', '{"sub": "b2222222-2222-2222-2222-222222222222", "email": "bob@fantasyreel.test"}'::jsonb, 'email', 'b2222222-2222-2222-2222-222222222222', NOW(), NOW()),
  ('c3333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333', '{"sub": "c3333333-3333-3333-3333-333333333333", "email": "carol@fantasyreel.test"}'::jsonb, 'email', 'c3333333-3333-3333-3333-333333333333', NOW(), NOW()),
  ('d4444444-4444-4444-4444-444444444444', 'd4444444-4444-4444-4444-444444444444', '{"sub": "d4444444-4444-4444-4444-444444444444", "email": "dave@fantasyreel.test"}'::jsonb, 'email', 'd4444444-4444-4444-4444-444444444444', NOW(), NOW()),
  ('e5555555-5555-5555-5555-555555555555', 'e5555555-5555-5555-5555-555555555555', '{"sub": "e5555555-5555-5555-5555-555555555555", "email": "eve@fantasyreel.test"}'::jsonb, 'email', 'e5555555-5555-5555-5555-555555555555', NOW(), NOW()),
  ('f6666666-6666-6666-6666-666666666666', 'f6666666-6666-6666-6666-666666666666', '{"sub": "f6666666-6666-6666-6666-666666666666", "email": "frank@fantasyreel.test"}'::jsonb, 'email', 'f6666666-6666-6666-6666-666666666666', NOW(), NOW());

-- ============================================================
-- 2. LEAGUES
-- ============================================================

INSERT INTO leagues (id, name, owner_id, invite_only, status, max_participants, draft_start_date, draft_end_date) VALUES
  ('11111111-aaaa-aaaa-aaaa-111111111111', 'Blockbuster League', 'a1111111-1111-1111-1111-111111111111', true, 'drafting', 8, NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 days'),
  ('22222222-bbbb-bbbb-bbbb-222222222222', 'Oscar Contenders', 'a1111111-1111-1111-1111-111111111111', true, 'active', 6, NOW() - INTERVAL '30 days', NOW() - INTERVAL '23 days'),
  ('33333333-cccc-cccc-cccc-333333333333', 'Summer Blockbusters', 'b2222222-2222-2222-2222-222222222222', false, 'setup', 6, NOW() + INTERVAL '7 days', NOW() + INTERVAL '14 days'),
  ('44444444-dddd-dddd-dddd-444444444444', 'Completed Season 2024', 'c3333333-3333-3333-3333-333333333333', true, 'completed', 4, NOW() - INTERVAL '180 days', NOW() - INTERVAL '173 days');

-- ============================================================
-- 3. LEAGUE PARTICIPANTS
-- ============================================================

INSERT INTO league_participants (id, league_id, user_id, role, status, draft_order) VALUES
  -- Blockbuster League (drafting): Alice, Bob, Carol, Dave
  ('01111111-0001-0001-0001-000000000001', '11111111-aaaa-aaaa-aaaa-111111111111', 'a1111111-1111-1111-1111-111111111111', 'owner', 'active', 1),
  ('01111111-0002-0002-0002-000000000002', '11111111-aaaa-aaaa-aaaa-111111111111', 'b2222222-2222-2222-2222-222222222222', 'member', 'active', 2),
  ('01111111-0003-0003-0003-000000000003', '11111111-aaaa-aaaa-aaaa-111111111111', 'c3333333-3333-3333-3333-333333333333', 'member', 'active', 3),
  ('01111111-0004-0004-0004-000000000004', '11111111-aaaa-aaaa-aaaa-111111111111', 'd4444444-4444-4444-4444-444444444444', 'member', 'active', 4),
  -- Oscar Contenders (active): Alice, Bob, Carol
  ('02222222-0001-0001-0001-000000000001', '22222222-bbbb-bbbb-bbbb-222222222222', 'a1111111-1111-1111-1111-111111111111', 'owner', 'active', 1),
  ('02222222-0002-0002-0002-000000000002', '22222222-bbbb-bbbb-bbbb-222222222222', 'b2222222-2222-2222-2222-222222222222', 'member', 'active', 2),
  ('02222222-0003-0003-0003-000000000003', '22222222-bbbb-bbbb-bbbb-222222222222', 'c3333333-3333-3333-3333-333333333333', 'member', 'active', 3),
  -- Summer Blockbusters (setup): Bob only
  ('03333333-0001-0001-0001-000000000001', '33333333-cccc-cccc-cccc-333333333333', 'b2222222-2222-2222-2222-222222222222', 'owner', 'active', 1),
  -- Completed Season 2024: Carol, Alice
  ('04444444-0001-0001-0001-000000000001', '44444444-dddd-dddd-dddd-444444444444', 'c3333333-3333-3333-3333-333333333333', 'owner', 'active', 1),
  ('04444444-0002-0002-0002-000000000002', '44444444-dddd-dddd-dddd-444444444444', 'a1111111-1111-1111-1111-111111111111', 'member', 'active', 2);

-- ============================================================
-- 4. TEAMS
-- ============================================================

INSERT INTO teams (id, participant_id, name) VALUES
  -- Blockbuster League
  ('e1111111-0001-0001-0001-000000000001', '01111111-0001-0001-0001-000000000001', 'Spielberg Studios'),
  ('e1111111-0002-0002-0002-000000000002', '01111111-0002-0002-0002-000000000002', 'Nolan Pictures'),
  ('e1111111-0003-0003-0003-000000000003', '01111111-0003-0003-0003-000000000003', 'Coppola Films'),
  ('e1111111-0004-0004-0004-000000000004', '01111111-0004-0004-0004-000000000004', 'Kubrick Vision'),
  -- Oscar Contenders
  ('e2222222-0001-0001-0001-000000000001', '02222222-0001-0001-0001-000000000001', 'Award Hunters'),
  ('e2222222-0002-0002-0002-000000000002', '02222222-0002-0002-0002-000000000002', 'Golden Globe Gang'),
  ('e2222222-0003-0003-0003-000000000003', '02222222-0003-0003-0003-000000000003', 'Academy Aces'),
  -- Summer Blockbusters
  ('e3333333-0001-0001-0001-000000000001', '03333333-0001-0001-0001-000000000001', 'Summer Hits Inc'),
  -- Completed Season 2024
  ('e4444444-0001-0001-0001-000000000001', '04444444-0001-0001-0001-000000000001', 'Classic Cinema'),
  ('e4444444-0002-0002-0002-000000000002', '04444444-0002-0002-0002-000000000002', 'Vintage Vibes');

-- ============================================================
-- 5. MOVIES
-- ============================================================

INSERT INTO movies (id, tmdb_id, imdb_id, title, overview, release_date, poster_url, status, popularity, vote_average) VALUES
  -- Upcoming
  ('f0000001-0000-0000-0000-000000000001', 575264, 'tt9603212', 'Mission: Impossible - Dead Reckoning Part Two', 'Ethan Hunt and the IMF team embark on their most dangerous mission yet.', '2025-05-23', '/mi8poster.jpg', 'upcoming', 89.5, 0),
  ('f0000002-0000-0000-0000-000000000002', 83533, 'tt5765804', 'Avatar 3', 'The next chapter in James Cameron''s epic saga on Pandora.', '2025-12-19', '/avatar3poster.jpg', 'upcoming', 120.3, 0),
  ('f0000003-0000-0000-0000-000000000003', 617126, 'tt10676048', 'The Fantastic Four: First Steps', 'Marvel''s First Family arrives in the MCU.', '2025-07-25', '/ff4poster.jpg', 'upcoming', 95.2, 0),
  ('f0000004-0000-0000-0000-000000000004', 986056, 'tt11596448', 'Thunderbolts*', 'A team of antiheroes is assembled for a dangerous mission.', '2025-05-02', '/thunderboltsposter.jpg', 'upcoming', 78.4, 0),
  ('f0000005-0000-0000-0000-000000000005', 822119, 'tt14513804', 'Captain America: Brave New World', 'Sam Wilson takes on the shield in a world of political intrigue.', '2025-02-14', '/cap4poster.jpg', 'upcoming', 82.1, 0),
  ('f0000006-0000-0000-0000-000000000006', 1064213, 'tt21357150', 'Superman', 'James Gunn reboots the Man of Steel for the new DCU.', '2025-07-11', '/supermanposter.jpg', 'upcoming', 110.5, 0),
  ('f0000007-0000-0000-0000-000000000007', 939243, 'tt12804958', 'Jurassic World Rebirth', 'A new era of dinosaurs threatens humanity.', '2025-07-02', '/jw4poster.jpg', 'upcoming', 75.3, 0),
  ('f0000008-0000-0000-0000-000000000008', 558449, 'tt10954652', 'Gladiator II', 'The legacy of Maximus continues in ancient Rome.', '2025-11-22', '/gladiator2poster.jpg', 'upcoming', 88.7, 0),
  ('f0000009-0000-0000-0000-000000000009', 693134, 'tt11866324', 'Dune: Part Three', 'The epic conclusion to the Dune saga.', '2026-12-18', '/dune3poster.jpg', 'upcoming', 92.4, 0),
  ('f0000010-0000-0000-0000-000000000010', 438148, 'tt6443346', 'Minions 3', 'The Minions return for more mischief.', '2025-06-27', '/minions3poster.jpg', 'upcoming', 65.8, 0),
  ('f0000011-0000-0000-0000-000000000011', 447365, 'tt6791350', 'Guardians of the Galaxy Vol. 4', 'The Guardians face a new cosmic threat.', '2026-05-01', '/gotg4poster.jpg', 'upcoming', 70.2, 0),
  ('f0000012-0000-0000-0000-000000000012', 550988, 'tt7740510', 'Tron: Ares', 'A new journey into the digital frontier.', '2025-10-10', '/tronposter.jpg', 'upcoming', 55.4, 0),
  ('f0000013-0000-0000-0000-000000000013', 634649, 'tt10872600', 'Spider-Man 4', 'Peter Parker faces his greatest challenge yet.', '2026-07-24', '/spiderman4poster.jpg', 'upcoming', 105.6, 0),
  ('f0000014-0000-0000-0000-000000000014', 508943, 'tt9362722', 'Luca 2', 'The sea monsters return for another adventure.', '2025-06-13', '/luca2poster.jpg', 'upcoming', 48.3, 0),
  ('f0000015-0000-0000-0000-000000000015', 385687, 'tt1630029', 'Fast X Part 2', 'The family faces their final ride.', '2025-04-04', '/fastx2poster.jpg', 'upcoming', 72.1, 0),
  -- Released (with scores)
  ('f0000016-0000-0000-0000-000000000016', 872585, 'tt15398776', 'Oppenheimer', 'The story of J. Robert Oppenheimer and the atomic bomb.', '2023-07-21', '/oppenheimerposter.jpg', 'released', 145.2, 8.4),
  ('f0000017-0000-0000-0000-000000000017', 346698, 'tt1517268', 'Barbie', 'Barbie and Ken leave Barbieland for the real world.', '2023-07-21', '/barbieposter.jpg', 'released', 135.8, 7.0),
  ('f0000018-0000-0000-0000-000000000018', 466420, 'tt6166392', 'Killers of the Flower Moon', 'Scorsese''s epic about the Osage murders.', '2023-10-20', '/kotfmposter.jpg', 'released', 98.4, 7.8),
  ('f0000019-0000-0000-0000-000000000019', 787699, 'tt6443346', 'Wonka', 'The origin story of Willy Wonka.', '2023-12-15', '/wonkaposter.jpg', 'released', 88.2, 7.2),
  ('f0000020-0000-0000-0000-000000000020', 507089, 'tt9603208', 'Five Nights at Freddy''s', 'A security guard uncovers the secrets of Freddy Fazbear''s Pizza.', '2023-10-27', '/fnafposter.jpg', 'released', 75.6, 5.4),
  ('f0000021-0000-0000-0000-000000000021', 695721, 'tt10366206', 'The Hunger Games: The Ballad of Songbirds & Snakes', 'The origin of President Snow.', '2023-11-17', '/hungergamesposter.jpg', 'released', 82.3, 7.0),
  ('f0000022-0000-0000-0000-000000000022', 609681, 'tt14209916', 'The Marvels', 'Carol Danvers teams up with Ms. Marvel and Monica Rambeau.', '2023-11-10', '/marvelsposter.jpg', 'released', 68.4, 6.2),
  ('f0000023-0000-0000-0000-000000000023', 940551, 'tt17279496', 'Migration', 'A family of ducks embarks on an adventure.', '2023-12-22', '/migrationposter.jpg', 'released', 62.1, 7.0),
  ('f0000024-0000-0000-0000-000000000024', 866398, 'tt13238346', 'The Beekeeper', 'Jason Statham as a former operative seeking justice.', '2024-01-12', '/beekeeperposter.jpg', 'released', 58.7, 7.1),
  ('f0000025-0000-0000-0000-000000000025', 848326, 'tt9362930', 'Rebel Moon: Part One', 'Zack Snyder''s space opera epic.', '2023-12-22', '/rebelmoonposter.jpg', 'released', 72.4, 5.6),
  ('f0000026-0000-0000-0000-000000000026', 653346, 'tt9419884', 'Kingdom of the Planet of the Apes', 'A new chapter in the Apes saga.', '2024-05-10', '/kotpoaposter.jpg', 'released', 85.3, 7.1),
  ('f0000027-0000-0000-0000-000000000027', 748783, 'tt15789038', 'Godzilla x Kong: The New Empire', 'The titans team up against a new threat.', '2024-03-29', '/gxkposter.jpg', 'released', 92.6, 6.5),
  ('f0000028-0000-0000-0000-000000000028', 1011985, 'tt23289160', 'Kung Fu Panda 4', 'Po faces a new mystical villain.', '2024-03-08', '/kfp4poster.jpg', 'released', 78.9, 6.8),
  ('f0000029-0000-0000-0000-000000000029', 438631, 'tt1160419', 'Dune: Part Two', 'Paul Atreides unites with Chani and the Fremen.', '2024-03-01', '/dune2poster.jpg', 'released', 125.4, 8.5),
  ('f0000030-0000-0000-0000-000000000030', 823464, 'tt12758060', 'Furiosa: A Mad Max Saga', 'The origin story of Furiosa.', '2024-05-24', '/furiosaposter.jpg', 'released', 88.1, 7.6);

-- ============================================================
-- 6. DRAFT PICKS
-- ============================================================

-- Blockbuster League: 12 picks (3 rounds, snake draft)
INSERT INTO draft_picks (id, league_id, team_id, movie_id, round, pick_number, picked_at) VALUES
  -- Round 1: 1,2,3,4
  ('d0111111-0001-0001-0001-000000000001', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0001-0001-0001-000000000001', 'f0000001-0000-0000-0000-000000000001', 1, 1, NOW() - INTERVAL '2 hours'),
  ('d0111111-0002-0002-0002-000000000002', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0002-0002-0002-000000000002', 'f0000002-0000-0000-0000-000000000002', 1, 2, NOW() - INTERVAL '1 hour 50 minutes'),
  ('d0111111-0003-0003-0003-000000000003', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0003-0003-0003-000000000003', 'f0000003-0000-0000-0000-000000000003', 1, 3, NOW() - INTERVAL '1 hour 40 minutes'),
  ('d0111111-0004-0004-0004-000000000004', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0004-0004-0004-000000000004', 'f0000004-0000-0000-0000-000000000004', 1, 4, NOW() - INTERVAL '1 hour 30 minutes'),
  -- Round 2: 4,3,2,1 (snake)
  ('d0111111-0005-0005-0005-000000000005', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0004-0004-0004-000000000004', 'f0000005-0000-0000-0000-000000000005', 2, 5, NOW() - INTERVAL '1 hour 20 minutes'),
  ('d0111111-0006-0006-0006-000000000006', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0003-0003-0003-000000000003', 'f0000006-0000-0000-0000-000000000006', 2, 6, NOW() - INTERVAL '1 hour 10 minutes'),
  ('d0111111-0007-0007-0007-000000000007', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0002-0002-0002-000000000002', 'f0000007-0000-0000-0000-000000000007', 2, 7, NOW() - INTERVAL '1 hour'),
  ('d0111111-0008-0008-0008-000000000008', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0001-0001-0001-000000000001', 'f0000008-0000-0000-0000-000000000008', 2, 8, NOW() - INTERVAL '50 minutes'),
  -- Round 3: 1,2,3,4
  ('d0111111-0009-0009-0009-000000000009', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0001-0001-0001-000000000001', 'f0000009-0000-0000-0000-000000000009', 3, 9, NOW() - INTERVAL '40 minutes'),
  ('d0111111-0010-0010-0010-000000000010', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0002-0002-0002-000000000002', 'f0000010-0000-0000-0000-000000000010', 3, 10, NOW() - INTERVAL '30 minutes'),
  ('d0111111-0011-0011-0011-000000000011', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0003-0003-0003-000000000003', 'f0000011-0000-0000-0000-000000000011', 3, 11, NOW() - INTERVAL '20 minutes'),
  ('d0111111-0012-0012-0012-000000000012', '11111111-aaaa-aaaa-aaaa-111111111111', 'e1111111-0004-0004-0004-000000000004', 'f0000012-0000-0000-0000-000000000012', 3, 12, NOW() - INTERVAL '10 minutes');

-- Oscar Contenders: 15 picks (5 rounds, 3 teams)
INSERT INTO draft_picks (id, league_id, team_id, movie_id, round, pick_number, picked_at) VALUES
  ('d0222222-0001-0001-0001-000000000001', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0001-0001-0001-000000000001', 'f0000016-0000-0000-0000-000000000016', 1, 1, NOW() - INTERVAL '25 days'),
  ('d0222222-0002-0002-0002-000000000002', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0002-0002-0002-000000000002', 'f0000017-0000-0000-0000-000000000017', 1, 2, NOW() - INTERVAL '25 days'),
  ('d0222222-0003-0003-0003-000000000003', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0003-0003-0003-000000000003', 'f0000018-0000-0000-0000-000000000018', 1, 3, NOW() - INTERVAL '25 days'),
  ('d0222222-0004-0004-0004-000000000004', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0003-0003-0003-000000000003', 'f0000019-0000-0000-0000-000000000019', 2, 4, NOW() - INTERVAL '24 days'),
  ('d0222222-0005-0005-0005-000000000005', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0002-0002-0002-000000000002', 'f0000020-0000-0000-0000-000000000020', 2, 5, NOW() - INTERVAL '24 days'),
  ('d0222222-0006-0006-0006-000000000006', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0001-0001-0001-000000000001', 'f0000021-0000-0000-0000-000000000021', 2, 6, NOW() - INTERVAL '24 days'),
  ('d0222222-0007-0007-0007-000000000007', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0001-0001-0001-000000000001', 'f0000022-0000-0000-0000-000000000022', 3, 7, NOW() - INTERVAL '23 days'),
  ('d0222222-0008-0008-0008-000000000008', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0002-0002-0002-000000000002', 'f0000023-0000-0000-0000-000000000023', 3, 8, NOW() - INTERVAL '23 days'),
  ('d0222222-0009-0009-0009-000000000009', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0003-0003-0003-000000000003', 'f0000024-0000-0000-0000-000000000024', 3, 9, NOW() - INTERVAL '23 days'),
  ('d0222222-0010-0010-0010-000000000010', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0003-0003-0003-000000000003', 'f0000025-0000-0000-0000-000000000025', 4, 10, NOW() - INTERVAL '22 days'),
  ('d0222222-0011-0011-0011-000000000011', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0002-0002-0002-000000000002', 'f0000026-0000-0000-0000-000000000026', 4, 11, NOW() - INTERVAL '22 days'),
  ('d0222222-0012-0012-0012-000000000012', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0001-0001-0001-000000000001', 'f0000027-0000-0000-0000-000000000027', 4, 12, NOW() - INTERVAL '22 days'),
  ('d0222222-0013-0013-0013-000000000013', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0001-0001-0001-000000000001', 'f0000028-0000-0000-0000-000000000028', 5, 13, NOW() - INTERVAL '21 days'),
  ('d0222222-0014-0014-0014-000000000014', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0002-0002-0002-000000000002', 'f0000029-0000-0000-0000-000000000029', 5, 14, NOW() - INTERVAL '21 days'),
  ('d0222222-0015-0015-0015-000000000015', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0003-0003-0003-000000000003', 'f0000030-0000-0000-0000-000000000030', 5, 15, NOW() - INTERVAL '21 days');

-- Completed Season 2024: 10 picks (5 rounds, 2 teams)
INSERT INTO draft_picks (id, league_id, team_id, movie_id, round, pick_number, picked_at) VALUES
  ('d0444444-0001-0001-0001-000000000001', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0001-0001-0001-000000000001', 'f0000016-0000-0000-0000-000000000016', 1, 1, NOW() - INTERVAL '175 days'),
  ('d0444444-0002-0002-0002-000000000002', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0002-0002-0002-000000000002', 'f0000017-0000-0000-0000-000000000017', 1, 2, NOW() - INTERVAL '175 days'),
  ('d0444444-0003-0003-0003-000000000003', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0002-0002-0002-000000000002', 'f0000018-0000-0000-0000-000000000018', 2, 3, NOW() - INTERVAL '174 days'),
  ('d0444444-0004-0004-0004-000000000004', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0001-0001-0001-000000000001', 'f0000019-0000-0000-0000-000000000019', 2, 4, NOW() - INTERVAL '174 days'),
  ('d0444444-0005-0005-0005-000000000005', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0001-0001-0001-000000000001', 'f0000020-0000-0000-0000-000000000020', 3, 5, NOW() - INTERVAL '173 days'),
  ('d0444444-0006-0006-0006-000000000006', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0002-0002-0002-000000000002', 'f0000021-0000-0000-0000-000000000021', 3, 6, NOW() - INTERVAL '173 days'),
  ('d0444444-0007-0007-0007-000000000007', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0002-0002-0002-000000000002', 'f0000022-0000-0000-0000-000000000022', 4, 7, NOW() - INTERVAL '172 days'),
  ('d0444444-0008-0008-0008-000000000008', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0001-0001-0001-000000000001', 'f0000023-0000-0000-0000-000000000023', 4, 8, NOW() - INTERVAL '172 days'),
  ('d0444444-0009-0009-0009-000000000009', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0001-0001-0001-000000000001', 'f0000024-0000-0000-0000-000000000024', 5, 9, NOW() - INTERVAL '171 days'),
  ('d0444444-0010-0010-0010-000000000010', '44444444-dddd-dddd-dddd-444444444444', 'e4444444-0002-0002-0002-000000000002', 'f0000025-0000-0000-0000-000000000025', 5, 10, NOW() - INTERVAL '171 days');

-- ============================================================
-- 7. REVIEWS
-- ============================================================

INSERT INTO reviews (id, movie_id, source, score, raw_score, review_count, fetched_at) VALUES
  -- Oppenheimer
  ('a0000001-0001-0001-0001-000000000001', 'f0000016-0000-0000-0000-000000000016', 'imdb', 84.0, '8.4/10', 850000, NOW() - INTERVAL '5 days'),
  ('a0000001-0002-0002-0002-000000000002', 'f0000016-0000-0000-0000-000000000016', 'rotten_tomatoes', 93.0, '93%', 450, NOW() - INTERVAL '5 days'),
  ('a0000001-0003-0003-0003-000000000003', 'f0000016-0000-0000-0000-000000000016', 'metacritic', 88.0, '88/100', 65, NOW() - INTERVAL '5 days'),
  -- Barbie
  ('a0000002-0001-0001-0001-000000000001', 'f0000017-0000-0000-0000-000000000017', 'imdb', 70.0, '7.0/10', 620000, NOW() - INTERVAL '5 days'),
  ('a0000002-0002-0002-0002-000000000002', 'f0000017-0000-0000-0000-000000000017', 'rotten_tomatoes', 88.0, '88%', 420, NOW() - INTERVAL '5 days'),
  ('a0000002-0003-0003-0003-000000000003', 'f0000017-0000-0000-0000-000000000017', 'metacritic', 80.0, '80/100', 58, NOW() - INTERVAL '5 days'),
  -- Killers of the Flower Moon
  ('a0000003-0001-0001-0001-000000000001', 'f0000018-0000-0000-0000-000000000018', 'imdb', 78.0, '7.8/10', 320000, NOW() - INTERVAL '5 days'),
  ('a0000003-0002-0002-0002-000000000002', 'f0000018-0000-0000-0000-000000000018', 'rotten_tomatoes', 93.0, '93%', 380, NOW() - INTERVAL '5 days'),
  ('a0000003-0003-0003-0003-000000000003', 'f0000018-0000-0000-0000-000000000018', 'metacritic', 89.0, '89/100', 62, NOW() - INTERVAL '5 days'),
  -- Wonka
  ('a0000004-0001-0001-0001-000000000001', 'f0000019-0000-0000-0000-000000000019', 'imdb', 72.0, '7.2/10', 180000, NOW() - INTERVAL '5 days'),
  ('a0000004-0002-0002-0002-000000000002', 'f0000019-0000-0000-0000-000000000019', 'rotten_tomatoes', 83.0, '83%', 290, NOW() - INTERVAL '5 days'),
  ('a0000004-0003-0003-0003-000000000003', 'f0000019-0000-0000-0000-000000000019', 'metacritic', 66.0, '66/100', 48, NOW() - INTERVAL '5 days'),
  -- Five Nights at Freddy's
  ('a0000005-0001-0001-0001-000000000001', 'f0000020-0000-0000-0000-000000000020', 'imdb', 54.0, '5.4/10', 150000, NOW() - INTERVAL '5 days'),
  ('a0000005-0002-0002-0002-000000000002', 'f0000020-0000-0000-0000-000000000020', 'rotten_tomatoes', 32.0, '32%', 180, NOW() - INTERVAL '5 days'),
  ('a0000005-0003-0003-0003-000000000003', 'f0000020-0000-0000-0000-000000000020', 'metacritic', 42.0, '42/100', 35, NOW() - INTERVAL '5 days'),
  -- Hunger Games: Ballad
  ('a0000006-0001-0001-0001-000000000001', 'f0000021-0000-0000-0000-000000000021', 'imdb', 70.0, '7.0/10', 220000, NOW() - INTERVAL '5 days'),
  ('a0000006-0002-0002-0002-000000000002', 'f0000021-0000-0000-0000-000000000021', 'rotten_tomatoes', 64.0, '64%', 320, NOW() - INTERVAL '5 days'),
  ('a0000006-0003-0003-0003-000000000003', 'f0000021-0000-0000-0000-000000000021', 'metacritic', 55.0, '55/100', 52, NOW() - INTERVAL '5 days'),
  -- The Marvels
  ('a0000007-0001-0001-0001-000000000001', 'f0000022-0000-0000-0000-000000000022', 'imdb', 62.0, '6.2/10', 140000, NOW() - INTERVAL '5 days'),
  ('a0000007-0002-0002-0002-000000000002', 'f0000022-0000-0000-0000-000000000022', 'rotten_tomatoes', 62.0, '62%', 290, NOW() - INTERVAL '5 days'),
  ('a0000007-0003-0003-0003-000000000003', 'f0000022-0000-0000-0000-000000000022', 'metacritic', 50.0, '50/100', 45, NOW() - INTERVAL '5 days'),
  -- Migration
  ('a0000008-0001-0001-0001-000000000001', 'f0000023-0000-0000-0000-000000000023', 'imdb', 70.0, '7.0/10', 95000, NOW() - INTERVAL '5 days'),
  ('a0000008-0002-0002-0002-000000000002', 'f0000023-0000-0000-0000-000000000023', 'rotten_tomatoes', 56.0, '56%', 180, NOW() - INTERVAL '5 days'),
  ('a0000008-0003-0003-0003-000000000003', 'f0000023-0000-0000-0000-000000000023', 'metacritic', 55.0, '55/100', 32, NOW() - INTERVAL '5 days'),
  -- The Beekeeper
  ('a0000009-0001-0001-0001-000000000001', 'f0000024-0000-0000-0000-000000000024', 'imdb', 71.0, '7.1/10', 180000, NOW() - INTERVAL '5 days'),
  ('a0000009-0002-0002-0002-000000000002', 'f0000024-0000-0000-0000-000000000024', 'rotten_tomatoes', 70.0, '70%', 210, NOW() - INTERVAL '5 days'),
  ('a0000009-0003-0003-0003-000000000003', 'f0000024-0000-0000-0000-000000000024', 'metacritic', 55.0, '55/100', 38, NOW() - INTERVAL '5 days'),
  -- Rebel Moon
  ('a0000010-0001-0001-0001-000000000001', 'f0000025-0000-0000-0000-000000000025', 'imdb', 56.0, '5.6/10', 120000, NOW() - INTERVAL '5 days'),
  ('a0000010-0002-0002-0002-000000000002', 'f0000025-0000-0000-0000-000000000025', 'rotten_tomatoes', 22.0, '22%', 190, NOW() - INTERVAL '5 days'),
  ('a0000010-0003-0003-0003-000000000003', 'f0000025-0000-0000-0000-000000000025', 'metacritic', 36.0, '36/100', 42, NOW() - INTERVAL '5 days'),
  -- Kingdom of the Planet of the Apes
  ('a0000011-0001-0001-0001-000000000001', 'f0000026-0000-0000-0000-000000000026', 'imdb', 71.0, '7.1/10', 95000, NOW() - INTERVAL '5 days'),
  ('a0000011-0002-0002-0002-000000000002', 'f0000026-0000-0000-0000-000000000026', 'rotten_tomatoes', 80.0, '80%', 280, NOW() - INTERVAL '5 days'),
  ('a0000011-0003-0003-0003-000000000003', 'f0000026-0000-0000-0000-000000000026', 'metacritic', 63.0, '63/100', 48, NOW() - INTERVAL '5 days'),
  -- Godzilla x Kong
  ('a0000012-0001-0001-0001-000000000001', 'f0000027-0000-0000-0000-000000000027', 'imdb', 65.0, '6.5/10', 110000, NOW() - INTERVAL '5 days'),
  ('a0000012-0002-0002-0002-000000000002', 'f0000027-0000-0000-0000-000000000027', 'rotten_tomatoes', 55.0, '55%', 240, NOW() - INTERVAL '5 days'),
  ('a0000012-0003-0003-0003-000000000003', 'f0000027-0000-0000-0000-000000000027', 'metacritic', 48.0, '48/100', 40, NOW() - INTERVAL '5 days'),
  -- Kung Fu Panda 4
  ('a0000013-0001-0001-0001-000000000001', 'f0000028-0000-0000-0000-000000000028', 'imdb', 68.0, '6.8/10', 85000, NOW() - INTERVAL '5 days'),
  ('a0000013-0002-0002-0002-000000000002', 'f0000028-0000-0000-0000-000000000028', 'rotten_tomatoes', 71.0, '71%', 220, NOW() - INTERVAL '5 days'),
  ('a0000013-0003-0003-0003-000000000003', 'f0000028-0000-0000-0000-000000000028', 'metacritic', 58.0, '58/100', 42, NOW() - INTERVAL '5 days'),
  -- Dune: Part Two
  ('a0000014-0001-0001-0001-000000000001', 'f0000029-0000-0000-0000-000000000029', 'imdb', 85.0, '8.5/10', 650000, NOW() - INTERVAL '5 days'),
  ('a0000014-0002-0002-0002-000000000002', 'f0000029-0000-0000-0000-000000000029', 'rotten_tomatoes', 92.0, '92%', 420, NOW() - INTERVAL '5 days'),
  ('a0000014-0003-0003-0003-000000000003', 'f0000029-0000-0000-0000-000000000029', 'metacritic', 79.0, '79/100', 58, NOW() - INTERVAL '5 days'),
  -- Furiosa
  ('a0000015-0001-0001-0001-000000000001', 'f0000030-0000-0000-0000-000000000030', 'imdb', 76.0, '7.6/10', 180000, NOW() - INTERVAL '5 days'),
  ('a0000015-0002-0002-0002-000000000002', 'f0000030-0000-0000-0000-000000000030', 'rotten_tomatoes', 90.0, '90%', 350, NOW() - INTERVAL '5 days'),
  ('a0000015-0003-0003-0003-000000000003', 'f0000030-0000-0000-0000-000000000030', 'metacritic', 78.0, '78/100', 52, NOW() - INTERVAL '5 days');

-- ============================================================
-- 8. TEAM SCORES
-- ============================================================

INSERT INTO team_scores (id, team_id, total_points, movies_scored, movies_pending, average_score) VALUES
  -- Oscar Contenders
  ('b0222222-0001-0001-0001-000000000001', 'e2222222-0001-0001-0001-000000000001', 331.0, 5, 0, 66.2),
  ('b0222222-0002-0002-0002-000000000002', 'e2222222-0002-0002-0002-000000000002', 338.9, 5, 0, 67.8),
  ('b0222222-0003-0003-0003-000000000003', 'e2222222-0003-0003-0003-000000000003', 345.0, 5, 0, 69.0),
  -- Completed Season 2024
  ('b0444444-0001-0001-0001-000000000001', 'e4444444-0001-0001-0001-000000000001', 321.6, 5, 0, 64.3),
  ('b0444444-0002-0002-0002-000000000002', 'e4444444-0002-0002-0002-000000000002', 304.3, 5, 0, 60.9);

-- ============================================================
-- 9. INVITATIONS
-- ============================================================

INSERT INTO invitations (id, league_id, invited_by, email, token, status, sent_at, expires_at, responded_at) VALUES
  -- Pending: Carol
  ('c0033333-0001-0001-0001-000000000001', '33333333-cccc-cccc-cccc-333333333333', 'b2222222-2222-2222-2222-222222222222',
   'carol@fantasyreel.test', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending',
   NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days', NULL),
  -- Pending: Eve
  ('c0033333-0002-0002-0002-000000000002', '33333333-cccc-cccc-cccc-333333333333', 'b2222222-2222-2222-2222-222222222222',
   'eve@fantasyreel.test', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'pending',
   NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 days', NULL),
  -- Expired
  ('c0033333-0003-0003-0003-000000000003', '33333333-cccc-cccc-cccc-333333333333', 'b2222222-2222-2222-2222-222222222222',
   'expired@example.com', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'expired',
   NOW() - INTERVAL '10 days', NOW() - INTERVAL '3 days', NULL),
  -- Declined
  ('c0033333-0004-0004-0004-000000000004', '33333333-cccc-cccc-cccc-333333333333', 'b2222222-2222-2222-2222-222222222222',
   'declined@example.com', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'declined',
   NOW() - INTERVAL '5 days', NOW() + INTERVAL '2 days', NOW() - INTERVAL '4 days');

-- ============================================================
-- 10. TEAM BUDGETS (for active league bidding)
-- ============================================================

INSERT INTO team_budgets (id, team_id, remaining_budget, total_spent) VALUES
  -- Oscar Contenders (active league)
  ('bb222222-0001-0001-0001-000000000001', 'e2222222-0001-0001-0001-000000000001', 85, 15),  -- Alice: spent $15
  ('bb222222-0002-0002-0002-000000000002', 'e2222222-0002-0002-0002-000000000002', 72, 28),  -- Bob: spent $28
  ('bb222222-0003-0003-0003-000000000003', 'e2222222-0003-0003-0003-000000000003', 91, 9);   -- Carol: spent $9

-- ============================================================
-- 11. PICKUP BIDS (various states for testing)
-- ============================================================

INSERT INTO pickup_bids (id, league_id, team_id, tmdb_id, movie_data, amount, status, created_at, countered_at, response_deadline, processing_deadline) VALUES
  -- ACTIVE BID: Alice bidding $12 on Tron: Ares (no competition)
  ('0b000001-0001-0001-0001-000000000001', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0001-0001-0001-000000000001',
   550988, '{"title": "Tron: Ares", "poster_url": "/tronposter.jpg", "release_date": "2025-10-10"}'::jsonb,
   12, 'active', NOW() - INTERVAL '2 days', NULL, NULL, (date_trunc('week', NOW()) + INTERVAL '5 days 20 hours')),

  -- BIDDING WAR: Alice outbid by Bob on Minions 3
  -- Alice's original $8 bid (outbid, has counter-bid window)
  ('0b000002-0001-0001-0001-000000000001', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0001-0001-0001-000000000001',
   438148, '{"title": "Minions 3", "poster_url": "/minions3poster.jpg", "release_date": "2025-06-27"}'::jsonb,
   8, 'outbid', NOW() - INTERVAL '1 day', NOW() - INTERVAL '6 hours', NOW() + INTERVAL '18 hours', (date_trunc('week', NOW()) + INTERVAL '5 days 20 hours')),
  -- Bob's higher $15 bid (currently winning)
  ('0b000002-0002-0002-0002-000000000002', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0002-0002-0002-000000000002',
   438148, '{"title": "Minions 3", "poster_url": "/minions3poster.jpg", "release_date": "2025-06-27"}'::jsonb,
   15, 'active', NOW() - INTERVAL '6 hours', NULL, NULL, (date_trunc('week', NOW()) + INTERVAL '5 days 20 hours')),

  -- HISTORICAL: Bob won Fast X Part 2 for $13
  ('0b000003-0001-0001-0001-000000000001', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0002-0002-0002-000000000002',
   385687, '{"title": "Fast X Part 2", "poster_url": "/fastx2poster.jpg", "release_date": "2025-04-04"}'::jsonb,
   13, 'won', NOW() - INTERVAL '7 days', NULL, NULL, NOW() - INTERVAL '2 days'),

  -- HISTORICAL: Carol lost to Bob on Fast X Part 2
  ('0b000003-0002-0002-0002-000000000002', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0003-0003-0003-000000000003',
   385687, '{"title": "Fast X Part 2", "poster_url": "/fastx2poster.jpg", "release_date": "2025-04-04"}'::jsonb,
   9, 'lost', NOW() - INTERVAL '8 days', NOW() - INTERVAL '7 days 12 hours', NOW() - INTERVAL '7 days', NOW() - INTERVAL '2 days'),

  -- CANCELLED: Carol cancelled her Luca 2 bid
  ('0b000004-0001-0001-0001-000000000001', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0003-0003-0003-000000000003',
   508943, '{"title": "Luca 2", "poster_url": "/luca2poster.jpg", "release_date": "2025-06-13"}'::jsonb,
   5, 'cancelled', NOW() - INTERVAL '3 days', NULL, NULL, (date_trunc('week', NOW()) + INTERVAL '5 days 20 hours'));

-- ============================================================
-- 12. PICKUPS (completed acquisitions via bidding)
-- ============================================================

INSERT INTO pickups (id, league_id, team_id, movie_id, bid_id, amount_paid, picked_up_at) VALUES
  -- Bob won Fast X Part 2 for $13 (using existing movie f0000015)
  ('0a000001-0001-0001-0001-000000000001', '22222222-bbbb-bbbb-bbbb-222222222222', 'e2222222-0002-0002-0002-000000000002',
   'f0000015-0000-0000-0000-000000000015', '0b000003-0001-0001-0001-000000000001', 13, NOW() - INTERVAL '2 days');

-- ============================================================
-- 13. NOTIFICATIONS (for testing notification bell)
-- ============================================================

INSERT INTO notifications (id, user_id, league_id, type, title, body, data, read_at, created_at) VALUES
  -- Alice: outbid notification (unread)
  ('0c000001-0001-0001-0001-000000000001', 'a1111111-1111-1111-1111-111111111111', '22222222-bbbb-bbbb-bbbb-222222222222',
   'outbid', 'You''ve been outbid on Minions 3',
   'Someone bid $15 on Minions 3. You have 24 hours to counter.',
   '{"bid_id": "0b000002-0001-0001-0001-000000000001", "tmdb_id": 438148, "new_amount": 15}'::jsonb,
   NULL, NOW() - INTERVAL '6 hours'),

  -- Carol: bid lost notification (unread)
  ('0c000002-0001-0001-0001-000000000001', 'c3333333-3333-3333-3333-333333333333', '22222222-bbbb-bbbb-bbbb-222222222222',
   'bid_lost', 'Bid unsuccessful for Fast X Part 2',
   'Your bid of $9 was not enough. The winning bid was $13.',
   '{"bid_id": "0b000003-0002-0002-0002-000000000002", "tmdb_id": 385687, "winning_amount": 13}'::jsonb,
   NULL, NOW() - INTERVAL '2 days'),

  -- Bob: bid won notification (read)
  ('0c000003-0001-0001-0001-000000000001', 'b2222222-2222-2222-2222-222222222222', '22222222-bbbb-bbbb-bbbb-222222222222',
   'bid_won', 'You won Fast X Part 2!',
   'Your bid of $13 won. Fast X Part 2 has been added to your roster.',
   '{"bid_id": "0b000003-0001-0001-0001-000000000001", "tmdb_id": 385687, "amount": 13}'::jsonb,
   NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 days'),

  -- Bob: older outbid notification (read)
  ('0c000004-0001-0001-0001-000000000001', 'b2222222-2222-2222-2222-222222222222', '22222222-bbbb-bbbb-bbbb-222222222222',
   'outbid', 'You''ve been outbid on Luca 2',
   'Someone bid $7 on Luca 2. You have 24 hours to counter.',
   '{"bid_id": "0b000004-0001-0001-0001-000000000001", "tmdb_id": 508943}'::jsonb,
   NOW() - INTERVAL '2 days', NOW() - INTERVAL '4 days');

-- ============================================================
-- SUMMARY: 6 users, 4 leagues, 10 participants, 10 teams,
--          30 movies, 37 picks, 45 reviews, 5 scores, 4 invites,
--          3 team_budgets, 6 bids, 1 pickup, 4 notifications
-- ============================================================
