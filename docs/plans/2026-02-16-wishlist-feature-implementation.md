# Wishlist Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace localStorage draft favorites with a database-backed, account-wide movie wishlist that surfaces across draft board, bidding modal, and a dedicated `/wishlist` page.

**Architecture:** New `wishlisted_movies` table with RLS policies (direct Supabase CRUD, no Edge Function). Shared `useWishlist` hook provides global state. Shared `WishlistToggle` component ensures consistent heart behavior everywhere. SideNav gets a wishlist icon; new `/wishlist` page with league context filtering and league-mate wishlist viewing.

**Tech Stack:** Supabase PostgreSQL (RLS, security definer), React 19 hooks, Next.js 15 App Router, Tailwind CSS 4, lucide-react icons, sonner toasts.

**Design doc:** `docs/plans/2026-02-16-wishlist-feature-design.md`

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260216_create_wishlisted_movies.sql`

**Step 1: Write the migration**

```sql
-- Create wishlisted_movies table
CREATE TABLE wishlisted_movies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id    integer NOT NULL,
  title      text NOT NULL,
  poster_url text,
  added_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, tmdb_id)
);

CREATE INDEX idx_wishlisted_movies_user_id ON wishlisted_movies(user_id);
CREATE INDEX idx_wishlisted_movies_tmdb_id ON wishlisted_movies(tmdb_id);

-- Add wishlist_public toggle to profiles
ALTER TABLE profiles ADD COLUMN wishlist_public boolean NOT NULL DEFAULT false;

-- Enable RLS
ALTER TABLE wishlisted_movies ENABLE ROW LEVEL SECURITY;

-- Security definer helper for shared wishlist viewing
-- Lives in private schema to stay outside exposed API
CREATE OR REPLACE FUNCTION private.can_view_wishlist(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = target_user_id
      AND wishlist_public = true
    )
    AND
    EXISTS (
      SELECT 1 FROM public.league_participants lp1
      JOIN public.league_participants lp2
        ON lp1.league_id = lp2.league_id
      WHERE lp1.user_id = target_user_id
        AND lp2.user_id = (SELECT auth.uid())
        AND lp1.status = 'accepted'
        AND lp2.status = 'accepted'
    );
$$;

-- Own wishlist: full CRUD
CREATE POLICY "Users can manage own wishlist"
ON wishlisted_movies FOR ALL TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

-- Shared viewing: see league-mates' wishlists if they opted in
CREATE POLICY "Users can view shared wishlists"
ON wishlisted_movies FOR SELECT TO authenticated
USING ((SELECT private.can_view_wishlist(user_id)));
```

**Step 2: Apply migration**

Run: `npx supabase migration up`
Expected: Migration applied successfully, no data loss.

**Step 3: Verify in Supabase Studio**

Run: `open http://127.0.0.1:54323` and check:
- `wishlisted_movies` table exists with correct columns
- `profiles` table has `wishlist_public` column
- RLS is enabled on `wishlisted_movies`

**Step 4: Commit**

```bash
git add supabase/migrations/20260216_create_wishlisted_movies.sql
git commit -m "feat: add wishlisted_movies table with RLS policies"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `apps/frontend/types/index.ts` (add WishlistedMovie interface near TMDbSearchResult at line ~211)

**Step 1: Add the WishlistedMovie type**

Add after the `TMDbSearchResult` interface (line ~211):

```typescript
export interface WishlistedMovie {
  id: string
  user_id: string
  tmdb_id: number
  title: string
  poster_url: string | null
  added_at: string
}
```

**Step 2: Update Profile type**

Find the `Profile` interface and add `wishlist_public`:

```typescript
wishlist_public: boolean
```

**Step 3: Commit**

```bash
git add apps/frontend/types/index.ts
git commit -m "feat: add WishlistedMovie type and wishlist_public to Profile"
```

---

## Task 3: CSS Animations

**Files:**
- Modify: `apps/frontend/app/globals.css`

**Step 1: Add heart animation keyframes**

Insert after the `shimmer` keyframe (after line 92, before `/* === BASE LAYER === */`):

```css
@keyframes heart-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

@keyframes heart-shrink {
  0% { transform: scale(1); }
  50% { transform: scale(0.9); }
  100% { transform: scale(1); }
}

