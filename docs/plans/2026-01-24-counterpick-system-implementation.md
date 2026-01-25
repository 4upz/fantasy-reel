# Counterpick System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a counterpick system where players bet against opponents' drafted movies, gaining points if movies flop.

**Architecture:** New `counterpicks` table with mirror-inverse scoring. Draft counterpick round after main draft, optional counterpicks during bidding. Drop blocking when counterpicked (configurable).

**Tech Stack:** Supabase PostgreSQL migrations, Deno Edge Functions, React/Next.js frontend with Cinematic Dark design system.

---

## Task 1: Database Migration - Schema Changes

**Files:**
- Create: `supabase/migrations/20260203_counterpick_system.sql`

**Step 1: Write the migration file**

```sql
-- Migration: Counterpick System
-- Adds counterpicks table, league config columns, and scoring integration

-- ============================================================================
-- SCHEMA CHANGES: Extend leagues table with counterpick config
-- ============================================================================

-- Add counterpick configuration columns to leagues
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS draft_counterpick_slots INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bidding_counterpick_slots INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counterpicks_block_drops BOOLEAN DEFAULT TRUE;

-- Add 'counterpicking' to status enum
-- First drop and recreate the constraint
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_status_check;
ALTER TABLE leagues ADD CONSTRAINT leagues_status_check
  CHECK (status IN ('setup', 'drafting', 'counterpicking', 'active', 'completed'));

-- ============================================================================
-- SCHEMA CHANGES: Extend draft_picks with counterpick reference
-- ============================================================================

ALTER TABLE draft_picks
  ADD COLUMN IF NOT EXISTS counterpicked_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_draft_picks_counterpicked_by
  ON draft_picks(counterpicked_by_team_id) WHERE counterpicked_by_team_id IS NOT NULL;

-- ============================================================================
-- CREATE COUNTERPICKS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS counterpicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  counterpicker_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  target_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  draft_pick_id UUID REFERENCES draft_picks(id) ON DELETE CASCADE,
  pick_order INTEGER,
  phase TEXT NOT NULL CHECK (phase IN ('draft', 'bidding')),
  fantasy_points DECIMAL(6, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Each movie can only be counterpicked once per league
  UNIQUE(league_id, movie_id)
);

-- Indexes for counterpicks
CREATE INDEX idx_counterpicks_league_id ON counterpicks(league_id);
CREATE INDEX idx_counterpicks_counterpicker_team ON counterpicks(counterpicker_team_id);
CREATE INDEX idx_counterpicks_target_team ON counterpicks(target_team_id);
CREATE INDEX idx_counterpicks_movie ON counterpicks(movie_id);
CREATE INDEX idx_counterpicks_phase ON counterpicks(phase);

-- ============================================================================
-- SCHEMA CHANGES: Extend team_scores with counterpick tracking
-- ============================================================================

ALTER TABLE team_scores
  ADD COLUMN IF NOT EXISTS draft_points DECIMAL(8, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counterpick_points DECIMAL(8, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counterpicks_made INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counterpicks_scored INTEGER DEFAULT 0;

-- ============================================================================
-- RLS POLICIES FOR COUNTERPICKS
-- ============================================================================

ALTER TABLE counterpicks ENABLE ROW LEVEL SECURITY;

-- View: League members can view counterpicks in their leagues
CREATE POLICY "League members can view counterpicks" ON counterpicks
  FOR SELECT TO authenticated
  USING (
    league_id IN (
      SELECT lp.league_id
      FROM league_participants lp
      WHERE lp.user_id = (SELECT auth.uid())
        AND lp.status = 'active'
    )
  );

-- Insert: Players can insert counterpicks for their own team
CREATE POLICY "Players can create counterpicks for their team" ON counterpicks
  FOR INSERT TO authenticated
  WITH CHECK (
    counterpicker_team_id IN (
      SELECT t.id
      FROM teams t
      JOIN league_participants lp ON t.participant_id = lp.id
      WHERE lp.user_id = (SELECT auth.uid())
        AND lp.status = 'active'
    )
  );

-- No direct updates or deletes - managed via Edge Functions

-- ============================================================================
-- ENABLE REALTIME FOR COUNTERPICKS
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE counterpicks;

-- ============================================================================
-- HELPER FUNCTION: Get next counterpick turn
-- ============================================================================

CREATE OR REPLACE FUNCTION get_next_counterpick_turn(p_league_id UUID)
RETURNS TABLE(
  team_id UUID,
  team_name TEXT,
  user_id UUID,
  pick_order INTEGER,
  counterpicks_made INTEGER,
  slots_remaining INTEGER
) AS $$
DECLARE
  v_league RECORD;
  v_participant_count INTEGER;
BEGIN
  -- Get league config
  SELECT l.draft_counterpick_slots, l.status
  INTO v_league
  FROM leagues l
  WHERE l.id = p_league_id;

  IF v_league IS NULL OR v_league.status != 'counterpicking' THEN
    RETURN;
  END IF;

  -- Get participant count for reverse order calculation
  SELECT COUNT(*) INTO v_participant_count
  FROM league_participants lp
  WHERE lp.league_id = p_league_id AND lp.status = 'active';

  -- Return next team that hasn't filled their slots
  -- Order by reverse draft_order (last drafter picks first)
  RETURN QUERY
  SELECT
    t.id AS team_id,
    t.name AS team_name,
    lp.user_id,
    (v_participant_count - lp.draft_order + 1) AS pick_order,
    COALESCE(cp_count.count, 0)::INTEGER AS counterpicks_made,
    (v_league.draft_counterpick_slots - COALESCE(cp_count.count, 0))::INTEGER AS slots_remaining
  FROM teams t
  JOIN league_participants lp ON t.participant_id = lp.id
  LEFT JOIN (
    SELECT c.counterpicker_team_id, COUNT(*) as count
    FROM counterpicks c
    WHERE c.league_id = p_league_id AND c.phase = 'draft'
    GROUP BY c.counterpicker_team_id
  ) cp_count ON cp_count.counterpicker_team_id = t.id
  WHERE lp.league_id = p_league_id
    AND lp.status = 'active'
    AND COALESCE(cp_count.count, 0) < v_league.draft_counterpick_slots
  ORDER BY lp.draft_order DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- HELPER FUNCTION: Get available movies to counterpick
-- ============================================================================

CREATE OR REPLACE FUNCTION get_counterpick_options(p_league_id UUID, p_team_id UUID)
RETURNS TABLE(
  draft_pick_id UUID,
  movie_id UUID,
  movie_title TEXT,
  movie_poster_url TEXT,
  movie_release_date DATE,
  target_team_id UUID,
  target_team_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dp.id AS draft_pick_id,
    m.id AS movie_id,
    m.title AS movie_title,
    m.poster_url AS movie_poster_url,
    m.release_date AS movie_release_date,
    t.id AS target_team_id,
    t.name AS target_team_name
  FROM draft_picks dp
  JOIN movies m ON dp.movie_id = m.id
  JOIN teams t ON dp.team_id = t.id
  WHERE dp.league_id = p_league_id
    AND dp.team_id != p_team_id  -- Can't counterpick your own movies
    AND dp.dropped_at IS NULL    -- Not dropped
    AND dp.counterpicked_by_team_id IS NULL  -- Not already counterpicked
    AND NOT EXISTS (  -- Not already counterpicked in counterpicks table
      SELECT 1 FROM counterpicks c
      WHERE c.league_id = p_league_id AND c.movie_id = m.id
    )
  ORDER BY m.release_date ASC NULLS LAST, m.title ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE SCORING: Recalculate with counterpick points
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_team_score_with_counterpicks(p_team_id UUID)
RETURNS void AS $$
DECLARE
  v_draft_points DECIMAL;
  v_counterpick_points DECIMAL;
  v_movies_scored INTEGER;
  v_movies_pending INTEGER;
  v_counterpicks_made INTEGER;
  v_counterpicks_scored INTEGER;
BEGIN
  -- Calculate draft points (movies team has drafted, not dropped)
  SELECT
    COALESCE(SUM(m.fantasy_points), 0),
    COUNT(m.fantasy_points)::INTEGER,
    COUNT(*) FILTER (WHERE m.fantasy_points IS NULL)::INTEGER
  INTO v_draft_points, v_movies_scored, v_movies_pending
  FROM draft_picks dp
  JOIN movies m ON dp.movie_id = m.id
  WHERE dp.team_id = p_team_id
    AND dp.dropped_at IS NULL;

  -- Add pickup points
  SELECT
    v_draft_points + COALESCE(SUM(m.fantasy_points), 0),
    v_movies_scored + COUNT(m.fantasy_points)::INTEGER,
    v_movies_pending + COUNT(*) FILTER (WHERE m.fantasy_points IS NULL)::INTEGER
  INTO v_draft_points, v_movies_scored, v_movies_pending
  FROM pickups p
  JOIN movies m ON p.movie_id = m.id
  WHERE p.team_id = p_team_id
    AND p.dropped_at IS NULL;

  -- Calculate counterpick points (inverse of target movie fantasy points)
  SELECT
    COALESCE(SUM(-1 * m.fantasy_points), 0),
    COUNT(*)::INTEGER,
    COUNT(m.fantasy_points)::INTEGER
  INTO v_counterpick_points, v_counterpicks_made, v_counterpicks_scored
  FROM counterpicks c
  JOIN movies m ON c.movie_id = m.id
  WHERE c.counterpicker_team_id = p_team_id;

  -- Update counterpick fantasy_points column
  UPDATE counterpicks c
  SET fantasy_points = -1 * m.fantasy_points
  FROM movies m
  WHERE c.movie_id = m.id
    AND c.counterpicker_team_id = p_team_id
    AND m.fantasy_points IS NOT NULL;

  -- Upsert team_scores
  INSERT INTO team_scores (
    team_id,
    total_points,
    draft_points,
    counterpick_points,
    movies_scored,
    movies_pending,
    counterpicks_made,
    counterpicks_scored,
    average_score,
    last_calculated_at
  )
  VALUES (
    p_team_id,
    v_draft_points + v_counterpick_points,
    v_draft_points,
    v_counterpick_points,
    v_movies_scored,
    v_movies_pending,
    v_counterpicks_made,
    v_counterpicks_scored,
    CASE WHEN (v_movies_scored + v_counterpicks_scored) > 0
      THEN ROUND((v_draft_points + v_counterpick_points) / (v_movies_scored + v_counterpicks_scored), 2)
      ELSE 0
    END,
    NOW()
  )
  ON CONFLICT (team_id) DO UPDATE SET
    total_points = EXCLUDED.total_points,
    draft_points = EXCLUDED.draft_points,
    counterpick_points = EXCLUDED.counterpick_points,
    movies_scored = EXCLUDED.movies_scored,
    movies_pending = EXCLUDED.movies_pending,
    counterpicks_made = EXCLUDED.counterpicks_made,
    counterpicks_scored = EXCLUDED.counterpicks_scored,
    average_score = EXCLUDED.average_score,
    last_calculated_at = EXCLUDED.last_calculated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE: recalculate_teams_for_movie to include counterpickers
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_teams_for_movie(p_movie_id UUID)
RETURNS void AS $$
DECLARE
  v_team RECORD;
BEGIN
  -- Find all teams that drafted this movie
  FOR v_team IN
    SELECT DISTINCT dp.team_id
    FROM draft_picks dp
    WHERE dp.movie_id = p_movie_id
      AND dp.dropped_at IS NULL
  LOOP
    PERFORM recalculate_team_score_with_counterpicks(v_team.team_id);
  END LOOP;

  -- Find all teams with pickups of this movie
  FOR v_team IN
    SELECT DISTINCT p.team_id
    FROM pickups p
    WHERE p.movie_id = p_movie_id
      AND p.dropped_at IS NULL
  LOOP
    PERFORM recalculate_team_score_with_counterpicks(v_team.team_id);
  END LOOP;

  -- Find all teams that counterpicked this movie
  FOR v_team IN
    SELECT DISTINCT c.counterpicker_team_id as team_id
    FROM counterpicks c
    WHERE c.movie_id = p_movie_id
  LOOP
    PERFORM recalculate_team_score_with_counterpicks(v_team.team_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Step 2: Apply the migration**

Run: `npx supabase migration up`
Expected: Migration applies successfully

**Step 3: Verify migration**

Run: `npx supabase db diff`
Expected: No differences (schema matches migration)

**Step 4: Commit**

```bash
git add supabase/migrations/20260203_counterpick_system.sql
git commit -m "feat(db): add counterpick system schema

