# Bidding System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a FAAB-style bidding system for acquiring movies during the season, with configurable draft/pickup slots and guaranteed counter-bid windows.

**Architecture:** Database-first approach. New tables for bids, budgets, pickups, drops, and notifications. Edge Functions handle bid placement and processing. Cron jobs for weekly batch processing and hourly extended-window checks. Frontend components for bidding UI and roster management.

**Tech Stack:** Supabase (PostgreSQL, Edge Functions, Realtime), Deno, Next.js 15, React 19, Tailwind CSS 4, Resend (emails)

---

## Task 1: Database Migration - League Configuration Fields

**Files:**
- Create: `supabase/migrations/20260120_add_bidding_config.sql`

**Step 1: Write the migration**

```sql
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
```

**Step 2: Apply migration**

Run: `npx supabase migration up`

Expected: Migration applies successfully

**Step 3: Verify in Supabase Studio**

Run: `open http://127.0.0.1:54323` (or check via psql)

Verify: `leagues` table has new columns with defaults

**Step 4: Commit**

```bash
git add supabase/migrations/20260120_add_bidding_config.sql
git commit -m "feat(db): add bidding configuration fields to leagues table"
```

---

## Task 2: Database Migration - Bidding Tables

**Files:**
- Create: `supabase/migrations/20260121_create_bidding_tables.sql`

**Step 1: Write the migration**

```sql
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

-- notifications: users can only see their own
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());
```

**Step 2: Apply migration**

Run: `npx supabase migration up`

Expected: Tables created successfully

**Step 3: Verify tables exist**

Run: `npx supabase db diff`

Expected: No diff (schema matches migrations)

**Step 4: Commit**

```bash
git add supabase/migrations/20260121_create_bidding_tables.sql
git commit -m "feat(db): create bidding tables (pickup_bids, team_budgets, pickups, team_drops, notifications)"
```

---

## Task 3: Database Migration - Helper Functions

**Files:**
- Create: `supabase/migrations/20260122_bidding_helper_functions.sql`

**Step 1: Write the migration**

```sql
-- ============================================================================
-- Get next Saturday 8pm UTC (weekly processing deadline)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_next_processing_deadline()
RETURNS TIMESTAMPTZ AS $$
DECLARE
  now_utc TIMESTAMPTZ := now() AT TIME ZONE 'UTC';
  next_saturday TIMESTAMPTZ;
  days_until_saturday INTEGER;
BEGIN
  -- Calculate days until next Saturday (6 = Saturday in PostgreSQL)
  days_until_saturday := (6 - EXTRACT(DOW FROM now_utc)::INTEGER + 7) % 7;

  -- If it's Saturday but before 8pm, use today
  IF days_until_saturday = 0 AND EXTRACT(HOUR FROM now_utc) < 20 THEN
    next_saturday := date_trunc('day', now_utc) + INTERVAL '20 hours';
  ELSE
    -- If it's Saturday after 8pm, go to next Saturday
    IF days_until_saturday = 0 THEN
      days_until_saturday := 7;
    END IF;
    next_saturday := date_trunc('day', now_utc) + (days_until_saturday || ' days')::INTERVAL + INTERVAL '20 hours';
  END IF;

  RETURN next_saturday;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Get team's active pickup count (non-dropped pickups)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_team_pickup_count(p_team_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM pickups
    WHERE team_id = p_team_id
    AND dropped_at IS NULL
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Get team's drop count
-- ============================================================================
CREATE OR REPLACE FUNCTION get_team_drop_count(p_team_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM team_drops
    WHERE team_id = p_team_id
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Check if movie is eligible for pickup (not released, not scored, not owned)
-- ============================================================================
CREATE OR REPLACE FUNCTION is_movie_eligible_for_pickup(
  p_league_id UUID,
  p_tmdb_id INTEGER,
  p_movie_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_movie RECORD;
  v_is_owned BOOLEAN;
BEGIN
  -- If we have a movie_id, check the DB record
  IF p_movie_id IS NOT NULL THEN
    SELECT * INTO v_movie FROM movies WHERE id = p_movie_id;

    -- Movie must exist
    IF NOT FOUND THEN
      RETURN FALSE;
    END IF;

    -- Movie must not be released yet (or released but no scores)
    IF v_movie.release_date IS NOT NULL AND v_movie.release_date < CURRENT_DATE THEN
      -- Check if it has scores
      IF v_movie.combined_score IS NOT NULL THEN
        RETURN FALSE;
      END IF;
    END IF;
  END IF;

  -- Check if movie is already owned in this league (via draft or pickup)
  SELECT EXISTS (
    SELECT 1 FROM draft_picks dp
    JOIN movies m ON m.id = dp.movie_id
    WHERE dp.league_id = p_league_id AND m.tmdb_id = p_tmdb_id
    UNION
    SELECT 1 FROM pickups p
    JOIN movies m ON m.id = p.movie_id
    WHERE p.league_id = p_league_id AND m.tmdb_id = p_tmdb_id AND p.dropped_at IS NULL
  ) INTO v_is_owned;

  RETURN NOT v_is_owned;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Update calculate_team_score to include pickups
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE (
  total_points DECIMAL(10, 2),
  movies_scored INTEGER,
  movies_pending INTEGER,
  average_score DECIMAL(5, 2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(m.combined_score), 0)::DECIMAL(10, 2) AS total_points,
    COUNT(m.combined_score)::INTEGER AS movies_scored,
    COUNT(*) FILTER (WHERE m.combined_score IS NULL)::INTEGER AS movies_pending,
    COALESCE(AVG(m.combined_score), 0)::DECIMAL(5, 2) AS average_score
  FROM (
    -- Draft picks
    SELECT dp.movie_id
    FROM draft_picks dp
    WHERE dp.team_id = p_team_id
    UNION ALL
    -- Active pickups (not dropped)
    SELECT pk.movie_id
    FROM pickups pk
    WHERE pk.team_id = p_team_id AND pk.dropped_at IS NULL
  ) AS team_movies
  JOIN movies m ON m.id = team_movies.movie_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Initialize team budget (called when league becomes active)
-- ============================================================================
CREATE OR REPLACE FUNCTION initialize_team_budgets(p_league_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO team_budgets (team_id, remaining_budget, total_spent)
  SELECT t.id, 100, 0
  FROM teams t
  JOIN league_participants lp ON lp.id = t.participant_id
  WHERE lp.league_id = p_league_id
  ON CONFLICT (team_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
```