@keyframes slide-out-down {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(8px) scale(0.95); }
}
```

**Step 2: Add animation tokens to `@theme`**

Insert after `--animate-shimmer` (line 70):

```css
--animate-heart-pop: heart-pop 0.3s ease-out;
--animate-heart-shrink: heart-shrink 0.2s ease-out;
--animate-slide-out-down: slide-out-down 0.25s ease-out forwards;
```

**Step 3: Commit**

```bash
git add apps/frontend/app/globals.css
git commit -m "feat: add heart-pop and slide-out-down animations for wishlist"
```

---

## Task 4: `useWishlist` Hook

**Files:**
- Create: `apps/frontend/hooks/useWishlist.ts`

**Step 1: Write the hook**

```typescript
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { TMDbSearchResult } from '@/types'
import { createClient } from '@/utils/supabase/client'

interface UseWishlistReturn {
  wishlistedIds: Set<number>
  isLoading: boolean
  toggleWishlist: (movie: TMDbSearchResult) => void
  isWishlisted: (tmdbId: number) => boolean
}

export function useWishlist(): UseWishlistReturn {
  const [wishlistedIds, setWishlistedIds] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const pendingRef = useRef<Map<number, NodeJS.Timeout>>(new Map())
  const supabase = createClient()

  // Fetch wishlist on mount
  useEffect(() => {
    async function fetchWishlist() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setIsLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('wishlisted_movies')
        .select('tmdb_id')
        .eq('user_id', user.id)

      if (!error && data) {
        setWishlistedIds(new Set(data.map(row => row.tmdb_id)))
      }
      setIsLoading(false)
    }

    fetchWishlist()
  }, [supabase])

  const isWishlisted = useCallback(
    (tmdbId: number) => wishlistedIds.has(tmdbId),
    [wishlistedIds]
  )

  const toggleWishlist = useCallback(
    (movie: TMDbSearchResult) => {
      const tmdbId = movie.tmdb_id

      // Clear any pending debounce for this movie
      const existing = pendingRef.current.get(tmdbId)
      if (existing) clearTimeout(existing)

      // Optimistic update
      setWishlistedIds(prev => {
        const next = new Set(prev)
        if (next.has(tmdbId)) {
          next.delete(tmdbId)
        } else {
          next.add(tmdbId)
        }
        return next
      })

      // Debounce the API call (500ms)
      const timeout = setTimeout(async () => {
        pendingRef.current.delete(tmdbId)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Check what the final desired state is
        const shouldBeWishlisted = wishlistedIds.has(tmdbId)
          ? false // was in set before optimistic toggle
          : true

        // Actually, read from current state at time of execution
        // We need to check the current set state
        setWishlistedIds(current => {
          const isCurrentlyIn = current.has(tmdbId)

          if (isCurrentlyIn) {
            // Should be in DB — insert
            supabase
              .from('wishlisted_movies')
              .upsert(
                {
                  user_id: user.id,
                  tmdb_id: tmdbId,
                  title: movie.title,
                  poster_url: movie.poster_url,
                },
                { onConflict: 'user_id,tmdb_id' }
              )
              .then(({ error }) => {
                if (error) {
                  // Rollback
                  setWishlistedIds(prev => {
                    const rolled = new Set(prev)
                    rolled.delete(tmdbId)
                    return rolled
                  })
                }
              })
          } else {
            // Should NOT be in DB — delete
            supabase
              .from('wishlisted_movies')
              .delete()
              .eq('user_id', user.id)
              .eq('tmdb_id', tmdbId)
              .then(({ error }) => {
                if (error) {
                  // Rollback
                  setWishlistedIds(prev => {
                    const rolled = new Set(prev)
                    rolled.add(tmdbId)
                    return rolled
                  })
                }
              })
          }

          return current // don't change state in this read
        })
      }, 500)

      pendingRef.current.set(tmdbId, timeout)
    },
    [supabase, wishlistedIds]
  )

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      pendingRef.current.forEach(timeout => clearTimeout(timeout))
    }
  }, [])

  return { wishlistedIds, isLoading, toggleWishlist, isWishlisted }
}
```

**Note:** The debounce + optimistic pattern is tricky. The implementer should test rapid toggling carefully and may need to simplify — a simpler approach is to skip debounce and just use optimistic update + rollback without the 500ms delay, relying on `useAsyncAction` for double-click protection instead. Use judgment during implementation.

**Step 2: Commit**

```bash
git add apps/frontend/hooks/useWishlist.ts
git commit -m "feat: add useWishlist hook with optimistic updates"
```

---

## Task 5: `WishlistToggle` Shared Component

**Files:**
- Create: `apps/frontend/components/WishlistToggle.tsx`

**Step 1: Write the component**

```typescript
'use client'

