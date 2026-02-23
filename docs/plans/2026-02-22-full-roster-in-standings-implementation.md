# Full Roster in Team Standings — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show pickups and counterpicks (not just draft picks) when expanding a team on the standings page.

**Architecture:** Add `pickups` and `counterpicks` queries to the standings server component, thread data through StandingsClient → TeamStandingCard, refactor MovieScoreCard to support flexible badge types, and render three sections (Draft Picks, Pickups, Counterpicks) in the expanded card.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase (PostgREST), Tailwind CSS 4, lucide-react icons

**Design doc:** `docs/plans/2026-02-22-full-roster-in-standings-design.md`

---

### Task 1: Add types for standings with full roster

**Files:**
- Modify: `apps/frontend/types/index.ts`

**Step 1: Add new types after existing standings types (after line 186)**

After the existing `RankedTeam` interface (line 181-186), add:

```typescript
// Pickup with review scores for standings display
export interface PickupWithScores extends Pickup {
  movies: MovieWithScores
}

// Counterpick with review scores and team name for standings display
export interface CounterpickWithScores extends Counterpick {
  movies: MovieWithScores
  target_team: { name: string }
}

// Full ranked team with all roster types
export interface RankedTeamFull extends RankedTeam {
  pickups: PickupWithScores[]
  counterpicks: CounterpickWithScores[]
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (existing errors may be present)

**Step 3: Commit**

```bash
git add apps/frontend/types/index.ts
git commit -m "feat: add types for full roster in standings"
```

---

### Task 2: Refactor MovieScoreCard to support flexible badge types

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/standings/MovieScoreCard.tsx`

**Context:** Currently the component hardcodes `round: number` and `pickNumber: number` props and renders a "round.pick" badge. We need to support three badge variants:
- Draft: "2.4" circle (existing)
- Pickup: "$15" gold circle
- Counterpick: Target icon crimson circle + "vs. Team" subtitle

**Step 1: Replace the Props interface (lines 10-15)**

Replace:
```typescript
interface Props {
  movie: MovieWithScores
  pickNumber: number
  round: number
  isCounterpicked?: boolean
}
```

With:
```typescript
type MovieBadge =
  | { type: 'draft'; round: number; pick: number }
  | { type: 'pickup'; amount: number }
  | { type: 'counterpick'; targetTeam: string }

interface Props {
  movie: MovieWithScores
  badge: MovieBadge
  isCounterpicked?: boolean
  /** For counterpicks, fantasy_points is stored on the counterpick row, not the movie */
  overridePoints?: number | null
}
```

**Step 2: Update the component signature (line 43)**

Replace:
```typescript
export default function MovieScoreCard({ movie, pickNumber, round, isCounterpicked = false }: Props) {
```

With:
```typescript
export default function MovieScoreCard({ movie, badge, isCounterpicked = false, overridePoints }: Props) {
```

**Step 3: Update the fantasy points logic (lines 47-49)**

Replace:
```typescript
  const hasScore = movie.fantasy_points != null
  const isReleased = movie.status === 'released'
  const isPositive = hasScore && movie.fantasy_points! >= 0
```

With:
```typescript
  const displayPoints = overridePoints !== undefined ? overridePoints : movie.fantasy_points
  const hasScore = displayPoints != null
  const isReleased = movie.status === 'released'
  const isPositive = hasScore && displayPoints! >= 0
```

**Step 4: Replace the badge rendering (lines 101-106)**

Replace:
```tsx
        {/* Round/Pick Badge */}
        <div className="absolute -top-2 -left-2 w-6 h-6 bg-surface border border-border rounded-full flex items-center justify-center">
          <span className="text-[10px] font-bold text-foreground-muted">
            {round}.{pickNumber}
          </span>
        </div>
```