- Add counterpicks table with league/movie uniqueness
- Extend leagues with counterpick config columns
- Add 'counterpicking' status to league status enum
- Extend draft_picks with counterpicked_by_team_id
- Extend team_scores with draft_points/counterpick_points
- Add helper functions for turn order and options
- Update scoring to include counterpick points
- RLS policies for league member access

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Edge Function - start-counterpick-round

**Files:**
- Create: `supabase/functions/start-counterpick-round/index.ts`
- Create: `supabase/functions/tests/start-counterpick-round.test.ts`

**Step 1: Write the test file**

```typescript
// supabase/functions/tests/start-counterpick-round.test.ts
/**
 * Integration tests for start-counterpick-round Edge Function
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'start-counterpick-round',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'start-counterpick-round', {
        league_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing league_id', async () => {
      const result = await invokeFunction(client, 'start-counterpick-round', {})
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for invalid UUID format', async () => {
      const result = await invokeFunction(client, 'start-counterpick-round', {
        league_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    // ============================================================================
    // Not Found Tests
    // ============================================================================

    await t.step('returns 404 when league does not exist', async () => {
      const result = await invokeFunction(client, 'start-counterpick-round', {
        league_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'League not found')
    })

    // ============================================================================
    // Permission Tests
    // ============================================================================

    await t.step('returns 403 when user is not the league owner', async () => {
      const { id: leagueId } = await factory.createLeague(uniqueName('not-owner'))
      await factory.addSecondParticipant(leagueId)

      const result = await invokeFunction(secondClient, 'start-counterpick-round', {
        league_id: leagueId,
      })
      assertEquals(result.error, 'Only the league owner can start the counterpick round')
    })

    // ============================================================================
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when league is in setup status', async () => {
      const { id: leagueId } = await factory.createLeague(uniqueName('in-setup'))

      const result = await invokeFunction(client, 'start-counterpick-round', {
        league_id: leagueId,
      })
      assertEquals(result.error, "League must be in 'drafting' status to start counterpick round")
    })

    await t.step('returns 400 when league is already in counterpicking status', async () => {
      const { id: leagueId } = await factory.createDraftingLeague(uniqueName('already-cp'))

      // Transition to counterpicking manually
      await factory.setLeagueStatus(leagueId, 'counterpicking')

      const result = await invokeFunction(client, 'start-counterpick-round', {
        league_id: leagueId,
      })
      assertEquals(result.error, "League must be in 'drafting' status to start counterpick round")
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('transitions league to counterpicking status', async () => {
      const { id: leagueId } = await factory.createDraftingLeague(uniqueName('success-cp'))

      const { data, error } = await client.functions.invoke('start-counterpick-round', {
        body: { league_id: leagueId },
      })

      assertEquals(error, null)
      assertExists(data.league)
      assertEquals(data.league.status, 'counterpicking')
      assertEquals(data.message, 'Counterpick round started')
      assertExists(data.first_pick)
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
```