import { useCallback, useState } from 'react'
import { Heart } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/utils/cn'
import { useWishlist } from '@/hooks/useWishlist'
import type { TMDbSearchResult } from '@/types'

interface WishlistToggleProps {
  movie: TMDbSearchResult
  size?: 'sm' | 'md'
  variant?: 'overlay' | 'inline'
  className?: string
}

export default function WishlistToggle({
  movie,
  size = 'sm',
  variant = 'overlay',
  className,
}: WishlistToggleProps) {
  const { isWishlisted, toggleWishlist } = useWishlist()
  const wishlisted = isWishlisted(movie.tmdb_id)
  const [animating, setAnimating] = useState<'pop' | 'shrink' | null>(null)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()

      const wasWishlisted = wishlisted
      setAnimating(wasWishlisted ? 'shrink' : 'pop')
      toggleWishlist(movie)

      if (!wasWishlisted) {
        toast('Added to Wishlist', {
          action: {
            label: 'View',
            onClick: () => window.location.assign('/wishlist'),
          },
        })
      }

      // Clear animation class after it completes
      setTimeout(() => setAnimating(null), wasWishlisted ? 200 : 300)
    },
    [wishlisted, toggleWishlist, movie]
  )

  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'
  const padding = size === 'sm' ? 'p-1.5' : 'p-2'

  const overlayStyles = wishlisted
    ? 'bg-crimson text-white'
    : 'bg-background/60 backdrop-blur-sm text-foreground-muted hover:text-crimson hover:bg-background/80'

  const inlineStyles = wishlisted
    ? 'text-crimson'
    : 'text-foreground-muted hover:text-crimson'

  return (
    <button
      onClick={handleClick}
      className={cn(
        'rounded-full transition-all',
        padding,
        variant === 'overlay' ? overlayStyles : inlineStyles,
        animating === 'pop' && 'animate-heart-pop',
        animating === 'shrink' && 'animate-heart-shrink',
        className
      )}
      aria-label={`Wishlist ${movie.title}`}
      aria-pressed={wishlisted}
    >
      <Heart
        className={iconSize}
        fill={wishlisted ? 'currentColor' : 'none'}
        strokeWidth={wishlisted ? 0 : 2}
      />
      <span className="sr-only">{movie.title}</span>
    </button>
  )
}
```

**Step 2: Verify `cn` utility exists**

Check: `apps/frontend/utils/cn.ts` — if it doesn't exist, create it:

```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

**Step 3: Commit**

```bash
git add apps/frontend/components/WishlistToggle.tsx
git commit -m "feat: add WishlistToggle shared component with animations and a11y"
```

---

## Task 6: Aria-Live Region

**Files:**
- Modify: `apps/frontend/app/(authenticated)/layout.tsx` (line 22-28)

**Step 1: Add aria-live region for wishlist announcements**

This is a single invisible div at the app level. The `WishlistToggle` component (or a context provider) will update its text content. For now, sonner toasts handle announcements (sonner uses `role="status"` by default). If needed, add a dedicated region later.

**Skip this task** — sonner's built-in `role="status"` and `aria-live="polite"` handles announcements. No code change needed.

---

## Task 7: Wire Up Draft Board

