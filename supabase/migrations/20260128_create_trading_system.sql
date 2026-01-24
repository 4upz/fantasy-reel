-- ============================================================================
-- Trading System
--
-- Enables teams to trade movies (draft picks + pickups) and FAAB budget
-- with each other. Supports counter-offers and commissioner veto.
-- ============================================================================

-- ============================================================================
-- PART 1: Trade Status Enum
-- ============================================================================

CREATE TYPE trade_status AS ENUM (
  'proposed',      -- Initial offer from initiator
  'countered',     -- Recipient modified and sent back
  'accepted',      -- Both parties agreed, entering review
  'review',        -- Under commissioner review (veto window)
  'completed',     -- Trade executed
  'rejected',      -- Recipient declined
  'cancelled',     -- Initiator cancelled
  'vetoed',        -- Commissioner vetoed
  'expired'        -- Trade deadline passed
);

-- ============================================================================
-- PART 2: Trade Offers Table
-- ============================================================================

CREATE TABLE trade_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  -- Parties involved
  initiator_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  recipient_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

  -- Items being traded (JSONB for flexibility)
  -- Format: { movies: [{ movie_id, source: 'draft_pick'|'pickup', source_id }], faab: 0 }
  initiator_items JSONB NOT NULL DEFAULT '{"movies": [], "faab": 0}'::jsonb,
  recipient_items JSONB NOT NULL DEFAULT '{"movies": [], "faab": 0}'::jsonb,

  -- Trade state
  status trade_status NOT NULL DEFAULT 'proposed',

  -- Timestamps
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,        -- When recipient responded (accept/reject/counter)
  accepted_at TIMESTAMPTZ,         -- When both parties agreed
  review_ends_at TIMESTAMPTZ,      -- Veto window expiration
  completed_at TIMESTAMPTZ,        -- When trade was executed

  -- Metadata
  initiator_message TEXT,          -- Optional message with offer
  response_message TEXT,           -- Message with counter/rejection
  veto_reason TEXT,                -- Why commissioner vetoed

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT check_different_teams CHECK (initiator_team_id != recipient_team_id),
  CONSTRAINT check_has_items CHECK (
    (initiator_items->>'faab')::INTEGER > 0 OR
    jsonb_array_length(COALESCE(initiator_items->'movies', '[]'::jsonb)) > 0 OR
    (recipient_items->>'faab')::INTEGER > 0 OR
    jsonb_array_length(COALESCE(recipient_items->'movies', '[]'::jsonb)) > 0
  ),
  CONSTRAINT check_faab_non_negative CHECK (
    (initiator_items->>'faab')::INTEGER >= 0 AND
    (recipient_items->>'faab')::INTEGER >= 0
  )
);

-- ============================================================================
-- PART 3: Trade Assets Table (Execution Record)
-- ============================================================================

CREATE TABLE trade_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_offer_id UUID NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,

  -- Transfer details
  from_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  to_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

  -- Asset references (exactly one should be set)
  movie_id UUID REFERENCES movies(id) ON DELETE CASCADE,
  draft_pick_id UUID REFERENCES draft_picks(id) ON DELETE CASCADE,
  pickup_id UUID REFERENCES pickups(id) ON DELETE CASCADE,
  faab_amount INTEGER CHECK (faab_amount IS NULL OR faab_amount > 0),

  -- Execution tracking
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactly one asset type per row
  CONSTRAINT check_exactly_one_asset CHECK (
    (
      (movie_id IS NOT NULL)::INTEGER +
      (draft_pick_id IS NOT NULL)::INTEGER +
      (pickup_id IS NOT NULL)::INTEGER +
      (faab_amount IS NOT NULL)::INTEGER
    ) = 1
  )
);

-- ============================================================================
-- PART 4: League Trading Configuration
-- ============================================================================

-- Add trading config columns to leagues table
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS trades_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS trade_deadline DATE;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS trade_veto_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS trade_review_enabled BOOLEAN NOT NULL DEFAULT true;

-- Add constraint for veto hours
ALTER TABLE leagues ADD CONSTRAINT check_trade_veto_hours
  CHECK (trade_veto_hours >= 0 AND trade_veto_hours <= 168);