**Step 2: Apply migration**

Run: `npx supabase migration up`

Expected: Functions created successfully

**Step 3: Test the functions**

Run in Supabase Studio SQL editor:
```sql
SELECT get_next_processing_deadline();
```

Expected: Returns next Saturday 8pm UTC

**Step 4: Commit**

```bash
git add supabase/migrations/20260122_bidding_helper_functions.sql
git commit -m "feat(db): add bidding helper functions"
```

---

## Task 4: Update get_next_draft_pick to Use draft_slots

**Files:**
- Modify: `supabase/migrations/20260123_update_draft_pick_function.sql`

**Step 1: Write the migration**

```sql
-- Update get_next_draft_pick to use league.draft_slots instead of hardcoded 5
CREATE OR REPLACE FUNCTION get_next_draft_pick(p_league_id UUID)
RETURNS TABLE (
  round INTEGER,
  pick_number INTEGER,
  team_id UUID,
  participant_id UUID,
  user_id UUID
) AS $$
DECLARE
  v_participant_count INTEGER;
  v_picks_made INTEGER;
  v_total_rounds INTEGER;
  v_next_round INTEGER;
  v_next_pick INTEGER;
  v_draft_order INTEGER;
BEGIN
  -- Get participant count
  SELECT COUNT(*) INTO v_participant_count
  FROM league_participants
  WHERE league_id = p_league_id AND status = 'active';

  IF v_participant_count = 0 THEN
    RETURN;
  END IF;

  -- Get total rounds from league config (draft_slots)
  SELECT l.draft_slots INTO v_total_rounds
  FROM leagues l
  WHERE l.id = p_league_id;

  -- Get picks made so far
  SELECT COUNT(*) INTO v_picks_made
  FROM draft_picks
  WHERE league_id = p_league_id;

  -- Calculate next round and pick
  v_next_round := (v_picks_made / v_participant_count) + 1;
  v_next_pick := (v_picks_made % v_participant_count) + 1;

  -- Check if draft is complete
  IF v_next_round > v_total_rounds THEN
    RETURN;
  END IF;

  -- Snake draft: odd rounds go 1,2,3... even rounds go 3,2,1...
  IF v_next_round % 2 = 1 THEN
    v_draft_order := v_next_pick;
  ELSE
    v_draft_order := v_participant_count - v_next_pick + 1;
  END IF;

  -- Return the team whose turn it is
  RETURN QUERY
  SELECT
    v_next_round AS round,
    v_next_pick AS pick_number,
    t.id AS team_id,
    lp.id AS participant_id,
    lp.user_id
  FROM league_participants lp
  JOIN teams t ON t.participant_id = lp.id
  WHERE lp.league_id = p_league_id
    AND lp.status = 'active'
    AND lp.draft_order = v_draft_order;
END;
$$ LANGUAGE plpgsql;
```