Replace localStorage favorites with `useWishlist` hook in the draft flow.

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/draft/DraftClient.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/DraftBoard.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/MoviePicker.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/DraftMovieCard.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/MovieQuickPreview.tsx`

### Step 1: Update DraftClient.tsx

**Remove** (lines 102-131): The `favoriteMovieIds` state, the localStorage `useEffect`, and the `handleToggleFavorite` callback (lines 272-282).

**Remove** from the `<DraftBoard>` JSX (lines 390-400): `favoriteMovieIds` and `onToggleFavorite` props.

The DraftClient no longer manages favorites. The `useWishlist` hook is called inside `MoviePicker` and `WishlistToggle` directly.

### Step 2: Update DraftBoard.tsx

**Remove** from Props interface (lines 16-26): `favoriteMovieIds` and `onToggleFavorite`.

**Remove** from destructured props (lines 28-38): `favoriteMovieIds` and `onToggleFavorite`.

**Remove** from `<MoviePicker>` JSX: `favoriteMovieIds` and `onToggleFavorite` props.

### Step 3: Update MoviePicker.tsx

**Remove** from Props interface (lines 12-19): `favoriteMovieIds` and `onToggleFavorite`.

**Import** `useWishlist` at top of file:
```typescript
import { useWishlist } from '@/hooks/useWishlist'
```

**Add** inside component body:
```typescript
const { wishlistedIds, isWishlisted, toggleWishlist } = useWishlist()
```

**Rename** tab config (lines 21-28):
- Change `'favorites'` to `'wishlist'` in `TabType` union
- Change label from `'Favorites'` to `'Wishlist'`
- Update `getTabIcon` case from `'favorites'` to `'wishlist'`

**Update** empty state (line 52): Change `'favorites'` check to `'wishlist'`, update message to `'Your wishlist is empty. Heart movies to add them here!'`

**Update** filtering logic (lines 110-111): Change `'favorites'` case to `'wishlist'`, replace `favoriteMovieIds` with `wishlistedIds`.

**Update** badge (lines 194-202): Replace `favoriteMovieIds.size` with `wishlistedIds.size`, change `tab.id === 'favorites'` to `tab.id === 'wishlist'`.

**Update** DraftMovieCard rendering (lines 251-260): Replace `isFavorite={favoriteMovieIds.has(...)}` and `onToggleFavorite={handleToggleFavorite}` — actually, remove these props entirely since `DraftMovieCard` will use `WishlistToggle` internally.

**Update** MovieQuickPreview rendering (lines 342-351): Same — remove `isFavorite` and `onToggleFavorite` props.

### Step 4: Update DraftMovieCard.tsx

**Remove** from Props interface (lines 9-17): `isFavorite` and `onToggleFavorite`.

**Remove** the `handleFavoriteClick` function (lines 43-46).

**Replace** the heart button block (lines 125-138) with:
```typescript
{!isDrafted && (
  <WishlistToggle movie={movie} size="sm" variant="overlay" />
)}
```

**Add import** at top:
```typescript
import WishlistToggle from '@/components/WishlistToggle'
```

### Step 5: Update MovieQuickPreview.tsx

**Remove** from Props interface (lines 12-20): `isFavorite` and `onToggleFavorite`.

**Replace** the heart button block (lines 126-138) with:
```typescript
<WishlistToggle movie={movie} size="md" variant="overlay" className="absolute top-2 right-2" />
```

**Add import** at top:
```typescript
import WishlistToggle from '@/components/WishlistToggle'
```

### Step 6: Commit

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/draft/DraftClient.tsx \
  apps/frontend/app/\(authenticated\)/league/\[id\]/components/DraftBoard.tsx \
  apps/frontend/app/\(authenticated\)/league/\[id\]/components/MoviePicker.tsx \
  apps/frontend/app/\(authenticated\)/league/\[id\]/components/DraftMovieCard.tsx \
  apps/frontend/app/\(authenticated\)/league/\[id\]/components/MovieQuickPreview.tsx
git commit -m "refactor: replace localStorage favorites with useWishlist hook on draft board"
```

---

## Task 8: Wire Up Bidding Modal

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/PlaceBidModal.tsx`

### Step 1: Add WishlistToggle to movie results

**Add import:**
```typescript
import WishlistToggle from '@/components/WishlistToggle'
```

Find where movie results are rendered as cards/rows in the modal (the section that maps over `results`). Add `<WishlistToggle movie={movie} size="sm" variant="overlay" />` to each movie card, positioned the same way as on `DraftMovieCard`.

### Step 2: Add "Wishlisted" filter toggle

**Add import:**
```typescript
import { useWishlist } from '@/hooks/useWishlist'
```

**Add** inside component:
```typescript
const { isWishlisted } = useWishlist()
const [showWishlistedOnly, setShowWishlistedOnly] = useState(false)
```

**Filter** results before rendering:
```typescript
const displayedResults = showWishlistedOnly
  ? results.filter(m => isWishlisted(m.tmdb_id))
  : results
```

**Add** a toggle button in the search/filter area:
```typescript
<button
  onClick={() => setShowWishlistedOnly(prev => !prev)}
  className={cn(
    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all',
    showWishlistedOnly
      ? 'bg-crimson/20 text-crimson border border-crimson/30'
      : 'bg-elevated text-foreground-muted border border-border hover:border-border-hover'
  )}
  aria-pressed={showWishlistedOnly}