With:
```tsx
        {/* Badge */}
        {badge.type === 'draft' && (
          <div className="absolute -top-2 -left-2 w-6 h-6 bg-surface border border-border rounded-full flex items-center justify-center">
            <span className="text-[10px] font-bold text-foreground-muted">
              {badge.round}.{badge.pick}
            </span>
          </div>
        )}
        {badge.type === 'pickup' && (
          <div className="absolute -top-2 -left-2 h-6 px-1.5 bg-gold/20 border border-gold/40 rounded-full flex items-center justify-center">
            <span className="text-[10px] font-bold text-gold">
              ${badge.amount}
            </span>
          </div>
        )}
        {badge.type === 'counterpick' && (
          <div className="absolute -top-2 -left-2 w-6 h-6 bg-crimson/20 border border-crimson/40 rounded-full flex items-center justify-center">
            <Target className="w-3 h-3 text-crimson" />
          </div>
        )}
```

**Step 5: Update fantasy points display (lines 152-153)**

Replace:
```tsx
            <div className={`text-3xl font-bold font-display ${isPositive ? 'text-gold' : 'text-crimson'}`}>
              {formatFantasyPoints(movie.fantasy_points!)}
```

With:
```tsx
            <div className={`text-3xl font-bold font-display ${isPositive ? 'text-gold' : 'text-crimson'}`}>
              {formatFantasyPoints(displayPoints!)}
```

**Step 6: Add "vs. Team" subtitle for counterpicks**

After the release date line (line 124 area, inside the movie info section), add a counterpick context line. Find:
```tsx
        <div className="flex items-center gap-2 mt-1 text-sm text-foreground-muted">
          <span>{releaseDate}</span>
```

And add after `<span>{releaseDate}</span>`:
```tsx
          {badge.type === 'counterpick' && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-crimson/10 text-crimson border border-crimson/20 rounded flex items-center gap-1">
              <Target className="w-2.5 h-2.5" />
              vs. {badge.targetTeam}
            </span>
          )}
```

**Step 7: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: Errors in `TeamStandingCard.tsx` where old props are used (will fix in Task 4)

**Step 8: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/standings/MovieScoreCard.tsx
git commit -m "refactor: make MovieScoreCard support draft/pickup/counterpick badge types"
```

---

### Task 3: Add pickup and counterpick queries to standings page

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/standings/page.tsx`

**Step 1: Update imports (line 4-7)**

Replace:
```typescript
import type {
  ParticipantWithTeamScore,
  DraftPickWithScores,
} from '@/types'
```

With:
```typescript
import type {
  ParticipantWithTeamScore,
  DraftPickWithScores,
  PickupWithScores,
  CounterpickWithScores,
} from '@/types'
```

**Step 2: Add two queries to the Promise.all (lines 54-83)**

Replace the existing `Promise.all` block:
```typescript
  const [participantsResult, draftPicksResult] = await Promise.all([
```

With:
```typescript
  const [participantsResult, draftPicksResult, pickupsResult, counterpicksResult] = await Promise.all([
```

And add after the `draftPicksResult` query (after line 82, before the closing `])`):

```typescript
    supabase
      .from('pickups')
      .select(
        `
        *,
        movies (
          *,
          reviews (*)
        )
      `
      )
      .eq('league_id', id)
      .is('dropped_at', null)
      .order('picked_up_at', { ascending: true }),
    supabase
      .from('counterpicks')
      .select(
        `
        *,
        movies (
          *,
          reviews (*)
        ),
        target_team:teams!counterpicks_target_team_id_fkey (name)
      `
      )
      .eq('league_id', id)
      .order('pick_order', { ascending: true }),
```

**Step 3: Destructure the new results (after line 86)**

After:
```typescript
  const { data: draftPicks } = draftPicksResult
```

Add:
```typescript
  const { data: pickups } = pickupsResult
  const { data: counterpicks } = counterpicksResult
```

**Step 4: Pass new props to StandingsClient (lines 106-110)**

Replace:
```tsx
    <StandingsClient
      participants={participantsWithProfiles as ParticipantWithTeamScore[]}
      draftPicks={(draftPicks ?? []) as DraftPickWithScores[]}
      currentUserId={user.id}
    />
```

