-- ============================================================================
-- Pickup Bids Table
-- ============================================================================
CREATE TYPE bid_status AS ENUM ('active', 'outbid', 'won', 'lost', 'cancelled');

CREATE TABLE pickup_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  movie_data JSONB,
  amount INTEGER NOT NULL DEFAULT 0,
  status bid_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  countered_at TIMESTAMPTZ,
  response_deadline TIMESTAMPTZ,
  processing_deadline TIMESTAMPTZ NOT NULL,
  CONSTRAINT check_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT check_amount_max CHECK (amount <= 100)
);

-- Indexes for common queries
CREATE INDEX idx_pickup_bids_league_id ON pickup_bids(league_id);
CREATE INDEX idx_pickup_bids_team_id ON pickup_bids(team_id);
CREATE INDEX idx_pickup_bids_tmdb_id ON pickup_bids(tmdb_id);
CREATE INDEX idx_pickup_bids_status ON pickup_bids(status);
CREATE INDEX idx_pickup_bids_processing_deadline ON pickup_bids(processing_deadline);
CREATE INDEX idx_pickup_bids_response_deadline ON pickup_bids(response_deadline);

-- ============================================================================
-- Team Budgets Table
-- ============================================================================
CREATE TABLE team_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  remaining_budget INTEGER NOT NULL DEFAULT 100,
  total_spent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_remaining_non_negative CHECK (remaining_budget >= 0),
  CONSTRAINT check_spent_non_negative CHECK (total_spent >= 0)
);

-- ============================================================================
-- Pickups Table (movies acquired via bidding)
-- ============================================================================
CREATE TABLE pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  bid_id UUID NOT NULL REFERENCES pickup_bids(id) ON DELETE CASCADE,
  amount_paid INTEGER NOT NULL,
  picked_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dropped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_amount_paid_non_negative CHECK (amount_paid >= 0)
);

-- Unique constraint: each movie can only be owned once per league (unless dropped)
CREATE UNIQUE INDEX idx_pickups_league_movie_active
  ON pickups(league_id, movie_id)
  WHERE dropped_at IS NULL;

CREATE INDEX idx_pickups_team_id ON pickups(team_id);
CREATE INDEX idx_pickups_league_id ON pickups(league_id);

-- ============================================================================
-- Team Drops Table (tracking drop usage)
-- ============================================================================
CREATE TABLE team_drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  pickup_id UUID NOT NULL REFERENCES pickups(id) ON DELETE CASCADE,
  dropped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_drops_team_id ON team_drops(team_id);

-- ============================================================================
-- Notifications Table
-- ============================================================================
CREATE TYPE notification_type AS ENUM ('outbid', 'bid_won', 'bid_lost', 'pickup_available');

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

-- ============================================================================
-- Enable Realtime for new tables
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE pickup_bids;
ALTER PUBLICATION supabase_realtime ADD TABLE pickups;
ALTER PUBLICATION supabase_realtime ADD TABLE team_budgets;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- pickup_bids: users can see bids in their leagues
ALTER TABLE pickup_bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view bids in their leagues"
  ON pickup_bids FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_participants lp
      WHERE lp.league_id = pickup_bids.league_id
      AND lp.user_id = auth.uid()
      AND lp.status = 'active'
    )
  );

CREATE POLICY "Users can insert bids for their team"
  ON pickup_bids FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = pickup_bids.team_id
      AND lp.user_id = auth.uid()
      AND lp.status = 'active'
    )
  );

CREATE POLICY "Users can update their own bids"
  ON pickup_bids FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = pickup_bids.team_id
      AND lp.user_id = auth.uid()
      AND lp.status = 'active'
    )
  );

-- Service role can manage all bids (for processing)
CREATE POLICY "Service role can manage bids"
  ON pickup_bids FOR ALL
  USING (auth.role() = 'service_role');

-- team_budgets: users can see budgets in their leagues
ALTER TABLE team_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view budgets in their leagues"
  ON team_budgets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = team_budgets.team_id
      AND EXISTS (
        SELECT 1 FROM league_participants lp2
        WHERE lp2.league_id = lp.league_id
        AND lp2.user_id = auth.uid()
        AND lp2.status = 'active'
      )
    )
  );

-- Service role can manage budgets
CREATE POLICY "Service role can manage budgets"
  ON team_budgets FOR ALL
  USING (auth.role() = 'service_role');

-- pickups: users can see pickups in their leagues
ALTER TABLE pickups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pickups in their leagues"
  ON pickups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_participants lp
      WHERE lp.league_id = pickups.league_id
      AND lp.user_id = auth.uid()
      AND lp.status = 'active'
    )
  );

-- Service role can manage pickups
CREATE POLICY "Service role can manage pickups"
  ON pickups FOR ALL
  USING (auth.role() = 'service_role');

-- team_drops: users can see drops in their leagues
ALTER TABLE team_drops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view drops in their leagues"
  ON team_drops FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN league_participants lp ON lp.id = t.participant_id
      WHERE t.id = team_drops.team_id
      AND EXISTS (
        SELECT 1 FROM league_participants lp2
        WHERE lp2.league_id = lp.league_id
        AND lp2.user_id = auth.uid()
        AND lp2.status = 'active'
      )
    )
  );

-- Service role can manage drops
CREATE POLICY "Service role can manage drops"
  ON team_drops FOR ALL
  USING (auth.role() = 'service_role');

-- notifications: users can only see their own
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

-- Service role can manage all notifications
CREATE POLICY "Service role can manage notifications"
  ON notifications FOR ALL
  USING (auth.role() = 'service_role');