**Step 2: Run test to verify it fails**

Run: `deno test --allow-all --env-file=.env.test tests/start-counterpick-round.test.ts`
Expected: FAIL (function doesn't exist yet)

**Step 3: Write the Edge Function**

```typescript
// supabase/functions/start-counterpick-round/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface StartCounterpickRoundRequest {
  league_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const supabaseClient = createClient(
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
    } = await supabaseClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    const { league_id }: StartCounterpickRoundRequest = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    // Fetch the league
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Verify user is the league owner
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can start the counterpick round', 403)
    }

    // Verify league is in drafting status
    if (league.status !== 'drafting') {
      return errorResponse("League must be in 'drafting' status to start counterpick round", 400)
    }

    // Update league status to 'counterpicking'
    const { data: updatedLeague, error: updateError } = await supabaseClient
      .from('leagues')
      .update({ status: 'counterpicking' })
      .eq('id', league_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating league status:', updateError)
      return errorResponse('Failed to start counterpick round', 500)
    }

    // Get first pick info
    const { data: firstPick } = await supabaseClient.rpc('get_next_counterpick_turn', {
      p_league_id: league_id,
    })

    return jsonResponse({
      league: updatedLeague,
      message: 'Counterpick round started',
      first_pick: firstPick?.[0] ?? null,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
```

**Step 4: Run test to verify it passes**

Run: `deno test --allow-all --env-file=.env.test tests/start-counterpick-round.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add supabase/functions/start-counterpick-round/index.ts supabase/functions/tests/start-counterpick-round.test.ts
git commit -m "feat(api): add start-counterpick-round Edge Function

Transitions league from 'drafting' to 'counterpicking' status.
Returns first pick info using reverse draft order.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Edge Function - make-counterpick

**Files:**
- Create: `supabase/functions/make-counterpick/index.ts`
- Create: `supabase/functions/tests/make-counterpick.test.ts`

**Step 1: Write the test file**

```typescript
// supabase/functions/tests/make-counterpick.test.ts
/**
 * Integration tests for make-counterpick Edge Function
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'make-counterpick',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, thirdClient, factory } = await createTestFactory()

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'make-counterpick', {
        league_id: '00000000-0000-0000-0000-000000000000',
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing league_id', async () => {
      const result = await invokeFunction(client, 'make-counterpick', {
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for missing movie_id', async () => {
      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Valid movie_id is required')
    })

    // ============================================================================
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when league is not in counterpicking phase', async () => {
      const { id: leagueId } = await factory.createDraftingLeague(uniqueName('not-cp'))
      const movieId = await factory.createMovie()

      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: leagueId,
        movie_id: movieId,
      })
      assertEquals(result.error, 'League is not in counterpicking phase')
    })

    // ============================================================================
    // Turn Validation Tests
    // ============================================================================

    await t.step('returns 403 when not the current turn', async () => {
      const { id: leagueId } = await factory.createCounterpickingLeague(uniqueName('wrong-turn'))
      const movieId = await factory.draftMovieForSecondUser(leagueId)

      // Second user tries to pick when it's first user's turn
      const result = await invokeFunction(secondClient, 'make-counterpick', {
        league_id: leagueId,
        movie_id: movieId,
      })
      assertEquals(result.error, "It's not your turn to counterpick")
    })

    // ============================================================================
    // Target Validation Tests
    // ============================================================================

    await t.step('returns 400 when trying to counterpick own movie', async () => {
      const { id: leagueId } = await factory.createCounterpickingLeague(uniqueName('own-movie'))
      const movieId = await factory.draftMovieForFirstUser(leagueId)

      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: leagueId,
        movie_id: movieId,
      })
      assertEquals(result.error, 'Cannot counterpick your own movie')
    })

    await t.step('returns 400 when movie is already counterpicked', async () => {
      const { id: leagueId } = await factory.createCounterpickingLeagueWith3Players(uniqueName('already-cp'))
      const movieId = await factory.draftMovieForSecondUser(leagueId)

      // First user counterpicks
      await client.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: movieId },
      })

      // Third user tries to counterpick same movie
      const result = await invokeFunction(thirdClient, 'make-counterpick', {
        league_id: leagueId,
        movie_id: movieId,
      })
      assertEquals(result.error, 'Movie has already been counterpicked')
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('creates counterpick successfully', async () => {
      const { id: leagueId } = await factory.createCounterpickingLeague(uniqueName('success'))
      const movieId = await factory.draftMovieForSecondUser(leagueId)

      const { data, error } = await client.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: movieId },
      })

      assertEquals(error, null)
      assertExists(data.counterpick)
      assertEquals(data.counterpick.movie_id, movieId)
      assertEquals(data.counterpick.phase, 'draft')
      assertEquals(data.message, 'Counterpick placed successfully')
    })

    await t.step('updates draft_pick counterpicked_by_team_id', async () => {
      const { id: leagueId, teamId } = await factory.createCounterpickingLeague(uniqueName('updates-dp'))
      const { movieId, draftPickId } = await factory.draftMovieForSecondUserWithPickId(leagueId)

      await client.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: movieId },
      })

      // Verify draft_pick was updated
      const { data: draftPick } = await client
        .from('draft_picks')
        .select('counterpicked_by_team_id')
        .eq('id', draftPickId)
        .single()

      assertEquals(draftPick?.counterpicked_by_team_id, teamId)
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
```

**Step 2: Run test to verify it fails**

Run: `deno test --allow-all --env-file=.env.test tests/make-counterpick.test.ts`
Expected: FAIL (function doesn't exist yet)

**Step 3: Write the Edge Function**

```typescript
// supabase/functions/make-counterpick/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface MakeCounterpickRequest {
  league_id: string
  movie_id: string
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

    const { league_id, movie_id }: MakeCounterpickRequest = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!movie_id || !isValidUUID(movie_id)) {
      return errorResponse('Valid movie_id is required', 400)
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

    // Check league status
    if (league.status !== 'counterpicking' && league.status !== 'active') {
      return errorResponse('League is not in counterpicking phase', 400)
    }

    // Get user's team in this league
    const { data: userTeam, error: teamError } = await serviceClient
      .from('teams')
      .select(`
        id,
        participant_id,
        league_participants!inner(user_id, league_id)
      `)
      .eq('league_participants.user_id', user.id)
      .eq('league_participants.league_id', league_id)
      .single()

    if (teamError || !userTeam) {
      return errorResponse('You are not a member of this league', 403)
    }

    // For draft counterpick phase, check turn order
    if (league.status === 'counterpicking') {
      const { data: nextTurn } = await serviceClient.rpc('get_next_counterpick_turn', {
        p_league_id: league_id,
      })

      if (!nextTurn?.[0] || nextTurn[0].team_id !== userTeam.id) {
        return errorResponse("It's not your turn to counterpick", 403)
      }
    }

    // For bidding phase counterpicks, check slot limit
    if (league.status === 'active') {
      const { count: existingCount } = await serviceClient
        .from('counterpicks')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', league_id)
        .eq('counterpicker_team_id', userTeam.id)
        .eq('phase', 'bidding')

      if ((existingCount ?? 0) >= (league.bidding_counterpick_slots ?? 0)) {
        return errorResponse('You have used all your bidding counterpick slots', 400)
      }
    }

    // Fetch the draft pick for this movie
    const { data: draftPick, error: pickError } = await serviceClient
      .from('draft_picks')
      .select(`
        id,
        team_id,
        movie_id,
        counterpicked_by_team_id,
        dropped_at,
        movies(id, title, poster_url),
        teams(id, name)
      `)
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .is('dropped_at', null)
      .single()

    if (pickError || !draftPick) {
      return errorResponse('Movie not found in this league', 404)
    }

    // Cannot counterpick own movie
    if (draftPick.team_id === userTeam.id) {
      return errorResponse('Cannot counterpick your own movie', 400)
    }

    // Check if already counterpicked
    if (draftPick.counterpicked_by_team_id) {
      return errorResponse('Movie has already been counterpicked', 400)
    }

    // Check counterpicks table too (double-check)
    const { count: existingCounterpick } = await serviceClient
      .from('counterpicks')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)

    if ((existingCounterpick ?? 0) > 0) {
      return errorResponse('Movie has already been counterpicked', 400)
    }

    // Get current pick order for draft phase
    let pickOrder = null
    if (league.status === 'counterpicking') {
      const { count } = await serviceClient
        .from('counterpicks')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', league_id)
        .eq('phase', 'draft')

      pickOrder = (count ?? 0) + 1
    }

    // Create the counterpick
    const { data: counterpick, error: insertError } = await serviceClient
      .from('counterpicks')
      .insert({
        league_id,
        counterpicker_team_id: userTeam.id,
        target_team_id: draftPick.team_id,
        movie_id,
        draft_pick_id: draftPick.id,
        pick_order: pickOrder,
        phase: league.status === 'counterpicking' ? 'draft' : 'bidding',
      })
      .select(`
        *,
        movies(id, title, poster_url, release_date),
        target_team:teams!counterpicks_target_team_id_fkey(id, name)
      `)
      .single()

    if (insertError) {
      console.error('Error creating counterpick:', insertError)
      return errorResponse('Failed to create counterpick', 500)
    }

    // Update the draft_pick
    const { error: updateError } = await serviceClient
      .from('draft_picks')
      .update({ counterpicked_by_team_id: userTeam.id })
      .eq('id', draftPick.id)

    if (updateError) {
      console.error('Error updating draft pick:', updateError)
    }

    // Check if counterpick round is complete
    let roundComplete = false
    if (league.status === 'counterpicking') {
      const { data: nextTurn } = await serviceClient.rpc('get_next_counterpick_turn', {
        p_league_id: league_id,
      })

      if (!nextTurn || nextTurn.length === 0) {
        // No more turns - transition to active
        await serviceClient
          .from('leagues')
          .update({ status: 'active' })
          .eq('id', league_id)
        roundComplete = true
      }
    }

    return jsonResponse({
      counterpick,
      message: 'Counterpick placed successfully',
      round_complete: roundComplete,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
```

**Step 4: Run test to verify it passes**

Run: `deno test --allow-all --env-file=.env.test tests/make-counterpick.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add supabase/functions/make-counterpick/index.ts supabase/functions/tests/make-counterpick.test.ts
git commit -m "feat(api): add make-counterpick Edge Function

Places a counterpick against an opponent's drafted movie.
Validates turn order, ownership, and duplicate checks.
Transitions league to 'active' when round completes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update drop-movie to check counterpick blocking

**Files:**
- Modify: `supabase/functions/drop-movie/index.ts`
- Modify: `supabase/functions/tests/drop-movie.test.ts`

**Step 1: Add test case for counterpick blocking**

Add to `supabase/functions/tests/drop-movie.test.ts`:

```typescript
await t.step('returns 400 when movie is counterpicked and blocking enabled', async () => {
  const { id: leagueId, draftPickId } = await factory.createLeagueWithCounterpickedMovie()

  const result = await invokeFunction(client, 'drop-movie', {
    draft_pick_id: draftPickId,
  })
  assertEquals(result.error, 'Cannot drop a movie that has been counterpicked')
})

await t.step('allows drop when counterpick blocking is disabled', async () => {
  const { id: leagueId, draftPickId } = await factory.createLeagueWithCounterpickedMovie({
    counterpicks_block_drops: false,
  })

  const { data, error } = await client.functions.invoke('drop-movie', {
    body: { draft_pick_id: draftPickId },
  })

  assertEquals(error, null)
  assertExists(data.movie)
})
```

**Step 2: Run test to verify it fails**

Run: `deno test --allow-all --env-file=.env.test tests/drop-movie.test.ts`
Expected: FAIL (new test cases fail)

**Step 3: Update the Edge Function**

Add after the released movie check (around line 152):

```typescript
// Check if movie is counterpicked and blocking is enabled
if (hasDraftPickId) {
  const { data: blockCheck } = await serviceClient
    .from('draft_picks')
    .select(`
      counterpicked_by_team_id,
      leagues!inner(counterpicks_block_drops)
    `)
    .eq('id', draft_pick_id)
    .single()

  if (blockCheck?.counterpicked_by_team_id && blockCheck?.leagues?.counterpicks_block_drops) {
    return errorResponse('Cannot drop a movie that has been counterpicked', 400)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `deno test --allow-all --env-file=.env.test tests/drop-movie.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add supabase/functions/drop-movie/index.ts supabase/functions/tests/drop-movie.test.ts
git commit -m "feat(api): block dropping counterpicked movies

Respects league.counterpicks_block_drops setting.
When enabled, movies with counterpicks cannot be dropped.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Update update-league for counterpick config

**Files:**
- Modify: `supabase/functions/update-league/index.ts`
- Modify: `supabase/functions/tests/update-league.test.ts`

**Step 1: Add test cases**

Add to `supabase/functions/tests/update-league.test.ts`:

```typescript
// ============================================================================
// Counterpick Config Tests
// ============================================================================

await t.step('update_counterpick_config: updates draft_counterpick_slots', async () => {
  const { id: leagueId } = await factory.createLeague(uniqueName('cp-slots'))

  const result = await invokeFunction(client, 'update-league', {
    league_id: leagueId,
    action: 'update_counterpick_config',
    draft_counterpick_slots: 2,
  })

  assertEquals(result.league.draft_counterpick_slots, 2)
})

await t.step('update_counterpick_config: updates bidding_counterpick_slots', async () => {
  const { id: leagueId } = await factory.createLeague(uniqueName('bidding-cp'))

  const result = await invokeFunction(client, 'update-league', {
    league_id: leagueId,
    action: 'update_counterpick_config',
    bidding_counterpick_slots: 1,
  })

  assertEquals(result.league.bidding_counterpick_slots, 1)
})

await t.step('update_counterpick_config: updates counterpicks_block_drops', async () => {
  const { id: leagueId } = await factory.createLeague(uniqueName('block-drops'))

  const result = await invokeFunction(client, 'update-league', {
    league_id: leagueId,
    action: 'update_counterpick_config',
    counterpicks_block_drops: false,
  })

  assertEquals(result.league.counterpicks_block_drops, false)
})

await t.step('update_counterpick_config: returns 400 for draft_counterpick_slots < 0', async () => {
  const { id: leagueId } = await factory.createLeague(uniqueName('invalid-slots'))

  const result = await invokeFunction(client, 'update-league', {
    league_id: leagueId,
    action: 'update_counterpick_config',
    draft_counterpick_slots: -1,
  })

  assertEquals(result.error, 'draft_counterpick_slots must be between 0 and 5')
})
```

**Step 2: Update the Edge Function**

Add new action handler:

```typescript
case 'update_counterpick_config': {
  const {
    draft_counterpick_slots,
    bidding_counterpick_slots,
    counterpicks_block_drops,
  } = body

  // Validate draft_counterpick_slots
  if (draft_counterpick_slots !== undefined) {
    if (typeof draft_counterpick_slots !== 'number' || draft_counterpick_slots < 0 || draft_counterpick_slots > 5) {
      return errorResponse('draft_counterpick_slots must be between 0 and 5', 400)
    }
  }

  // Validate bidding_counterpick_slots
  if (bidding_counterpick_slots !== undefined) {
    if (typeof bidding_counterpick_slots !== 'number' || bidding_counterpick_slots < 0 || bidding_counterpick_slots > 5) {
      return errorResponse('bidding_counterpick_slots must be between 0 and 5', 400)
    }
  }

  const updates: Record<string, unknown> = {}
  if (draft_counterpick_slots !== undefined) updates.draft_counterpick_slots = draft_counterpick_slots
  if (bidding_counterpick_slots !== undefined) updates.bidding_counterpick_slots = bidding_counterpick_slots
  if (counterpicks_block_drops !== undefined) updates.counterpicks_block_drops = counterpicks_block_drops

  if (Object.keys(updates).length === 0) {
    return errorResponse('No counterpick config fields provided', 400)
  }

  const { data: updatedLeague, error: updateError } = await serviceClient
    .from('leagues')
    .update(updates)
    .eq('id', league_id)
    .select()
    .single()

  if (updateError) {
    console.error('Error updating counterpick config:', updateError)
    return errorResponse('Failed to update counterpick config', 500)
  }

  return jsonResponse({ league: updatedLeague })
}
```

**Step 3: Run tests and commit**

```bash
git add supabase/functions/update-league/index.ts supabase/functions/tests/update-league.test.ts
git commit -m "feat(api): add counterpick config to update-league

Supports update_counterpick_config action with:
- draft_counterpick_slots (0-5)
- bidding_counterpick_slots (0-5)
- counterpicks_block_drops (boolean)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Frontend - CounterpickConfigSection component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/settings/CounterpickConfigSection.tsx`

**Note:** Use `frontend-design` skill for this task.

**Step 1: Create the component**

```tsx
// apps/frontend/app/(authenticated)/league/[id]/settings/CounterpickConfigSection.tsx
'use client'

import { useState } from 'react'
import { Target, ShieldCheck, AlertTriangle } from 'lucide-react'

interface CounterpickConfigSectionProps {
  leagueId: string
  initialConfig: {
    draft_counterpick_slots: number
    bidding_counterpick_slots: number
    counterpicks_block_drops: boolean
  }
  isOwner: boolean
  disabled?: boolean
}

export function CounterpickConfigSection({
  leagueId,
  initialConfig,
  isOwner,
  disabled,
}: CounterpickConfigSectionProps) {
  const [config, setConfig] = useState(initialConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch('/api/leagues/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: leagueId,
          action: 'update_counterpick_config',
          ...config,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    config.draft_counterpick_slots !== initialConfig.draft_counterpick_slots ||
    config.bidding_counterpick_slots !== initialConfig.bidding_counterpick_slots ||
    config.counterpicks_block_drops !== initialConfig.counterpicks_block_drops

  if (!isOwner) {
    return (
      <section className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Target className="w-5 h-5 text-gold" />
          <h2 className="font-display text-lg">Counterpick Settings</h2>
        </div>
        <div className="space-y-3 text-foreground-secondary">
          <p>Draft counterpicks: {config.draft_counterpick_slots} per player</p>
          <p>Bidding counterpicks: {config.bidding_counterpick_slots} per player</p>
          <p>Drop blocking: {config.counterpicks_block_drops ? 'Enabled' : 'Disabled'}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="card p-6">
      <div className="flex items-center gap-3 mb-6">
        <Target className="w-5 h-5 text-gold" />
        <h2 className="font-display text-lg">Counterpick Settings</h2>
      </div>

      <div className="space-y-6">
        {/* Draft Counterpick Slots */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Draft Counterpicks (per player)
          </label>
          <select
            value={config.draft_counterpick_slots}
            onChange={(e) =>
              setConfig({ ...config, draft_counterpick_slots: Number(e.target.value) })
            }
            disabled={disabled || saving}
            className="input w-full"
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'counterpick' : 'counterpicks'}
              </option>
            ))}
          </select>
          <p className="text-sm text-foreground-muted mt-1">
            Required counterpicks after the draft completes
          </p>
        </div>

        {/* Bidding Counterpick Slots */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Bidding Counterpicks (per player)
          </label>
          <select
            value={config.bidding_counterpick_slots}
            onChange={(e) =>
              setConfig({ ...config, bidding_counterpick_slots: Number(e.target.value) })
            }
            disabled={disabled || saving}
            className="input w-full"
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'counterpick' : 'counterpicks'}
              </option>
            ))}
          </select>
          <p className="text-sm text-foreground-muted mt-1">
            Optional counterpicks during bidding windows
          </p>
        </div>

        {/* Drop Blocking Toggle */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="counterpicks_block_drops"
            checked={config.counterpicks_block_drops}
            onChange={(e) =>
              setConfig({ ...config, counterpicks_block_drops: e.target.checked })
            }
            disabled={disabled || saving}
            className="mt-1 h-4 w-4 rounded border-border bg-elevated text-gold focus:ring-gold"
          />
          <div>
            <label
              htmlFor="counterpicks_block_drops"
              className="flex items-center gap-2 text-sm font-medium cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-gold" />
              Block drops on counterpicked movies
            </label>
            <p className="text-sm text-foreground-muted mt-1">
              When enabled, owners cannot drop movies that have been counterpicked
            </p>
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="alert alert-error flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}
        {success && (
          <div className="alert alert-success">Settings saved successfully</div>
        )}

        {/* Save Button */}
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary w-full"
          >
            {saving ? 'Saving...' : 'Save Counterpick Settings'}
          </button>
        )}
      </div>
    </section>
  )
}
```

**Step 2: Add to settings page**

Import and add to `/league/[id]/settings/page.tsx`.

**Step 3: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/settings/CounterpickConfigSection.tsx
git commit -m "feat(ui): add CounterpickConfigSection component

Configures draft_counterpick_slots, bidding_counterpick_slots,
and counterpicks_block_drops in league settings.
Uses Cinematic Dark design system.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Frontend - CounterpickRound component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/CounterpickRound.tsx`
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/CounterpickPicker.tsx`

**Note:** Use `frontend-design` skill for this task.

See design document for component specifications. Components should:
- Show whose turn it is with reverse draft order
- Display opponent's movies as counterpick options
- Use Target icon from lucide-react
- Follow Cinematic Dark design patterns

**Step 1: Implement CounterpickPicker**

```tsx
// Component that displays available movies to counterpick
// Uses get_counterpick_options RPC to fetch options
// Displays movie poster, title, target team name
// Click to select, confirm button to place counterpick
```

**Step 2: Implement CounterpickRound**

```tsx
// Wrapper component for the counterpick phase
// Shows current turn indicator
// Displays CounterpickPicker when it's user's turn
// Shows waiting state when it's another player's turn
// Subscribes to counterpicks table for real-time updates
```

**Step 3: Commit**

---

## Task 8: Frontend - Update DraftBoard for counterpicking status

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/DraftBoard.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/LeagueHeader.tsx`