>
  <Heart className="w-3.5 h-3.5" fill={showWishlistedOnly ? 'currentColor' : 'none'} />
  Wishlisted
</button>
```

### Step 3: Commit

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/components/PlaceBidModal.tsx
git commit -m "feat: add wishlist integration to bidding modal"
```

---

## Task 9: Navigation Entry

**Files:**
- Modify: `apps/frontend/app/components/navigation/SideNav.tsx` (lines 87-91 globalItems, lines 248-251 mobile actions)

### Step 1: Add Wishlist to globalItems

**Add import** (line 13, with other lucide imports):
```typescript
Heart,
```

**Add** to `globalItems` array (after line 89, the Movies entry):
```typescript
{ label: 'Wishlist', href: '/wishlist', icon: <Heart className="w-5 h-5" /> },
```

This adds the wishlist to both desktop sidebar and mobile drawer (since `globalItems` is used by `renderSidebarContent` which renders both).

### Step 2: Commit

```bash
git add apps/frontend/app/components/navigation/SideNav.tsx
git commit -m "feat: add Wishlist to sidebar navigation"
```

---

## Task 10: Dedicated `/wishlist` Page — Basic Structure

**Files:**
- Create: `apps/frontend/app/(authenticated)/wishlist/page.tsx`
- Create: `apps/frontend/app/(authenticated)/wishlist/WishlistClient.tsx`

### Step 1: Create the page server component

`page.tsx`:
```typescript
import { getCachedUser } from '@/utils/supabase/cached'
import { redirect } from 'next/navigation'
import WishlistClient from './WishlistClient'

export const metadata = {
  title: 'Wishlist | Fantasy Reel',
}

export default async function WishlistPage() {
  const { data: { user } } = await getCachedUser()
  if (!user) redirect('/login')

  return <WishlistClient userId={user.id} />
}
```

### Step 2: Create the client component