**Step 2: Apply migration**

Run: `npx supabase migration up`

Expected: Function updated successfully

**Step 3: Commit**

```bash
git add supabase/migrations/20260123_update_draft_pick_function.sql
git commit -m "feat(db): update get_next_draft_pick to use league.draft_slots"
```

---

## Task 5: Update Frontend Types

**Files:**
- Modify: `apps/frontend/types/index.ts`

**Step 1: Add new types**

Add after the existing types:

```typescript
// Bidding system types

export interface League {
  id: string
  name: string
  owner_id: string
  invite_only: boolean
  status: 'setup' | 'drafting' | 'active' | 'completed'
  max_participants: number
  draft_start_date: string | null
  draft_end_date: string | null
  // New bidding config fields
  total_slots: number
  draft_slots: number
  drop_limit: number
  counterbid_hours: number
  created_at: string
  updated_at: string
}

export type BidStatus = 'active' | 'outbid' | 'won' | 'lost' | 'cancelled'

export interface PickupBid {
  id: string
  league_id: string
  team_id: string
  tmdb_id: number
  movie_data: TMDbSearchResult | null
  amount: number
  status: BidStatus
  created_at: string
  countered_at: string | null
  response_deadline: string | null
  processing_deadline: string
}

export interface TeamBudget {
  id: string
  team_id: string
  remaining_budget: number
  total_spent: number
  created_at: string
  updated_at: string
}

export interface Pickup {
  id: string
  league_id: string
  team_id: string
  movie_id: string
  bid_id: string
  amount_paid: number
  picked_up_at: string
  dropped_at: string | null
  created_at: string
}

export interface TeamDrop {
  id: string
  team_id: string
  movie_id: string
  pickup_id: string
  dropped_at: string
  created_at: string
}

export type NotificationType = 'outbid' | 'bid_won' | 'bid_lost' | 'pickup_available'

export interface Notification {
  id: string
  user_id: string
  league_id: string | null
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

// Extended types for queries
export interface PickupWithMovie extends Pickup {
  movies: Movie
}

export interface PickupBidWithTeam extends PickupBid {
  teams: Team
}

export interface TeamWithBudget extends Team {
  team_budgets: TeamBudget | null
}
```

**Step 2: Update existing League interface**

The League interface above already includes the new fields. Make sure to replace the old one.

**Step 3: Commit**

```bash
git add apps/frontend/types/index.ts
git commit -m "feat(types): add bidding system types"
```

---

## Task 6: Edge Function - place-bid

**Files:**
- Create: `supabase/functions/place-bid/index.ts`

**Step 1: Create the Edge Function**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
} from '../_shared/utils.ts'

interface MovieData {
  title: string
  overview?: string | null
  poster_url: string | null
  release_date: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

interface PlaceBidRequest {
  league_id: string
  tmdb_id: number
  amount: number
  movie_data?: MovieData
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Auth check
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { league_id, tmdb_id, amount, movie_data }: PlaceBidRequest = await req.json()

    // Validate inputs
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!tmdb_id || typeof tmdb_id !== 'number' || tmdb_id <= 0) {
      return errorResponse('Valid tmdb_id is required', 400)
    }

    if (typeof amount !== 'number' || amount < 0 || amount > 100) {
      return errorResponse('Amount must be between 0 and 100', 400)
    }