**Note:** Use `frontend-design` skill for this task.

**Step 1: Add "Start Counterpick Round" button to LeagueHeader**

When league status is 'drafting' and user is owner, show button.

**Step 2: Update DraftBoard to render CounterpickRound**

When league status is 'counterpicking', render CounterpickRound instead of MoviePicker.

**Step 3: Add counterpick indicators to pick history**

Show Target icon on movies that have been counterpicked.

---

## Task 9: Frontend - Update Standings with counterpick points

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/standings/TeamStandingCard.tsx`

**Note:** Use `frontend-design` skill for this task.

**Step 1: Display points breakdown**

Show draft_points and counterpick_points separately.

**Step 2: Add counterpick indicator to movies**

Show Target icon on movies that were counterpicked.

---

## Task 10: Integration Tests

**Files:**
- Create: `supabase/functions/tests/counterpick-flow.test.ts`

Test the full flow:
1. Create league with 2+ participants
2. Start and complete draft
3. Start counterpick round
4. Each player makes counterpicks in reverse draft order
5. Round completes, league transitions to active
6. Verify scoring when movies get rated

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Database migration | 1 new |
| 2 | start-counterpick-round function | 2 new |
| 3 | make-counterpick function | 2 new |
| 4 | Update drop-movie | 2 modified |
| 5 | Update update-league | 2 modified |
| 6 | CounterpickConfigSection | 1 new |
| 7 | CounterpickRound/Picker | 2 new |
| 8 | Update DraftBoard | 2 modified |
| 9 | Update Standings | 1 modified |
| 10 | Integration tests | 1 new |

**Total: 10 tasks, ~14 files**
