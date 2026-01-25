# Vercel React Best Practices Implementation Plan

**Date:** 2026-01-25
**Coordinator:** Claude (Tech Lead / Code Reviewer)
**Execution Model:** Subagent-Driven Development with parallel task groups

---

## Executive Summary

Based on comprehensive scans of the Fantasy Reel frontend, we identified **35+ optimization opportunities** across 4 categories:

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Request Waterfalls (async-parallel) | 8 | - | - | - |
| Re-render Optimization | - | 2 | 4 | 1 |
| Bundle Size (dynamic imports) | - | 6 | 1 | - |
| JS Performance (caching/memoization) | 3 | 2 | 2 | - |

---

## Task Groups (Parallel Execution)

Tasks are grouped by feature area to enable parallel subagent execution without file conflicts.

### Group A: Server Component Waterfalls (Pages)

**Scope:** Fix `Promise.all()` patterns in server components
**Files:** All `page.tsx` files in `league/[id]/`
**Estimated Changes:** 8 files

#### Task A1: League Layout Waterfall Fix
**File:** `apps/frontend/app/(authenticated)/league/[id]/layout.tsx`
**Lines:** 22-50
**Issue:** 3 sequential queries (league → participant → count)
**Vercel Rule:** `async-parallel`

**Current:**
```typescript
const { data: league } = await supabase.from('leagues')...
if (leagueError || !league) notFound()
const { data: userParticipant } = await supabase.from('league_participants')...
if (!userParticipant) redirect()
const { count: participantCount } = await supabase.from('league_participants')...
```

**Required Change:**
```typescript
// Phase 1: Fetch league (required for validation)
const leagueResult = await supabase.from('leagues').select('*').eq('id', id).single()
if (leagueResult.error || !leagueResult.data) notFound()

// Phase 2: Parallel fetch participant + count
const [userParticipantResult, participantCountResult] = await Promise.all([
  supabase.from('league_participants').select('id').eq('league_id', id).eq('user_id', user.id).single(),
  supabase.from('league_participants').select('*', { count: 'exact', head: true }).eq('league_id', id).eq('status', 'active'),
])
if (!userParticipantResult.data) redirect('/dashboard')
```

---

#### Task A2: Dashboard Page Waterfall Fix
**File:** `apps/frontend/app/(authenticated)/league/[id]/dashboard/page.tsx`
**Lines:** 20-54
**Issue:** 3 sequential queries (league → participants → draft picks)
**Vercel Rule:** `async-parallel`

**Required Change:** Parallelize participants and draft picks fetches after league validation.

---

#### Task A3: Standings Page Waterfall Fix
**File:** `apps/frontend/app/(authenticated)/league/[id]/standings/page.tsx`
**Lines:** 25-101
**Issue:** 5 sequential queries
**Vercel Rule:** `async-parallel`

**Required Change:**
1. Combine league + user participant check with `Promise.all()`
2. Parallelize participants + draft picks fetches
3. Profiles can be fetched in parallel once user IDs are known

**Additional Fix:** Replace separate profiles query with FK join:
```typescript
// Instead of separate profiles query
const { data: participants } = await supabase
  .from('league_participants')
  .select(`*, teams (*, team_scores (*)), profiles:user_id (*)`)
```

---

#### Task A4: Draft Page Waterfall Fix
**File:** `apps/frontend/app/(authenticated)/league/[id]/draft/page.tsx`
**Lines:** 20-64
**Issue:** 5 sequential queries
**Vercel Rule:** `async-parallel`

**Required Change:** Parallelize participants, draft picks, and counterpicks after validation.

---

#### Task A5: Roster Page Waterfall Fix
**File:** `apps/frontend/app/(authenticated)/league/[id]/roster/page.tsx`
**Lines:** 22-72
**Issue:** 6 sequential queries (most severe waterfall)
**Vercel Rule:** `async-parallel`