    // Fetch league
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.status !== 'active') {
      return errorResponse('League is not active', 400)
    }

    // Get user's participant and team
    const { data: participant, error: participantError } = await serviceClient
      .from('league_participants')
      .select('id, teams(id)')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (participantError || !participant) {
      return errorResponse('You are not a member of this league', 403)
    }

    const team = (participant.teams as unknown as { id: string })
    if (!team) {
      return errorResponse('Team not found', 404)
    }

    // Get team's budget
    const { data: budget, error: budgetError } = await serviceClient
      .from('team_budgets')
      .select('*')
      .eq('team_id', team.id)
      .single()

    if (budgetError || !budget) {
      return errorResponse('Team budget not found', 404)
    }

    if (amount > budget.remaining_budget) {
      return errorResponse(`Insufficient budget. You have $${budget.remaining_budget} remaining`, 400)
    }

    // Check if team has pickup slots available
    const pickupSlots = league.total_slots - league.draft_slots
    const { data: pickupCount } = await serviceClient
      .rpc('get_team_pickup_count', { p_team_id: team.id })

    if ((pickupCount ?? 0) >= pickupSlots) {
      return errorResponse('No pickup slots available', 400)
    }

    // Check movie eligibility
    const { data: isEligible } = await serviceClient
      .rpc('is_movie_eligible_for_pickup', {
        p_league_id: league_id,
        p_tmdb_id: tmdb_id,
        p_movie_id: null,
      })

    if (!isEligible) {
      return errorResponse('Movie is not eligible for pickup', 400)
    }

    // Get processing deadline (next Saturday 8pm UTC)
    const { data: processingDeadline } = await serviceClient
      .rpc('get_next_processing_deadline')

    // Check for existing bids on this movie in this league
    const { data: existingBids } = await serviceClient
      .from('pickup_bids')
      .select('*')
      .eq('league_id', league_id)
      .eq('tmdb_id', tmdb_id)
      .eq('status', 'active')
      .order('amount', { ascending: false })
      .limit(1)

    const highestBid = existingBids?.[0]

    // If there's a higher or equal bid, reject
    if (highestBid && highestBid.amount >= amount) {
      return errorResponse(`There is already a bid of $${highestBid.amount}. You must bid higher.`, 400)
    }

    // If this team already has an active bid on this movie, update it
    const { data: existingTeamBid } = await serviceClient
      .from('pickup_bids')
      .select('*')
      .eq('league_id', league_id)
      .eq('team_id', team.id)
      .eq('tmdb_id', tmdb_id)
      .in('status', ['active', 'outbid'])
      .single()

    let newBid

    if (existingTeamBid) {
      // Update existing bid
      const { data: updatedBid, error: updateError } = await serviceClient
        .from('pickup_bids')
        .update({
          amount,
          status: 'active',
          countered_at: null,
          response_deadline: null,
        })
        .eq('id', existingTeamBid.id)
        .select()
        .single()

      if (updateError) {
        return errorResponse('Failed to update bid', 500)
      }
      newBid = updatedBid
    } else {
      // Create new bid
      const { data: insertedBid, error: insertError } = await serviceClient
        .from('pickup_bids')
        .insert({
          league_id,
          team_id: team.id,
          tmdb_id,
          movie_data,
          amount,
          status: 'active',
          processing_deadline: processingDeadline,
        })
        .select()
        .single()

      if (insertError) {
        return errorResponse('Failed to place bid', 500)
      }
      newBid = insertedBid
    }

    // If there was a previous highest bid, mark it as outbid
    if (highestBid && highestBid.team_id !== team.id) {
      const responseDeadline = new Date()
      responseDeadline.setHours(responseDeadline.getHours() + league.counterbid_hours)

      await serviceClient
        .from('pickup_bids')
        .update({
          status: 'outbid',
          countered_at: new Date().toISOString(),
          response_deadline: responseDeadline.toISOString(),
        })
        .eq('id', highestBid.id)

      // Get outbid user's info for notification
      const { data: outbidTeam } = await serviceClient
        .from('teams')
        .select('participant_id, league_participants(user_id)')
        .eq('id', highestBid.team_id)
        .single()

      if (outbidTeam) {
        const outbidUserId = (outbidTeam.league_participants as unknown as { user_id: string })?.user_id
        const movieTitle = movie_data?.title || `Movie #${tmdb_id}`

        // Create notification
        await serviceClient.from('notifications').insert({
          user_id: outbidUserId,
          league_id,
          type: 'outbid',
          title: `You've been outbid on ${movieTitle}`,
          body: `Someone bid $${amount} on ${movieTitle}. You have ${league.counterbid_hours} hours to counter.`,
          data: {
            bid_id: highestBid.id,
            tmdb_id,
            new_amount: amount,
            response_deadline: responseDeadline.toISOString(),
          },
        })

        // TODO: Send email notification via Resend
      }
    }

    return jsonResponse({
      bid: newBid,
      message: highestBid ? 'You are now the highest bidder' : 'Bid placed successfully',
    }, 201)
  } catch (error) {
    console.error('Error placing bid:', error)
    return errorResponse('Internal server error', 500)
  }
})
```

**Step 2: Test the function manually**

Run: `npx supabase functions serve`

Then test with curl (after getting an auth token)

**Step 3: Commit**

```bash
git add supabase/functions/place-bid/index.ts
git commit -m "feat(api): add place-bid Edge Function"
```

---

## Task 7: Edge Function - cancel-bid

**Files:**
- Create: `supabase/functions/cancel-bid/index.ts`

**Step 1: Create the Edge Function**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
} from '../_shared/utils.ts'

interface CancelBidRequest {
  bid_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { bid_id }: CancelBidRequest = await req.json()

    if (!bid_id || !isValidUUID(bid_id)) {
      return errorResponse('Valid bid_id is required', 400)
    }

    // Fetch the bid
    const { data: bid, error: bidError } = await serviceClient
      .from('pickup_bids')
      .select('*, teams(participant_id, league_participants(user_id))')
      .eq('id', bid_id)
      .single()

    if (bidError || !bid) {
      return errorResponse('Bid not found', 404)
    }

    // Check ownership
    const bidUserId = (bid.teams as unknown as {
      league_participants: { user_id: string }
    })?.league_participants?.user_id

    if (bidUserId !== user.id) {
      return errorResponse('You can only cancel your own bids', 403)
    }

    // Can only cancel active bids (not outbid - that means someone else is higher)
    if (bid.status !== 'active') {
      return errorResponse('Can only cancel active bids', 400)
    }

    // Cancel the bid
    const { error: updateError } = await serviceClient
      .from('pickup_bids')
      .update({ status: 'cancelled' })
      .eq('id', bid_id)

    if (updateError) {
      return errorResponse('Failed to cancel bid', 500)
    }

    return jsonResponse({ message: 'Bid cancelled successfully' })
  } catch (error) {
    console.error('Error cancelling bid:', error)
    return errorResponse('Internal server error', 500)
  }
})
```

