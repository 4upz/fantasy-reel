-- Add bidding configuration fields to leagues table
ALTER TABLE leagues
ADD COLUMN total_slots INTEGER NOT NULL DEFAULT 8,
ADD COLUMN draft_slots INTEGER NOT NULL DEFAULT 5,
ADD COLUMN drop_limit INTEGER NOT NULL DEFAULT 2,
ADD COLUMN counterbid_hours INTEGER NOT NULL DEFAULT 24;

-- Add constraints
ALTER TABLE leagues
ADD CONSTRAINT check_draft_slots_positive CHECK (draft_slots >= 1),
ADD CONSTRAINT check_draft_slots_lte_total CHECK (draft_slots <= total_slots),
ADD CONSTRAINT check_total_slots_bounds CHECK (total_slots >= 1 AND total_slots <= 20),
ADD CONSTRAINT check_counterbid_hours_positive CHECK (counterbid_hours >= 1);

-- Comment the columns
COMMENT ON COLUMN leagues.total_slots IS 'Total movies per team (draft + pickup)';
COMMENT ON COLUMN leagues.draft_slots IS 'Movies that must be drafted (also = draft rounds)';
COMMENT ON COLUMN leagues.drop_limit IS 'Max drops allowed per team per season';
COMMENT ON COLUMN leagues.counterbid_hours IS 'Hours given to counter when outbid';