-- ============================================================================
-- PART 5: Add Trade Notification Types
-- ============================================================================

-- Add new notification types for trading
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_proposed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_countered';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_accepted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_completed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_rejected';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_cancelled';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_vetoed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_review';

-- ============================================================================
-- PART 6: Indexes
-- ============================================================================

-- Trade offers indexes
CREATE INDEX idx_trade_offers_league ON trade_offers(league_id);
CREATE INDEX idx_trade_offers_initiator ON trade_offers(initiator_team_id);
CREATE INDEX idx_trade_offers_recipient ON trade_offers(recipient_team_id);
CREATE INDEX idx_trade_offers_status ON trade_offers(status);

-- Active/pending trades (for UI queries)
CREATE INDEX idx_trade_offers_pending ON trade_offers(league_id, status)
  WHERE status IN ('proposed', 'countered');

-- Review window expiration (for cron job)
CREATE INDEX idx_trade_offers_review_ends ON trade_offers(review_ends_at)
  WHERE status = 'review';

-- Trade assets indexes
CREATE INDEX idx_trade_assets_trade ON trade_assets(trade_offer_id);
CREATE INDEX idx_trade_assets_from_team ON trade_assets(from_team_id);
CREATE INDEX idx_trade_assets_to_team ON trade_assets(to_team_id);

-- ============================================================================
-- PART 7: Enable Realtime
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE trade_offers;
ALTER PUBLICATION supabase_realtime ADD TABLE trade_assets;

-- ============================================================================
-- PART 8: RLS Policies
-- ============================================================================

ALTER TABLE trade_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_assets ENABLE ROW LEVEL SECURITY;

-- trade_offers: League members can view all trades in their leagues
CREATE POLICY "Users can view trades in their leagues" ON trade_offers
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

-- trade_offers: Team owners can create trades for their team
CREATE POLICY "Users can create trades for their team" ON trade_offers
  FOR INSERT TO authenticated
  WITH CHECK (is_team_owner(initiator_team_id));

-- trade_offers: Involved teams can update pending trades
CREATE POLICY "Involved teams can update pending trades" ON trade_offers
  FOR UPDATE TO authenticated
  USING (
    status IN ('proposed', 'countered') AND
    (is_team_owner(initiator_team_id) OR is_team_owner(recipient_team_id))
  );

-- trade_offers: League owners can update trades in review (for veto)
CREATE POLICY "League owners can veto trades" ON trade_offers
  FOR UPDATE TO authenticated
  USING (
    status = 'review' AND
    is_league_owner(league_id)
  );

-- trade_offers: Service role can manage all trades (for execution)
CREATE POLICY "Service role can manage trades" ON trade_offers
  FOR ALL
  USING (auth.role() = 'service_role');

-- trade_assets: League members can view trade execution records
CREATE POLICY "Users can view trade assets in their leagues" ON trade_assets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM trade_offers t
      WHERE t.id = trade_assets.trade_offer_id
        AND is_league_member(t.league_id)
    )
  );

-- trade_assets: Service role can insert (trade execution)
CREATE POLICY "Service role can manage trade assets" ON trade_assets
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- PART 9: Helper Functions
-- ============================================================================

-- Check if a team is involved in a trade
CREATE OR REPLACE FUNCTION is_trade_participant(check_trade_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trade_offers t
    WHERE t.id = check_trade_id
      AND (is_team_owner(t.initiator_team_id) OR is_team_owner(t.recipient_team_id))
  )
$$;

-- Get team's league_id from team_id
CREATE OR REPLACE FUNCTION get_team_league_id(p_team_id UUID)
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT lp.league_id
  FROM teams t
  JOIN league_participants lp ON lp.id = t.participant_id
  WHERE t.id = p_team_id
$$;

-- Get count of team's active (non-dropped) movies
CREATE OR REPLACE FUNCTION get_team_movie_count(p_team_id UUID)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT (
    (SELECT COUNT(*) FROM draft_picks WHERE team_id = p_team_id AND dropped_at IS NULL) +
    (SELECT COUNT(*) FROM pickups WHERE team_id = p_team_id AND dropped_at IS NULL)
  )::INTEGER