With:
```tsx
    <StandingsClient
      participants={participantsWithProfiles as ParticipantWithTeamScore[]}
      draftPicks={(draftPicks ?? []) as DraftPickWithScores[]}
      pickups={(pickups ?? []) as PickupWithScores[]}
      counterpicks={(counterpicks ?? []) as CounterpickWithScores[]}
      currentUserId={user.id}
    />
```

**Step 5: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/standings/page.tsx
git commit -m "feat: add pickup and counterpick queries to standings page"
```

---

### Task 4: Update StandingsClient to group and pass full roster data

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/standings/StandingsClient.tsx`

**Step 1: Update imports (lines 3-8)**

Replace:
```typescript
import type {
  ParticipantWithTeamScore,
  DraftPickWithScores,
  RankedTeam,
} from '@/types'
```

With:
```typescript
import type {
  ParticipantWithTeamScore,
  DraftPickWithScores,
  PickupWithScores,
  CounterpickWithScores,
  RankedTeamFull,
} from '@/types'
```

**Step 2: Update Props interface (lines 11-15)**

Replace:
```typescript
interface Props {
  participants: ParticipantWithTeamScore[]
  draftPicks: DraftPickWithScores[]
  currentUserId: string
}
```

With:
```typescript
interface Props {
  participants: ParticipantWithTeamScore[]
  draftPicks: DraftPickWithScores[]
  pickups: PickupWithScores[]
  counterpicks: CounterpickWithScores[]
  currentUserId: string
}
```

**Step 3: Update calculateRankings function signature and body (lines 17-68)**

Replace the entire `calculateRankings` function:

```typescript
function calculateRankings(
  participants: ParticipantWithTeamScore[],
  draftPicks: DraftPickWithScores[],
  pickups: PickupWithScores[],
  counterpicks: CounterpickWithScores[],
): RankedTeamFull[] {
  // Group draft picks by team_id
  const picksByTeam = new Map<string, DraftPickWithScores[]>()
  for (const pick of draftPicks) {
    const teamId = pick.team_id
    if (!picksByTeam.has(teamId)) {
      picksByTeam.set(teamId, [])
    }
    picksByTeam.get(teamId)!.push(pick)
  }

  // Group pickups by team_id
  const pickupsByTeam = new Map<string, PickupWithScores[]>()
  for (const pickup of pickups) {
    const teamId = pickup.team_id
    if (!pickupsByTeam.has(teamId)) {
      pickupsByTeam.set(teamId, [])
    }
    pickupsByTeam.get(teamId)!.push(pickup)
  }

  // Group counterpicks by counterpicker_team_id
  const counterpicksByTeam = new Map<string, CounterpickWithScores[]>()
  for (const cp of counterpicks) {
    const teamId = cp.counterpicker_team_id
    if (!counterpicksByTeam.has(teamId)) {
      counterpicksByTeam.set(teamId, [])
    }
    counterpicksByTeam.get(teamId)!.push(cp)
  }

  // Sort participants by total_points descending
  const sorted = [...participants].sort((a, b) => {
    const aPoints = a.teams?.team_scores?.total_points ?? 0
    const bPoints = b.teams?.team_scores?.total_points ?? 0
    return bPoints - aPoints
  })

  // Calculate ranks with tie handling
  const ranked: RankedTeamFull[] = []
  let currentRank = 1
  let previousPoints: number | null = null

  for (let i = 0; i < sorted.length; i++) {
    const participant = sorted[i]
    const points = participant.teams?.team_scores?.total_points ?? 0
    const teamId = participant.teams?.id

    // Check for ties
    const isTied = previousPoints !== null && points === previousPoints
    if (!isTied && i > 0) {
      currentRank = i + 1
    }

    // Check if next participant has same points (also tied)
    const nextPoints = sorted[i + 1]?.teams?.team_scores?.total_points ?? null
    const hasTie = isTied || (nextPoints !== null && points === nextPoints)

    ranked.push({
      rank: currentRank,
      participant,
      draftPicks: teamId ? picksByTeam.get(teamId) || [] : [],
      pickups: teamId ? pickupsByTeam.get(teamId) || [] : [],
      counterpicks: teamId ? counterpicksByTeam.get(teamId) || [] : [],
      isTied: hasTie,
    })

    previousPoints = points
  }

  return ranked
}
```

