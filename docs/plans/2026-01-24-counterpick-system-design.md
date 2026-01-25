# Counterpick System Design

> Designed: 2026-01-24
> Status: Approved
> Inspired by: [Fantasy Critic](https://www.fantasycritic.games/faq)

## Overview

Counterpicks let players bet against opponents' drafted movies, creating head-to-head tension and rivalry. If the targeted movie flops, the counterpicker gains points. If it succeeds, they lose points.

## Core Mechanics

### Scoring (Mirror Inverse)

Counterpick score = negative of the movie's fantasy points.

| Movie Performance | Movie Owner Gets | Counterpicker Gets |
|-------------------|------------------|-------------------|
| +32 pts (92 avg, bonuses) | +32 | -32 |
| +15 pts (82 avg, Certified Fresh) | +15 | -15 |
| 0 pts (70 avg) | 0 | 0 |
| -8 pts (55 avg) | -8 | +8 |
| -20 pts (32 avg, disaster) | -20 | +20 |
| Unreleased/cancelled | 0 | 0 |

### Targeting Rules

- **Opponents only**: Cannot counterpick your own movies
- **No duplicates**: Each movie can only be counterpicked by one player (first come, first served)
- **Drop blocking**: By default, counterpicked movies cannot be dropped by the owner (configurable)

## Timing & Phases

### League Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `draft_counterpick_slots` | Required counterpicks after draft | 1 |
| `bidding_counterpick_slots` | Optional counterpicks per bidding window | 0 |
| `counterpicks_block_drops` | Whether counterpicked movies can be dropped | true |

### Phase 1: Draft Counterpick Round

After the draft completes, a dedicated counterpick round begins:

1. League status transitions: `drafting` → `counterpicking`
2. Turn order: Reverse of final draft position (last drafter picks first)
3. Each player selects their required counterpicks in sequence
4. Only opponents' movies are shown as options
5. Once a movie is counterpicked, it's unavailable to others
6. Round completes when all players have filled their slots
7. League status transitions: `counterpicking` → `active`

### Phase 2: Bidding Window Counterpicks

During bidding windows (if `bidding_counterpick_slots > 0`):

- Players can claim counterpicks alongside placing pickup bids
- First-come, first-served (no bidding war - just claim it)
- Same no-duplicates rule applies

## Data Model

### New Tables

```sql
-- Counterpick records
counterpicks
├── id: UUID (PK)
├── league_id: UUID (FK → leagues)
├── counterpicker_team_id: UUID (FK → teams) -- who made the bet
├── target_team_id: UUID (FK → teams) -- whose movie is targeted
├── movie_id: UUID (FK → movies)
├── pick_order: INTEGER -- order within counterpick round
├── phase: TEXT -- 'draft' | 'bidding'
├── fantasy_points: DECIMAL -- calculated (inverse of movie score)
├── created_at: TIMESTAMP
└── UNIQUE(league_id, movie_id) -- no duplicate counterpicks
```

### Schema Changes

```sql
-- Extend leagues table
leagues
├── draft_counterpick_slots: INTEGER DEFAULT 1
├── bidding_counterpick_slots: INTEGER DEFAULT 0
├── counterpicks_block_drops: BOOLEAN DEFAULT TRUE
└── status: TEXT -- add 'counterpicking' to enum

-- Extend draft_picks table
draft_picks
└── counterpicked_by_team_id: UUID (FK → teams, nullable)
    -- Quick lookup: is this pick counterpicked? By whom?
```

### Team Score Aggregation

```sql
team_scores
├── draft_points: DECIMAL -- Points from drafted movies
├── counterpick_points: DECIMAL -- Points from counterpicks
├── total_points: DECIMAL -- Combined total
├── counterpicks_made: INTEGER -- Number of counterpicks placed
└── counterpicks_scored: INTEGER -- Number with scores
```

## Edge Functions

### New Functions

| Function | Purpose |
|----------|---------|
| `make-counterpick` | Place a counterpick during draft or bidding phase |
| `start-counterpick-round` | Transition league from drafting → counterpicking |
| `get-counterpick-options` | List available movies to counterpick |

### `make-counterpick` Flow

1. Validate auth + league membership
2. Check phase: 'counterpicking' or 'active' (bidding window open)
3. Validate it's the player's turn (if draft counterpick round)
4. Verify movie belongs to an opponent
5. Verify movie not already counterpicked
6. Check player hasn't exceeded their slot limit
7. Create counterpick record
8. Update draft_picks.counterpicked_by_team_id
9. Advance turn (if draft counterpick round)
10. Return success with counterpick details

### `start-counterpick-round` Flow

1. Validate league owner
2. Verify league status = 'drafting' and draft is complete
3. Calculate turn order (reverse of final draft position)
4. Transition status → 'counterpicking'
5. Notify players via real-time subscription

### Modified Functions

| Function | Change |
|----------|--------|
| `drop-movie` | Check `counterpicks_block_drops` before allowing |
| `process-movie-scores` | Update counterpick fantasy_points after movie scoring |
| `update-league` | Support new counterpick config fields |

## Scoring Integration

### Counterpick Score Calculation

When a movie's fantasy points are calculated (via `calculate_movie_score`), counterpick scores update automatically:

```sql
-- After movie scoring, update counterpick fantasy_points
UPDATE counterpicks
SET fantasy_points = -1 * movies.fantasy_points
WHERE movie_id = p_movie_id;
```

### Drop Blocking Logic

```sql
-- In drop-movie Edge Function
IF EXISTS (
  SELECT 1 FROM draft_picks dp
  JOIN leagues l ON dp.league_id = l.id
  WHERE dp.id = p_draft_pick_id
  AND dp.counterpicked_by_team_id IS NOT NULL
  AND l.counterpicks_block_drops = TRUE
) THEN
  RAISE EXCEPTION 'Cannot drop a counterpicked movie';
END IF;
```

## Frontend Components

**Note:** Use the `frontend-design` skill when implementing all frontend components to ensure consistency with the Cinematic Dark design system. Use icons from the existing icon library, not emojis.

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `CounterpickRound` | `/league/[id]/draft` | Counterpick selection UI after draft |
| `CounterpickPicker` | Same | Browse opponents' movies to target |
| `CounterpickCard` | Shared | Display a counterpick with target info |
| `CounterpickPanel` | `/league/[id]/bidding` | Claim counterpicks during bidding |
| `CounterpickConfigSection` | `/league/[id]/settings` | Configure slots and drop blocking |

### Draft Flow Updates

1. Draft completes → "Start Counterpick Round" button appears (owner only)
2. Status changes to 'counterpicking'
3. UI switches to CounterpickRound view
4. Shows opponents' drafted movies as selectable targets
5. Current turn indicator (reverse draft order)
6. Pick history shows counterpicks being made
7. Round completes → status changes to 'active'

### Standings/Roster Display

- Target icon if your movie was counterpicked (shows who)
- Your counterpicks section in roster view
- Standings breakdown: draft points vs counterpick points

### Real-time Subscriptions

Add `counterpicks` table to existing real-time setup:
- New counterpick → update available options
- Score updates → refresh counterpick points display

## Testing Strategy

### Edge Function Tests

| Test Category | Cases |
|---------------|-------|
| `make-counterpick` | Auth required, valid turn, opponent's movie only, no duplicates, slot limits, phase validation |
| `start-counterpick-round` | Owner only, draft must be complete, correct turn order generation |
| `drop-movie` | Blocked when counterpicked (if enabled), allowed when disabled |
| Scoring | Counterpick points = inverse of movie points, unreleased = 0 |

### Integration Tests

Add to `supabase/functions/tests/`:
- `counterpick-round.test.ts` - Full draft → counterpick flow
- `counterpick-scoring.test.ts` - Score calculation and team totals
- `counterpick-bidding.test.ts` - Counterpicks during bidding window

## Implementation Order

| Phase | Tasks |
|-------|-------|
| 1. Schema | Migration for `counterpicks` table, league config columns, status enum |
| 2. Scoring | Update `calculate_movie_score` and `calculate_team_score` functions |
| 3. Edge Functions | `make-counterpick`, `start-counterpick-round`, `get-counterpick-options` |
| 4. Modified Functions | Update `drop-movie`, `update-league`, scoring jobs |
| 5. Unit Tests | Full test coverage for Edge Functions |
| 6. Frontend | Use `frontend-design` skill for all UI components |
| 7. Integration Tests | End-to-end flows |
| 8. Real-time | Add `counterpicks` to subscriptions |
