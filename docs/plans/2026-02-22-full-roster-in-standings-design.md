# Full Roster in Team Standings

**Date:** 2026-02-22
**Status:** Approved

## Problem

The standings page only shows draft picks when expanding a team's card. Pickups (won via fantasy budget bidding) and counterpick details (specific movies being bet against) are missing. Users cannot see another team's complete roster from standings — only their drafted movies.

The roster page (`/league/[id]/roster`) correctly displays all three acquisition types but is limited to the current user's own team.

## Approach

Extend the existing standings data flow to include pickups and counterpicks. No new routes or shared abstractions — just query the additional tables, thread the data through, and render sectioned views in the expanded `TeamStandingCard`.

## Data Flow

### Current

```
standings/page.tsx
  → queries: draft_picks (league-wide)
  → passes: draftPicks[] to StandingsClient
    → groups by team_id
    → passes per-team draftPicks to TeamStandingCard
      → renders MovieScoreCard for each draft pick
      → renders counterpick text summary from team_scores
```

### Proposed

```
standings/page.tsx
  → queries: draft_picks, pickups, counterpicks (all league-wide, parallel)
  → passes: draftPicks[], pickups[], counterpicks[] to StandingsClient
    → groups each by team_id / counterpicker_team_id
    → passes per-team data to TeamStandingCard
      → renders Draft Picks section (MovieScoreCard, existing)
      → renders Pickups section (MovieScoreCard, with "$X" label)
      → renders Counterpicks section (MovieScoreCard, with Target icon + "vs. Team")
```

## File Changes

### `apps/frontend/types/index.ts`

- Add `PickupWithScores` interface (extends `Pickup` with `movies: MovieWithScores`)
- Add `CounterpickWithScores` interface (extends `Counterpick` with `movies: MovieWithScores` and `target_team: { name: string }`)
- Extend `RankedTeamWithPickups` → rename or create `RankedTeamFull` that includes `pickups` and `counterpicks`

### `apps/frontend/app/(authenticated)/league/[id]/standings/page.tsx`

Add two parallel queries alongside existing `draftPicksResult`:

```typescript
// Pickups for this league (active only)
supabase
  .from('pickups')
  .select('*, movies(*, reviews(*))')
  .eq('league_id', id)
  .is('dropped_at', null)
  .order('picked_up_at', { ascending: true })

// Counterpicks for this league
supabase
  .from('counterpicks')
  .select('*, movies(*, reviews(*)), target_team:teams!counterpicks_target_team_id_fkey(name)')
  .eq('league_id', id)
  .order('pick_order', { ascending: true })
```

Pass both to `StandingsClient` as new props.

### `apps/frontend/app/(authenticated)/league/[id]/standings/StandingsClient.tsx`

- Accept `pickups` and `counterpicks` props
- In `calculateRankings`, group pickups by `team_id` and counterpicks by `counterpicker_team_id`
- Include them in each `RankedTeam` entry
- Update summary stats to count all movie types (not just draft picks)

### `apps/frontend/app/(authenticated)/league/[id]/standings/TeamStandingCard.tsx`

Expanded section changes from a flat list to three sections:

1. **Draft Picks** (Trophy icon) — existing `MovieScoreCard`, no change
2. **Pickups** (ShoppingCart icon) — `MovieScoreCard` with `label="$15"` style badge
3. **Counterpicks** (Target icon) — `MovieScoreCard` with `label="vs. Team Name"` and inverted point display

Replace the current counterpick text summary with the actual movies.

Update the movie count in the collapsed header to include all types.

### `apps/frontend/app/(authenticated)/league/[id]/standings/MovieScoreCard.tsx`

Refactor from hardcoded `round`/`pickNumber` props to a flexible badge system:

```typescript
// Current props
interface Props {
  movie: MovieWithScores
  pickNumber: number
  round: number
  isCounterpicked?: boolean
}

// New props
interface Props {
  movie: MovieWithScores
  badge: { type: 'draft'; round: number; pick: number }
       | { type: 'pickup'; amount: number }
       | { type: 'counterpick'; targetTeam: string }
  isCounterpicked?: boolean
}
```

The top-left badge renders differently per type:
- `draft` → "2.4" (round.pick) in muted circle
- `pickup` → "$15" in gold-tinted circle
- `counterpick` → Target icon in crimson circle

Points display for counterpicks uses inverted scoring (positive when movie scores poorly).

## What Doesn't Change

- Rank calculation — already uses `team_scores.total_points` which includes all types
- Scoring formula display at bottom of card
- The roster page — stays as-is for own team with drop actions
- No new routes, no new components, no database changes