**Step 4: Update the component to use new props (lines 71-85)**

Replace:
```typescript
export default function StandingsClient({
  participants,
  draftPicks,
  currentUserId,
}: Props) {
  const rankedTeams = useMemo(
    () => calculateRankings(participants, draftPicks),
    [participants, draftPicks]
  )

  const summaryStats = useMemo(() => {
    const moviesScored = draftPicks.filter((pick) => pick.movies?.combined_score != null).length
    const moviesPending = draftPicks.length - moviesScored
    return { moviesScored, moviesPending, totalMovies: draftPicks.length }
  }, [draftPicks])
```

With:
```typescript
export default function StandingsClient({
  participants,
  draftPicks,
  pickups,
  counterpicks,
  currentUserId,
}: Props) {
  const rankedTeams = useMemo(
    () => calculateRankings(participants, draftPicks, pickups, counterpicks),
    [participants, draftPicks, pickups, counterpicks]
  )

  const summaryStats = useMemo(() => {
    const allMovies = [
      ...draftPicks.map((p) => p.movies),
      ...pickups.map((p) => p.movies),
    ]
    const moviesScored = allMovies.filter((m) => m?.combined_score != null).length
    const moviesPending = allMovies.length - moviesScored
    return { moviesScored, moviesPending, totalMovies: allMovies.length }
  }, [draftPicks, pickups])
```

**Step 5: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/standings/StandingsClient.tsx
git commit -m "feat: group pickups and counterpicks by team in standings"
```

---

### Task 5: Update TeamStandingCard to render sectioned roster

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/standings/TeamStandingCard.tsx`

**Step 1: Update imports (lines 1-7)**

Replace:
```typescript
'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Target } from 'lucide-react'
import type { RankedTeam } from '@/types'
import MovieScoreCard from './MovieScoreCard'
```

With:
```typescript
'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Target, Trophy, ShoppingCart } from 'lucide-react'
import type { RankedTeamFull } from '@/types'
import MovieScoreCard from './MovieScoreCard'
```

**Step 2: Update Props interface (lines 9-13)**

Replace:
```typescript
interface Props {
  rankedTeam: RankedTeam
  isCurrentUser: boolean
  animationDelay?: number
}
```

With:
```typescript
interface Props {
  rankedTeam: RankedTeamFull
  isCurrentUser: boolean
  animationDelay?: number
}
```

**Step 3: Update the movie count line in the collapsed header (lines 141-147)**

Replace:
```tsx
          <div className="flex items-center gap-3 mt-1 text-sm text-foreground-muted">
            <span>{draftPicks.length} movies</span>
            <span className="text-foreground-muted/50">|</span>
            <span>
              {moviesScored} scored, {moviesPending} pending
            </span>
          </div>
```

With:
```tsx
          <div className="flex items-center gap-3 mt-1 text-sm text-foreground-muted">
            <span>{draftPicks.length + pickups.length} movies</span>
            {counterpicks.length > 0 && (
              <>
                <span className="text-foreground-muted/50">|</span>
                <span className="flex items-center gap-1">
                  <Target className="w-3 h-3 text-crimson" />
                  {counterpicks.length}
                </span>
              </>
            )}
            <span className="text-foreground-muted/50">|</span>
            <span>
              {moviesScored} scored, {moviesPending} pending
            </span>
          </div>
```

**Step 4: Destructure pickups and counterpicks from rankedTeam (line 65)**

Replace:
```typescript
  const { rank, participant, draftPicks, isTied } = rankedTeam
```

With:
```typescript
  const { rank, participant, draftPicks, pickups, counterpicks, isTied } = rankedTeam
```

**Step 5: Replace the expanded movies section (lines 210-261)**

Replace the entire content inside `<div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-border">` (lines 209-261):

