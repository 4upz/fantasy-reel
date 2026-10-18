-- In-app notification types for the moments that used to reach only Discord,
-- so they can show in the inbox and be pushed to the iOS app (O-01):
--
--   draft_turn           it's your pick (draft or counterpick round)
--   movie_scored         a movie your team holds or counterpicked got its
--                        Rotten Tomatoes score, moved, or its score now counts
--   movie_released       a movie your team holds or counterpicked is out today
--   league_movie_scored  another team's movie in your league got its score
--
-- Added on their own because a new enum value can't be used in the
-- transaction that adds it; 20261018120100_push_notifications.sql uses them.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'draft_turn';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'movie_scored';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'movie_released';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'league_movie_scored';
