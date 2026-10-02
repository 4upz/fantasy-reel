-- The score last posted to Discord for each movie. Score notifications post a
-- movie again only once it is SCORE_CHANGE_THRESHOLD away from this
-- (_shared/score-notifications.ts). Measuring each run against the run before
-- would never post a slow drift: a Tomatometer losing a point a day stays under
-- the bar every single run.

ALTER TABLE movies
  ADD COLUMN announced_fantasy_points DECIMAL(6, 2),
  ADD COLUMN announced_rt_score DECIMAL(5, 2);

COMMENT ON COLUMN movies.announced_fantasy_points IS
  'fantasy_points as of the last Discord score post; NULL until the first score is posted.';

COMMENT ON COLUMN movies.announced_rt_score IS
  'combined_score (Tomatometer) as of the last Discord score post; NULL until the first score is posted.';

-- Until now every visible change was posted, so a movie's current score is the
-- one last posted. Left NULL, every scored movie would be re-announced as new.
UPDATE movies
SET announced_fantasy_points = fantasy_points,
    announced_rt_score = combined_score
WHERE fantasy_points IS NOT NULL;