```tsx
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-border">
          {/* Draft Picks Section */}
          <div className="pt-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary mb-3">
              <Trophy className="w-4 h-4 text-gold" />
              Draft Picks ({draftPicks.length})
            </h4>
            <div className="space-y-3">
              {draftPicks.length > 0 ? (
                draftPicks.map((pick) => (
                  <MovieScoreCard
                    key={pick.id}
                    movie={pick.movies}
                    badge={{ type: 'draft', round: pick.round, pick: pick.pick_number }}
                    isCounterpicked={!!pick.counterpicked_by_team_id}
                  />
                ))
              ) : (
                <div className="py-4 text-center text-foreground-muted text-sm">
                  No movies drafted yet
                </div>
              )}
            </div>
          </div>

          {/* Pickups Section */}
          {pickups.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary mb-3">
                <ShoppingCart className="w-4 h-4 text-gold" />
                Pickups ({pickups.length})
              </h4>
              <div className="space-y-3">
                {pickups.map((pickup) => (
                  <MovieScoreCard
                    key={pickup.id}
                    movie={pickup.movies}
                    badge={{ type: 'pickup', amount: pickup.amount_paid }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Counterpicks Section */}
          {counterpicks.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary mb-3">
                <Target className="w-4 h-4 text-crimson" />
                Counterpicks ({counterpicks.length})
              </h4>
              <div className="space-y-3">
                {counterpicks.map((cp) => (
                  <MovieScoreCard
                    key={cp.id}
                    movie={cp.movies}
                    badge={{ type: 'counterpick', targetTeam: cp.target_team.name }}
                    overridePoints={cp.fantasy_points}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Scoring Formula Info */}
          {(draftPicks.length > 0 || pickups.length > 0) && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-center text-[11px] text-foreground-muted space-y-1">
                <div>Fantasy points based on 70-point baseline</div>
                <div className="flex items-center justify-center gap-4">
                  <span className="text-gold">90+: +20 base +2/pt</span>
                  <span className="text-foreground-secondary">70-89: +1/pt</span>
                  <span className="text-crimson">&lt;70: -0.5/pt</span>
                </div>
                <div className="flex items-center justify-center gap-4">
                  <span className="text-[#fa320a]">CF +3</span>
                  <span className="text-gold">★ +5</span>
                  <span className="text-crimson">💀 -5</span>
                </div>
              </div>
            </div>
          )}
        </div>
```

**Step 6: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: Clean compile (or only pre-existing warnings)

**Step 7: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/standings/TeamStandingCard.tsx
git commit -m "feat: show pickups and counterpicks in expanded team standings"
```

---

### Task 6: Run code-simplifier

**Step 1: Run code-simplifier agent on all modified files**

Run the `code-simplifier:code-simplifier` agent targeting:
- `apps/frontend/types/index.ts`
- `apps/frontend/app/(authenticated)/league/[id]/standings/MovieScoreCard.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/standings/page.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/standings/StandingsClient.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/standings/TeamStandingCard.tsx`

**Step 2: Review simplifier changes and verify TypeScript still compiles**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit if there are changes**

```bash
git add -A
git commit -m "refactor: code-simplifier pass on standings roster changes"
```

---

### Task 7: Browser verification

**Prerequisite:** Local Supabase must be running (`npx supabase start`). Dev server must be running.

**Step 1: Start dev server**

Kill any existing dev server and restart: `npm run dev`

**Step 2: Log in as test user**

Navigate to `http://localhost:3000/login` and log in as `alice@fantasyreel.test` / `testpass123!`

**Step 3: Navigate to standings page**

Go to an active league's standings page. If no active league exists, note that standings is only available for active/completed leagues.

**Step 4: Verify expanded team view**

- Click to expand a team card
- Verify Draft Picks section appears with Trophy icon and "Round X, Pick Y" badges
- Verify Pickups section appears (if team has any) with ShoppingCart icon and "$X" badges
- Verify Counterpicks section appears (if team has any) with Target icon and "vs. Team" labels
- Verify scoring formula info shows at bottom
- Verify no console errors

**Step 5: Verify collapsed header stats**

- Movie count should include both draft picks and pickups
- Counterpick count should show with Target icon (if any)

**Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during browser verification"
```