**Step 2: Commit**

```bash
git add supabase/functions/cancel-bid/index.ts
git commit -m "feat(api): add cancel-bid Edge Function"
```

---

## Task 8: Edge Function - drop-movie

**Files:**
- Create: `supabase/functions/drop-movie/index.ts`

**Step 1: Create the Edge Function**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
} from '../_shared/utils.ts'

interface DropMovieRequest {
  pickup_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { pickup_id }: DropMovieRequest = await req.json()

    if (!pickup_id || !isValidUUID(pickup_id)) {
      return errorResponse('Valid pickup_id is required', 400)
    }

    // Fetch the pickup with movie and team info
    const { data: pickup, error: pickupError } = await serviceClient
      .from('pickups')
      .select(`
        *,
        movies(*),
        teams(
          participant_id,
          league_participants(user_id, league_id, leagues(drop_limit))
        )
      `)
      .eq('id', pickup_id)
      .single()

    if (pickupError || !pickup) {
      return errorResponse('Pickup not found', 404)
    }

    // Check ownership
    const pickupUserId = (pickup.teams as unknown as {
      league_participants: { user_id: string }
    })?.league_participants?.user_id

    if (pickupUserId !== user.id) {
      return errorResponse('You can only drop your own movies', 403)
    }

    // Check if already dropped
    if (pickup.dropped_at) {
      return errorResponse('Movie has already been dropped', 400)
    }

    // Check if movie is released
    const movie = pickup.movies as unknown as { release_date: string | null }
    if (movie.release_date && new Date(movie.release_date) < new Date()) {
      return errorResponse('Cannot drop a movie that has already been released', 400)
    }

    // Check drop limit
    const leagueInfo = (pickup.teams as unknown as {
      league_participants: { league_id: string; leagues: { drop_limit: number } }
    })?.league_participants

    const dropLimit = leagueInfo?.leagues?.drop_limit ?? 2

    const { data: dropCount } = await serviceClient
      .rpc('get_team_drop_count', { p_team_id: pickup.team_id })

    if ((dropCount ?? 0) >= dropLimit) {
      return errorResponse(`You have reached the drop limit of ${dropLimit}`, 400)
    }

    // Mark as dropped
    const { error: updateError } = await serviceClient
      .from('pickups')
      .update({ dropped_at: new Date().toISOString() })
      .eq('id', pickup_id)

    if (updateError) {
      return errorResponse('Failed to drop movie', 500)
    }