`WishlistClient.tsx` — the main wishlist page with:
- Movie grid showing all wishlisted movies
- Sort options (date added, release date, title)
- Remove button on each card (hover + focus visible)
- Staggered card entrance animation
- Empty state with illustration and "Explore Movies" CTA
- Settings gear icon in header for sharing toggle
- League context dropdown (fetches user's leagues, annotates movies when selected)

This is the largest single component. It should:
1. Fetch full wishlist data: `supabase.from('wishlisted_movies').select('*').eq('user_id', userId).order('added_at', { ascending: false })`
2. Fetch user's leagues for the dropdown: `supabase.from('league_participants').select('league_id, leagues(id, name, status)').eq('user_id', userId).eq('status', 'accepted')`
3. When a league is selected, fetch draft picks for that league to determine movie status
4. Render movie cards with poster, title, release date, and contextual badges

**Implementation note:** This is a substantial component. The implementer should build it incrementally:
- First: basic grid with movie data, remove action, empty state
- Second: sort options
- Third: league context dropdown + annotations
- Fourth: sharing toggle
- Fifth: staggered animations

### Step 3: Commit

```bash
git add apps/frontend/app/\(authenticated\)/wishlist/
git commit -m "feat: add dedicated /wishlist page with movie grid and league context"
```

---

## Task 11: League-Mate Wishlists Tab

**Files:**
- Modify: `apps/frontend/app/(authenticated)/wishlist/WishlistClient.tsx`

### Step 1: Add "League Wishlists" tab

When a league is selected in the dropdown, show two tabs: "My Wishlist" and "League Wishlists".

"League Wishlists" tab:
1. Fetch league-mates who have `wishlist_public = true`:
   ```typescript
   supabase
     .from('league_participants')
     .select('user_id, profiles(display_name, avatar_url, wishlist_public)')
     .eq('league_id', selectedLeagueId)
     .eq('status', 'accepted')
     .neq('user_id', userId)
   ```
2. Filter to those with `wishlist_public = true`
3. Show list of league-mates with avatar, name, wishlist count
4. Click through to view their wishlist (read-only) with league context annotations
5. Overlap indicator: "You both want this" badge on movies in both wishlists

### Step 2: Commit

```bash
git add apps/frontend/app/\(authenticated\)/wishlist/WishlistClient.tsx
git commit -m "feat: add league-mate wishlists tab with overlap indicators"
```

---

## Task 12: Dashboard Nudge Card

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/dashboard/DashboardClient.tsx`

### Step 1: Add wishlist nudge

After the main dashboard content, add a compact card:

```typescript
// Fetch count of league-mates with public wishlists
// Show: "X league-mates have shared their wishlists" with link to /wishlist
```

This is a small, self-contained card. Only show it if at least 1 league-mate has a public wishlist.

### Step 2: Commit

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/dashboard/DashboardClient.tsx
git commit -m "feat: add league-mate wishlist nudge to dashboard"
```

---

## Task 13: localStorage Migration

**Files:**
- Modify: `apps/frontend/hooks/useWishlist.ts`

### Step 1: Add migration logic to useWishlist

Inside the `useEffect` that fetches the wishlist on mount, after fetching from DB, check localStorage for any legacy favorites and migrate them:

```typescript
// After fetching wishlist from DB...
// Migrate localStorage favorites if they exist
if (typeof window !== 'undefined') {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('draft-favorites-'))
  for (const key of keys) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '[]')
      if (Array.isArray(stored) && stored.length > 0) {
        // These are tmdb_ids — we don't have titles/posters in localStorage
        // so we can't migrate them with full data. Options:
        // A) Skip migration (they'll re-heart them)
        // B) Insert with tmdb_id only, fetch details later
        // For simplicity, skip — user will re-heart from DB-backed system
        localStorage.removeItem(key)
      }
    } catch {
      localStorage.removeItem(key)
    }
  }
}
```

**Note:** localStorage favorites only store `tmdb_id` numbers, not movie titles or posters. Since our DB table requires `title` (NOT NULL), we can't do a silent migration without fetching movie details from TMDb. The pragmatic choice is to simply clear the old localStorage keys so the user starts fresh with the new system. If the user had favorites, they'll see the "Wishlist" tab is empty and can re-heart movies.

### Step 2: Commit

```bash
git add apps/frontend/hooks/useWishlist.ts
git commit -m "feat: clear legacy localStorage favorites on wishlist init"
```

---

## Task 14: Code Simplifier Pass

**Files:**
- All files modified in Tasks 1-13

### Step 1: Run code-simplifier

Run the `code-simplifier:code-simplifier` agent on all modified files. Focus on:
- Removing dead code from the favorites→wishlist migration
- Ensuring consistent naming (no remaining `favorite` references)
- Simplifying the `useWishlist` hook if the debounce pattern is overly complex

### Step 2: Commit

```bash
git add -A
git commit -m "refactor: simplify wishlist code after code-simplifier pass"
```

---

## Task 15: Browser Verification

### Step 1: Restart dev server

```bash
npm run dev
```

### Step 2: Log in and test

Use browser automation (`mcp__claude-in-chrome__*`) to:

1. Navigate to `http://localhost:3000/login`
2. Log in as `alice@fantasyreel.test` / `testpass123!`
3. Navigate to `/wishlist` — verify empty state renders
4. Navigate to `/movies` or a league's draft board
5. Heart a movie — verify toast appears, heart animates
6. Navigate to `/wishlist` — verify movie appears in grid
7. Select a league from dropdown — verify context annotations
8. Remove a movie — verify card animates out
9. Check sidebar nav — verify Wishlist link is present and active
10. Check console for errors

### Step 3: Commit any fixes

```bash
git add -A
git commit -m "fix: address issues found during wishlist browser verification"
```

---

## Execution Order Summary

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Database migration | — |
| 2 | TypeScript types | — |
| 3 | CSS animations | — |
| 4 | `useWishlist` hook | 1, 2 |
| 5 | `WishlistToggle` component | 3, 4 |
| 6 | Aria-live region (skipped) | — |
| 7 | Wire up draft board | 4, 5 |
| 8 | Wire up bidding modal | 5 |
| 9 | Navigation entry | — |
| 10 | `/wishlist` page | 4, 5 |
| 11 | League-mate wishlists tab | 10 |
| 12 | Dashboard nudge card | — |
| 13 | localStorage migration | 4 |
| 14 | Code simplifier pass | 7-13 |
| 15 | Browser verification | 14 |

**Parallelizable groups:**
- Tasks 1, 2, 3, 9 can run in parallel (no dependencies on each other)
- Tasks 7, 8, 10, 12 can run in parallel after 4+5 complete
- Tasks 11, 13 depend on their predecessors
- Tasks 14, 15 are sequential at the end
