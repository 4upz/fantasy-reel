-- ============================================================================
-- Season notification types
--
-- In-app notification kinds for the season lifecycle: one when a season is
-- completed (final standings, champion named) and one when the next season
-- opens for the same series.
--
-- Its own migration file on purpose: ALTER TYPE ... ADD VALUE cannot be used
-- in the same transaction that first references the new value, and each
-- migration runs in one transaction. Anything that inserts a
-- `season_completed` / `season_started` notification therefore has to land in
-- a later migration (or, as here, in application code).
-- ============================================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'season_completed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'season_started';