    // Record the drop
    const { error: dropError } = await serviceClient.from('team_drops').insert({
      team_id: pickup.team_id,
      movie_id: pickup.movie_id,
      pickup_id: pickup_id,
    })

    if (dropError) {
      console.error('Failed to record drop:', dropError)
      // Don't fail the request, the drop was successful
    }

    // Notify other league members that movie is available
    const { data: leagueParticipants } = await serviceClient
      .from('league_participants')
      .select('user_id')
      .eq('league_id', pickup.league_id)
      .eq('status', 'active')
      .neq('user_id', user.id)

    if (leagueParticipants) {
      const movieInfo = pickup.movies as unknown as { title: string; tmdb_id: number }
      const notifications = leagueParticipants.map((p) => ({
        user_id: p.user_id,
        league_id: pickup.league_id,
        type: 'pickup_available' as const,
        title: `${movieInfo.title} is now available`,
        body: `A team dropped ${movieInfo.title}. It's now available for pickup.`,
        data: { tmdb_id: movieInfo.tmdb_id, movie_id: pickup.movie_id },
      }))

      await serviceClient.from('notifications').insert(notifications)
    }

    return jsonResponse({ message: 'Movie dropped successfully' })
  } catch (error) {
    console.error('Error dropping movie:', error)
    return errorResponse('Internal server error', 500)
  }
})
```

**Step 2: Commit**

```bash
git add supabase/functions/drop-movie/index.ts
git commit -m "feat(api): add drop-movie Edge Function"
```

---

## Task 9: Edge Function - process-bids

**Files:**
- Create: `supabase/functions/process-bids/index.ts`

**Step 1: Create the Edge Function**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest } from '../_shared/utils.ts'

interface ProcessBidsRequest {
  mode: 'weekly' | 'extended'
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // This function should be called by cron, but we'll still validate
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { mode = 'weekly' }: ProcessBidsRequest = await req.json().catch(() => ({ mode: 'weekly' }))

    const now = new Date()
    let bidsToProcess

    if (mode === 'weekly') {
      // Weekly: process all bids where response_deadline has passed or is null
      // and processing_deadline <= now
      const { data, error } = await serviceClient
        .from('pickup_bids')
        .select('*')
        .eq('status', 'active')
        .lte('processing_deadline', now.toISOString())

      if (error) {
        return errorResponse('Failed to fetch bids', 500)
      }
      bidsToProcess = data
    } else {
      // Extended: find bids where response_deadline has passed
      // and the response_deadline was AFTER the processing_deadline
      const { data, error } = await serviceClient
        .from('pickup_bids')
        .select('*')
        .eq('status', 'active')
        .not('response_deadline', 'is', null)
        .lt('response_deadline', now.toISOString())

      if (error) {
        return errorResponse('Failed to fetch extended bids', 500)
      }

      // Filter to only those where response_deadline > processing_deadline
      bidsToProcess = (data || []).filter(
        (bid) => new Date(bid.response_deadline!) > new Date(bid.processing_deadline)
      )
    }

    if (!bidsToProcess || bidsToProcess.length === 0) {
      return jsonResponse({ message: 'No bids to process', processed: 0 })
    }

    // Group bids by movie (tmdb_id + league_id)
    const bidsByMovie = new Map<string, typeof bidsToProcess>()
    for (const bid of bidsToProcess) {
      const key = `${bid.league_id}:${bid.tmdb_id}`
      if (!bidsByMovie.has(key)) {
        bidsByMovie.set(key, [])
      }
      bidsByMovie.get(key)!.push(bid)
    }

    let processedCount = 0
    const results: Array<{ tmdb_id: number; winner_team_id: string; amount: number }> = []

    for (const [key, bids] of bidsByMovie) {
      // Check if all bids for this movie have closed response windows
      const hasOpenWindow = bids.some(
        (bid) => bid.response_deadline && new Date(bid.response_deadline) > now
      )

      if (hasOpenWindow) {
        continue // Skip this movie, someone still has time to counter
      }

      // Also check for outbid entries that might still have open windows
      const [leagueId, tmdbId] = key.split(':')
      const { data: allBidsForMovie } = await serviceClient
        .from('pickup_bids')
        .select('*')
        .eq('league_id', leagueId)
        .eq('tmdb_id', parseInt(tmdbId))
        .in('status', ['active', 'outbid'])

      const anyOpenWindow = (allBidsForMovie || []).some(
        (bid) => bid.response_deadline && new Date(bid.response_deadline) > now
      )

      if (anyOpenWindow) {
        continue
      }

      // Find the winner (highest amount, earliest created_at for ties)
      const activeBids = bids.filter((b) => b.status === 'active')
      if (activeBids.length === 0) continue

      activeBids.sort((a, b) => {
        if (b.amount !== a.amount) return b.amount - a.amount
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })

      const winner = activeBids[0]

      // Create movie if it doesn't exist
      let movieId: string
      const { data: existingMovie } = await serviceClient
        .from('movies')
        .select('id')
        .eq('tmdb_id', winner.tmdb_id)
        .single()

      if (existingMovie) {
        movieId = existingMovie.id
      } else if (winner.movie_data) {
        const { data: newMovie, error: movieError } = await serviceClient
          .from('movies')
          .insert({
            tmdb_id: winner.tmdb_id,
            title: winner.movie_data.title,
            overview: winner.movie_data.overview,
            poster_url: winner.movie_data.poster_url,
            release_date: winner.movie_data.release_date,
            popularity: winner.movie_data.popularity,
            vote_average: winner.movie_data.vote_average,
            status: 'upcoming',
          })
          .select('id')
          .single()

        if (movieError || !newMovie) {
          console.error('Failed to create movie:', movieError)
          continue
        }
        movieId = newMovie.id
      } else {
        console.error('No movie data for bid:', winner.id)
        continue
      }

      // Create pickup record
      const { error: pickupError } = await serviceClient.from('pickups').insert({
        league_id: winner.league_id,
        team_id: winner.team_id,
        movie_id: movieId,
        bid_id: winner.id,
        amount_paid: winner.amount,
      })

      if (pickupError) {
        console.error('Failed to create pickup:', pickupError)
        continue
      }

      // Deduct from budget
      await serviceClient.rpc('deduct_budget', {
        p_team_id: winner.team_id,
        p_amount: winner.amount,
      }).catch(() => {
        // Fallback if RPC doesn't exist
        return serviceClient
          .from('team_budgets')
          .update({
            remaining_budget: serviceClient.rpc('remaining_budget - ' + winner.amount) as unknown as number,
            total_spent: serviceClient.rpc('total_spent + ' + winner.amount) as unknown as number,
          })
          .eq('team_id', winner.team_id)
      })

      // Actually deduct budget with raw SQL approach
      const { data: currentBudget } = await serviceClient
        .from('team_budgets')
        .select('remaining_budget, total_spent')
        .eq('team_id', winner.team_id)
        .single()

      if (currentBudget) {
        await serviceClient
          .from('team_budgets')
          .update({
            remaining_budget: currentBudget.remaining_budget - winner.amount,
            total_spent: currentBudget.total_spent + winner.amount,
          })
          .eq('team_id', winner.team_id)
      }

      // Mark winner as won
      await serviceClient
        .from('pickup_bids')
        .update({ status: 'won' })
        .eq('id', winner.id)

      // Mark others as lost
      const loserIds = (allBidsForMovie || [])
        .filter((b) => b.id !== winner.id)
        .map((b) => b.id)

      if (loserIds.length > 0) {
        await serviceClient
          .from('pickup_bids')
          .update({ status: 'lost' })
          .in('id', loserIds)
      }

      // Send notifications
      const { data: winnerTeam } = await serviceClient
        .from('teams')
        .select('league_participants(user_id)')
        .eq('id', winner.team_id)
        .single()

      const winnerUserId = (winnerTeam?.league_participants as unknown as { user_id: string })?.user_id
      const movieTitle = winner.movie_data?.title || `Movie #${winner.tmdb_id}`

      if (winnerUserId) {
        await serviceClient.from('notifications').insert({
          user_id: winnerUserId,
          league_id: winner.league_id,
          type: 'bid_won',
          title: `You won ${movieTitle}!`,
          body: `Your bid of $${winner.amount} won. ${movieTitle} has been added to your roster.`,
          data: { bid_id: winner.id, tmdb_id: winner.tmdb_id, amount: winner.amount },
        })
      }

      // Notify losers
      for (const loserId of loserIds) {
        const loserBid = (allBidsForMovie || []).find((b) => b.id === loserId)
        if (!loserBid) continue

        const { data: loserTeam } = await serviceClient
          .from('teams')
          .select('league_participants(user_id)')
          .eq('id', loserBid.team_id)
          .single()

        const loserUserId = (loserTeam?.league_participants as unknown as { user_id: string })?.user_id
        if (loserUserId) {
          await serviceClient.from('notifications').insert({
            user_id: loserUserId,
            league_id: loserBid.league_id,
            type: 'bid_lost',
            title: `Bid unsuccessful for ${movieTitle}`,
            body: `Your bid of $${loserBid.amount} was not enough. The winning bid was $${winner.amount}.`,
            data: { bid_id: loserBid.id, tmdb_id: loserBid.tmdb_id },
          })
        }
      }

      results.push({
        tmdb_id: winner.tmdb_id,
        winner_team_id: winner.team_id,
        amount: winner.amount,
      })
      processedCount++
    }

    return jsonResponse({
      message: `Processed ${processedCount} movie(s)`,
      processed: processedCount,
      results,
    })
  } catch (error) {
    console.error('Error processing bids:', error)
    return errorResponse('Internal server error', 500)
  }
})
```

**Step 2: Commit**

```bash
git add supabase/functions/process-bids/index.ts
git commit -m "feat(api): add process-bids Edge Function for bid resolution"
```

---

## Task 10: Update draft-pick to Initialize Budget

**Files:**
- Modify: `supabase/functions/draft-pick/index.ts`

**Step 1: Add budget initialization when draft completes**

Find the section where draft completes (around line 180-200) and add:

```typescript
// After: Update league status to active
// Add: Initialize team budgets
await serviceClient.rpc('initialize_team_budgets', { p_league_id: league_id })
```

**Step 2: Commit**

```bash
git add supabase/functions/draft-pick/index.ts
git commit -m "feat(api): initialize team budgets when draft completes"
```

---

## Task 11: Integration Tests for Bidding Functions

**Files:**
- Create: `supabase/functions/tests/place-bid.test.ts`

**Step 1: Write tests**

```typescript
import { assertEquals } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'place-bid',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'Unauthorized')
    })

    await t.step('returns 400 for invalid league_id', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: 'not-a-uuid',
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for invalid amount', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        tmdb_id: 12345,
        amount: 150,
      })
      assertEquals(result.error, 'Amount must be between 0 and 100')
    })

    await t.step('returns 400 when league is not active', async () => {
      const { id: leagueId } = await factory.createLeague(uniqueName('bid-setup'))
      const result = await invokeFunction(client, 'place-bid', {
        league_id: leagueId,
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'League is not active')
    })

    // More tests would follow for successful bid placement, outbidding, etc.
    // These require a league in 'active' status which needs the full draft flow

    await factory.cleanup()
  },
})
```

**Step 2: Run tests**

Run: `npm run test:functions`

Expected: Tests pass

**Step 3: Commit**

```bash
git add supabase/functions/tests/place-bid.test.ts
git commit -m "test(api): add integration tests for place-bid"
```

---

## Task 12: Frontend - League Settings Form (Bidding Config)

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/settings/LeagueSettingsClient.tsx`