$$;

-- Validate trade items (movies owned, FAAB available)
-- Returns NULL if valid, error message if invalid
CREATE OR REPLACE FUNCTION validate_trade_items(
  p_team_id UUID,
  p_items JSONB
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_movie RECORD;
  v_faab INTEGER;
  v_budget INTEGER;
BEGIN
  -- Check FAAB amount
  v_faab := COALESCE((p_items->>'faab')::INTEGER, 0);
  IF v_faab > 0 THEN
    SELECT remaining_budget INTO v_budget
    FROM team_budgets
    WHERE team_id = p_team_id;

    IF v_budget IS NULL OR v_faab > v_budget THEN
      RETURN 'Insufficient FAAB budget';
    END IF;
  END IF;

  -- Check each movie
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(p_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      -- Verify draft pick ownership
      IF NOT EXISTS (
        SELECT 1 FROM draft_picks
        WHERE id = (v_movie.value->>'source_id')::UUID
          AND team_id = p_team_id
          AND dropped_at IS NULL
      ) THEN
        RETURN 'Draft pick not owned or already dropped: ' || (v_movie.value->>'source_id');
      END IF;
    ELSIF (v_movie.value->>'source') = 'pickup' THEN
      -- Verify pickup ownership
      IF NOT EXISTS (
        SELECT 1 FROM pickups
        WHERE id = (v_movie.value->>'source_id')::UUID
          AND team_id = p_team_id
          AND dropped_at IS NULL
      ) THEN
        RETURN 'Pickup not owned or already dropped: ' || (v_movie.value->>'source_id');
      END IF;
    ELSE
      RETURN 'Invalid movie source: ' || COALESCE(v_movie.value->>'source', 'null');
    END IF;
  END LOOP;

  RETURN NULL; -- Valid
END;
$$;

-- Execute trade transaction (atomic)
CREATE OR REPLACE FUNCTION execute_trade(p_trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
  v_movie RECORD;
  v_initiator_faab INTEGER;
  v_recipient_faab INTEGER;
  v_error TEXT;
  v_assets JSONB := '[]'::jsonb;
BEGIN
  -- Lock and fetch the trade
  SELECT * INTO v_trade
  FROM trade_offers
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Trade not found');
  END IF;

  IF v_trade.status NOT IN ('accepted', 'review') THEN
    RETURN jsonb_build_object('error', 'Trade not in executable state');
  END IF;

  -- Re-validate initiator items
  v_error := validate_trade_items(v_trade.initiator_team_id, v_trade.initiator_items);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Initiator validation failed: ' || v_error);
  END IF;

  -- Re-validate recipient items
  v_error := validate_trade_items(v_trade.recipient_team_id, v_trade.recipient_items);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Recipient validation failed: ' || v_error);
  END IF;

  -- Transfer initiator's movies to recipient
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.initiator_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      UPDATE draft_picks
      SET team_id = v_trade.recipient_team_id, updated_at = now()
      WHERE id = (v_movie.value->>'source_id')::UUID;

      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, movie_id, draft_pick_id)
      VALUES (
        p_trade_id,
        v_trade.initiator_team_id,
        v_trade.recipient_team_id,
        (v_movie.value->>'movie_id')::UUID,
        (v_movie.value->>'source_id')::UUID
      );
    ELSIF (v_movie.value->>'source') = 'pickup' THEN
      UPDATE pickups
      SET team_id = v_trade.recipient_team_id
      WHERE id = (v_movie.value->>'source_id')::UUID;

      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, movie_id, pickup_id)
      VALUES (
        p_trade_id,
        v_trade.initiator_team_id,
        v_trade.recipient_team_id,
        (v_movie.value->>'movie_id')::UUID,
        (v_movie.value->>'source_id')::UUID
      );
    END IF;
  END LOOP;

  -- Transfer recipient's movies to initiator
  FOR v_movie IN SELECT * FROM jsonb_array_elements(COALESCE(v_trade.recipient_items->'movies', '[]'::jsonb)) LOOP
    IF (v_movie.value->>'source') = 'draft_pick' THEN
      UPDATE draft_picks
      SET team_id = v_trade.initiator_team_id, updated_at = now()
      WHERE id = (v_movie.value->>'source_id')::UUID;

      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, movie_id, draft_pick_id)
      VALUES (
        p_trade_id,
        v_trade.recipient_team_id,
        v_trade.initiator_team_id,
        (v_movie.value->>'movie_id')::UUID,
        (v_movie.value->>'source_id')::UUID
      );
    ELSIF (v_movie.value->>'source') = 'pickup' THEN
      UPDATE pickups
      SET team_id = v_trade.initiator_team_id
      WHERE id = (v_movie.value->>'source_id')::UUID;

      INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, movie_id, pickup_id)
      VALUES (
        p_trade_id,
        v_trade.recipient_team_id,
        v_trade.initiator_team_id,
        (v_movie.value->>'movie_id')::UUID,
        (v_movie.value->>'source_id')::UUID
      );
    END IF;
  END LOOP;

  -- Transfer FAAB
  v_initiator_faab := COALESCE((v_trade.initiator_items->>'faab')::INTEGER, 0);
  v_recipient_faab := COALESCE((v_trade.recipient_items->>'faab')::INTEGER, 0);

  IF v_initiator_faab > 0 THEN
    -- Initiator gives FAAB to recipient
    UPDATE team_budgets
    SET remaining_budget = remaining_budget - v_initiator_faab,
        total_spent = total_spent + v_initiator_faab,
        updated_at = now()
    WHERE team_id = v_trade.initiator_team_id;

    UPDATE team_budgets
    SET remaining_budget = remaining_budget + v_initiator_faab,
        updated_at = now()
    WHERE team_id = v_trade.recipient_team_id;

    INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, faab_amount)
    VALUES (p_trade_id, v_trade.initiator_team_id, v_trade.recipient_team_id, v_initiator_faab);
  END IF;

  IF v_recipient_faab > 0 THEN
    -- Recipient gives FAAB to initiator
    UPDATE team_budgets
    SET remaining_budget = remaining_budget - v_recipient_faab,
        total_spent = total_spent + v_recipient_faab,
        updated_at = now()
    WHERE team_id = v_trade.recipient_team_id;

    UPDATE team_budgets
    SET remaining_budget = remaining_budget + v_recipient_faab,
        updated_at = now()
    WHERE team_id = v_trade.initiator_team_id;

    INSERT INTO trade_assets (trade_offer_id, from_team_id, to_team_id, faab_amount)
    VALUES (p_trade_id, v_trade.recipient_team_id, v_trade.initiator_team_id, v_recipient_faab);
  END IF;

  -- Mark trade as completed
  UPDATE trade_offers
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = p_trade_id;

  -- Get trade assets for response
  SELECT jsonb_agg(row_to_json(ta))
  INTO v_assets
  FROM trade_assets ta
  WHERE ta.trade_offer_id = p_trade_id;

  RETURN jsonb_build_object('success', true, 'assets', v_assets);
END;
$$;

-- ============================================================================
-- PART 10: Updated At Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_trade_offers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trade_offers_updated_at
  BEFORE UPDATE ON trade_offers
  FOR EACH ROW
  EXECUTE FUNCTION update_trade_offers_updated_at();

-- ============================================================================
-- PART 11: Comments
-- ============================================================================

COMMENT ON TABLE trade_offers IS 'Stores trade proposals between teams';
COMMENT ON TABLE trade_assets IS 'Audit trail of assets transferred in completed trades';
COMMENT ON COLUMN trade_offers.initiator_items IS 'JSONB: {movies: [{movie_id, source, source_id}], faab: number}';
COMMENT ON COLUMN trade_offers.recipient_items IS 'JSONB: {movies: [{movie_id, source, source_id}], faab: number}';
COMMENT ON COLUMN leagues.trade_deadline IS 'Last date trades can be proposed (null = end of year)';
COMMENT ON COLUMN leagues.trade_veto_hours IS 'Hours commissioner has to veto after acceptance';
COMMENT ON COLUMN leagues.trade_review_enabled IS 'Whether trades go through commissioner review';