**Required Change:**
```typescript
// After participant validation, parallelize all 4 data fetches
const [draftPicksResult, pickupsResult, budgetResult, dropCountResult] = await Promise.all([
  supabase.from('draft_picks').select('*, movies (*)').eq('team_id', team.id),
  supabase.from('pickup_bids').select('*, movies (*)').eq('team_id', team.id).eq('status', 'won'),
  supabase.from('team_budgets').select('*').eq('team_id', team.id).single(),
  supabase.rpc('get_team_drop_count', { p_team_id: team.id }),
])
```

---

#### Task A6: Bidding Page Waterfall Fix
**File:** `apps/frontend/app/(authenticated)/league/[id]/bidding/page.tsx`
**Lines:** 20-61
**Issue:** 3 sequential queries
**Vercel Rule:** `async-parallel`

---

#### Task A7: Settings Page Waterfall Fix
**File:** `apps/frontend/app/(authenticated)/league/[id]/settings/page.tsx`
**Lines:** 20-44
**Issue:** 2 sequential queries
**Vercel Rule:** `async-parallel`

---

#### Task A8: Trading Page Waterfall Fix
**File:** `apps/frontend/app/(authenticated)/league/[id]/trading/page.tsx`
**Lines:** 20-64
**Issue:** 3 sequential queries
**Vercel Rule:** `async-parallel`

---

### Group B: React.cache() Infrastructure

**Scope:** Create cached data fetching utilities
**Files:** New utilities + layout updates
**Estimated Changes:** 2-3 files

#### Task B1: Create Cached Supabase Utilities
**File:** `apps/frontend/utils/supabase/cached.ts` (NEW)
**Vercel Rule:** `server-cache-react`

**Implementation:**
```typescript
import { cache } from 'react'
import { createClient } from './server'

// Cache user auth - called in layout AND every page
export const getCachedUser = cache(async () => {
  const supabase = await createClient()
  return supabase.auth.getUser()
})

// Cache profile by user ID
export const getCachedProfile = cache(async (userId: string) => {
  const supabase = await createClient()
  return supabase.from('profiles').select('*').eq('user_id', userId).single()
})

// Cache league by ID - shared across layout and page
export const getCachedLeague = cache(async (leagueId: string) => {
  const supabase = await createClient()
  return supabase.from('leagues').select('*').eq('id', leagueId).single()
})
```

#### Task B2: Update Layout to Use Cached Utilities
**File:** `apps/frontend/app/(authenticated)/layout.tsx`
**Lines:** 14, 21-25

Replace direct Supabase calls with cached versions.

---

### Group C: Client Component Re-render Fixes

**Scope:** Fix memoization and dependency issues
**Files:** Client components and hooks
**Estimated Changes:** 6 files

#### Task C1: StandingsClient useEffect Dependencies
**File:** `apps/frontend/app/(authenticated)/league/[id]/standings/StandingsClient.tsx`
**Lines:** 244
**Issue:** State arrays in useEffect dependencies cause infinite subscription cycles
**Vercel Rule:** `rerender-dependencies`

**Current:**
```typescript
useEffect(() => {
  // subscription setup
}, [league.id, supabase, fetchParticipants, fetchDraftPicks, participants, draftPicks])
```

**Required Change:**
```typescript
useEffect(() => {
  // subscription setup
}, [league.id]) // Only depend on league ID, not state
```

---

#### Task C2: MoviePicker Derived State Memoization
**File:** `apps/frontend/app/(authenticated)/league/[id]/components/MoviePicker.tsx`
**Lines:** 84-108
**Issue:** `getFilteredMovies()` called on every render instead of memoized
**Vercel Rule:** `rerender-derived-state`

**Current:**
```typescript
const getFilteredMovies = useCallback(() => {
  let result = movies
  switch (activeTab) { ... }
  return result
}, [movies, activeTab, favoriteMovieIds])

const filteredMovies = getFilteredMovies() // Called every render!
```

**Required Change:**
```typescript
const filteredMovies = useMemo(() => {
  let result = movies
  switch (activeTab) { ... }
  return result
}, [movies, activeTab, favoriteMovieIds])
```

---

#### Task C3: BiddingPanel Memoization
**File:** `apps/frontend/app/(authenticated)/league/[id]/components/BiddingPanel.tsx`
**Lines:** 106-114
**Issue:** Array filters and reduce calculations not memoized
**Vercel Rule:** `rerender-memo`, `js-cache-function-results`