**Step 1: Add bidding configuration fields to the settings form**

This task adds form fields for `total_slots`, `draft_slots`, `drop_limit`, and `counterbid_hours` in the league settings UI. Only visible when league is in 'setup' status.

(Full implementation details would include the React component code with form fields, validation, and API calls to update the league)

**Step 2: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/settings/
git commit -m "feat(ui): add bidding configuration to league settings"
```

---

## Remaining Tasks (Summary)

The following tasks follow the same pattern:

13. **Frontend - Bidding UI Component** - Movie search, bid amount input, active bids list
14. **Frontend - Team Roster Component** - Show draft picks vs pickups, drop button
15. **Frontend - Notifications Bell** - Dropdown with unread notifications
16. **Cron Job Setup** - Vercel cron for weekly and hourly bid processing
17. **Email Templates** - Outbid and bid won email templates via Resend
18. **Update DraftBoard** - Use league.draft_slots instead of hardcoded 5

Each task follows the same structure: write code, test, commit.

---

## Verification Checklist

Before considering implementation complete:

- [ ] All migrations apply cleanly
- [ ] Edge Function tests pass
- [ ] Frontend builds without errors
- [ ] Manual test: Create league with custom slot config
- [ ] Manual test: Complete draft with configured rounds
- [ ] Manual test: Place bid, get outbid, counter bid
- [ ] Manual test: Win auction, see movie on roster
- [ ] Manual test: Drop movie, verify slot freed
- [ ] Manual test: Notifications appear when outbid
