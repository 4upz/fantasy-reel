-- Add shareable join link columns to leagues table
-- join_code: 6-character alphanumeric code for manual entry
-- join_token: UUID for URL-based joining

ALTER TABLE leagues ADD COLUMN join_code VARCHAR(8) UNIQUE;
ALTER TABLE leagues ADD COLUMN join_token UUID UNIQUE;

-- Index for fast lookups
CREATE INDEX idx_leagues_join_code ON leagues(join_code) WHERE join_code IS NOT NULL;
CREATE INDEX idx_leagues_join_token ON leagues(join_token) WHERE join_token IS NOT NULL;

-- RLS: Only league owners can see join_code/join_token
-- Note: These columns are already covered by the existing leagues SELECT policy
-- which allows owners and participants to view league data.
-- However, we want ONLY owners to see join codes, so we need a helper function.

-- Helper function to check if user is league owner (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION is_league_owner_for_join_code(league_row leagues)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT league_row.owner_id = (SELECT auth.uid())
$$;

COMMENT ON COLUMN leagues.join_code IS 'Shareable 6-char code for joining league. Only visible to owner.';
COMMENT ON COLUMN leagues.join_token IS 'UUID token for shareable join URL. Only visible to owner.';