**Required Change:**
```typescript
const bidStats = useMemo(() => {
  const outbid = myBids.filter(b => b.status === 'outbid')
  const active = myBids.filter(b => b.status === 'active')
  const other = bids.filter(b => b.team_id !== teamId && b.status === 'active')
  return {
    outbidBids: outbid,
    activeBids: active,
    otherBids: other,
    totalPending: active.reduce((sum, b) => sum + b.amount, 0) +
                  outbid.reduce((sum, b) => sum + b.amount, 0)
  }
}, [myBids, bids, teamId])
```

---

#### Task C4: useBidding Hook Memoization
**File:** `apps/frontend/app/(authenticated)/league/[id]/hooks/useBidding.ts`
**Lines:** 30, 131
**Issues:**
1. Supabase client not memoized
2. `myBids` filter not memoized
**Vercel Rule:** `js-cache-function-results`

**Required Changes:**
```typescript
// Line 30
const supabase = useMemo(() => createClient(), [])

// Line 131
const myBids = useMemo(() =>
  bids.filter(bid => bid.team_id === teamId),
  [bids, teamId]
)
```

---

#### Task C5: MovieGrid Memoization
**File:** `apps/frontend/app/(authenticated)/league/[id]/components/MovieGrid.tsx`
**Lines:** 223-225
**Issue:** Three `.filter()` calls on every render
**Vercel Rule:** `js-cache-function-results`

**Required Change:**
```typescript
const moviesByStatus = useMemo(() => ({
  releasingSoon: movies.filter((m) => m.status === 'releasing_soon'),
  upcoming: movies.filter((m) => m.status === 'upcoming'),
  scored: movies.filter((m) => m.status === 'scored'),
}), [movies])
```

---

#### Task C6: useNotifications Memoization
**File:** `apps/frontend/hooks/useNotifications.ts`
**Line:** 82
**Issue:** Array filter for count on every render
**Vercel Rule:** `js-cache-function-results`

**Required Change:**
```typescript
const unreadCount = useMemo(
  () => notifications.reduce((count, n) => count + (n.read_at ? 0 : 1), 0),
  [notifications]
)
```

---

### Group D: Dynamic Imports (Bundle Size)

**Scope:** Code-split large modal components
**Files:** Components that import modals
**Estimated Changes:** 6 files

#### Task D1: CreateLeagueModal Dynamic Import
**File:** `apps/frontend/app/components/LeagueManager.tsx`
**Issue:** 211-line modal loaded on dashboard
**Vercel Rule:** `bundle-dynamic-imports`

**Required Change:**
```typescript
import dynamic from 'next/dynamic'

const CreateLeagueModal = dynamic(
  () => import('./CreateLeagueModal'),
  { loading: () => null }
)
```

---

#### Task D2: PlaceBidModal Dynamic Import
**File:** `apps/frontend/app/(authenticated)/league/[id]/components/BiddingPanel.tsx`
**Issue:** 448-line modal loaded on bidding page
**Vercel Rule:** `bundle-dynamic-imports`

---

#### Task D3: ProposeTradeModal Dynamic Import
**File:** `apps/frontend/app/(authenticated)/league/[id]/trading/TradingClient.tsx` (or parent)
**Issue:** 646-line modal (largest)
**Vercel Rule:** `bundle-dynamic-imports`

---

#### Task D4: MovieDetailModal Dynamic Import
**File:** Components that import MovieDetailModal
**Issue:** Complex modal with cast, reviews
**Vercel Rule:** `bundle-dynamic-imports`

---

#### Task D5: InvitationsList Dynamic Import
**File:** Settings or dashboard components
**Issue:** 376-line component with nested modals
**Vercel Rule:** `bundle-dynamic-imports`

---

#### Task D6: Navigation Barrel Import Fix
**File:** `apps/frontend/app/(authenticated)/layout.tsx`
**Issue:** Importing from barrel file
**Vercel Rule:** `bundle-barrel-imports`

**Current:**
```typescript
import { CinemaNav } from '../components/navigation'
```

**Required Change:**
```typescript
import CinemaNav from '../components/navigation/CinemaNav'
```

---

### Group E: Auth Token Caching (useTrading)

**Scope:** Fix credential fetch pattern in trading hook
**Files:** 1 file
**Estimated Changes:** 1 file

#### Task E1: Cache Auth Token in useTrading
**File:** `apps/frontend/app/(authenticated)/league/[id]/hooks/useTrading.ts`
**Lines:** 63-70, 251-257, 295-301, 331-337, 365-371
**Issue:** `getSession()` called in 5 different callbacks
**Vercel Rule:** `js-cache-function-results`

**Required Change:** Cache access token at hook level:
```typescript
const [accessToken, setAccessToken] = useState<string | null>(null)

useEffect(() => {
  const getToken = async () => {
    const { data } = await supabase.auth.getSession()
    setAccessToken(data.session?.access_token ?? null)
  }
  getToken()

  // Subscribe to auth changes
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
    setAccessToken(session?.access_token ?? null)
  })

  return () => subscription.unsubscribe()
}, [supabase.auth])

// Then use accessToken in all fetch calls
```

---

## Execution Plan

### Phase 1: Parallel Execution (Groups A-E)

| Group | Subagent | Files | Can Parallelize With |
|-------|----------|-------|---------------------|
| A (Waterfalls) | Implementer 1 | 8 page.tsx files | B, C, D, E |
| B (React.cache) | Implementer 2 | 2-3 utility files | A, C, D, E |
| C (Re-renders) | Implementer 3 | 6 client components | A, B, D, E |
| D (Dynamic Imports) | Implementer 4 | 6 import locations | A, B, C, E |
| E (Auth Caching) | Implementer 5 | 1 hook file | A, B, C, D |

**Note:** Groups A-E can execute in parallel as they touch different files.

### Phase 2: Review Cycle (Per Group)

For each completed group:
1. **Spec Compliance Review** - Verify implementation matches requirements
2. **Code Quality Review** - Check for clean code, proper TypeScript, no regressions
3. **Fix Loop** - If issues found, implementer fixes and re-review

### Phase 3: Integration Verification

After all groups complete:
1. Run full test suite
2. Verify no TypeScript errors
3. Manual smoke test of affected pages
4. Final code review of all changes

---

## Coordinator Responsibilities

As Tech Lead / Code Reviewer, I will:

1. **Dispatch Tasks** - Launch implementer subagents with full task context
2. **Answer Questions** - Clarify requirements before implementation begins
3. **Spec Review** - Verify each implementation matches the plan exactly
4. **Code Quality Review** - Check for:
   - Clean, readable code
   - Proper TypeScript types
   - No introduced bugs
   - Consistent patterns with existing codebase
   - No over-engineering
5. **Fix Coordination** - Direct fixes for any issues found
6. **Final Integration** - Ensure all changes work together

---

## Success Criteria

- [ ] All 8 server component waterfalls converted to `Promise.all()`
- [ ] `React.cache()` utilities created and integrated
- [ ] 6 re-render issues fixed with proper memoization
- [ ] 6 large modals converted to dynamic imports
- [ ] Auth token caching implemented in useTrading
- [ ] All TypeScript compiles without errors
- [ ] No runtime errors in affected pages
- [ ] Performance improvement measurable (optional: Lighthouse audit)

---

## Files Modified (Summary)

| Group | Files |
|-------|-------|
| A | layout.tsx, dashboard/page.tsx, standings/page.tsx, draft/page.tsx, roster/page.tsx, bidding/page.tsx, settings/page.tsx, trading/page.tsx |
| B | utils/supabase/cached.ts (NEW), (authenticated)/layout.tsx |
| C | StandingsClient.tsx, MoviePicker.tsx, BiddingPanel.tsx, useBidding.ts, MovieGrid.tsx, useNotifications.ts |
| D | LeagueManager.tsx, BiddingPanel.tsx, TradingClient.tsx, layout.tsx + 2 others |
| E | useTrading.ts |

**Total:** ~22 files modified, 1 new file created
