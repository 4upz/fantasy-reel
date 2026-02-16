# Wishlist Feature Design

## Overview

Database-backed, account-wide movie wishlist that replaces the existing localStorage-based draft favorites. Users can heart movies anywhere in the app to track them for drafting, bidding, or general interest. Private by default with opt-in sharing to league-mates.

## Requirements

- **Scope:** Global (account-wide), not per-league
- **Visibility:** Private by default, single global toggle to share with league-mates
- **Surfaces:** Draft board (replaces localStorage favorites), bidding modal, dedicated `/wishlist` page, league-mate viewing
- **League context:** When viewing within a league, movies annotated with status (drafted, available, on roster, etc.)

---

## Data Model

### New table: `wishlisted_movies`

```sql
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
```

### Profile column addition

```sql
ALTER TABLE profiles ADD COLUMN wishlist_public boolean NOT NULL DEFAULT false;
```

### Design decisions

- Stores `tmdb_id` + `title` + `poster_url` directly (not FK to `movies` table) because users may wishlist movies before anyone drafts them into the DB.
- `UNIQUE (user_id, tmdb_id)` prevents duplicates and enables upsert-style toggle.
- `ON DELETE CASCADE` cleans up wishlist if user is deleted.
- JOIN to `movies` table on `tmdb_id` when league context is needed (draft status, scores).

---

## RLS Policies & Security

### Policies

```sql
ALTER TABLE wishlisted_movies ENABLE ROW LEVEL SECURITY;

-- Own wishlist: full CRUD
CREATE POLICY "Users can manage own wishlist"
ON wishlisted_movies FOR ALL TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

-- Shared viewing
CREATE POLICY "Users can view shared wishlists"
ON wishlisted_movies FOR SELECT TO authenticated
USING ((select private.can_view_wishlist(user_id)));
```

### Security definer helper

```sql
CREATE FUNCTION private.can_view_wishlist(target_user_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = ''
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
        AND lp2.user_id = (select auth.uid())
        AND lp1.status = 'accepted'
        AND lp2.status = 'accepted'
    );
$$;
```

### Design decisions

- Two separate policies: `FOR ALL` for own CRUD, `FOR SELECT` for shared viewing. Postgres ORs together SELECT policies.
- Security definer function in `private` schema avoids RLS recursion on profiles/league_participants.
- `status = 'accepted'` ensures only active league members count.
- `(select auth.uid())` wrapping for per-statement caching (Supabase perf best practice).
- `TO authenticated` skips evaluation for anon users.

---

## Client-Side Data Access

### Hook: `useWishlist` (shared, not league-scoped)

**Location:** `apps/frontend/hooks/useWishlist.ts`

```typescript
function useWishlist() {
  return {
    wishlistedIds: Set<number>,       // set of tmdb_ids for O(1) lookup
    isLoading: boolean,
    toggleWishlist: (movie: TMDbSearchResult) => Promise<void>,
    isWishlisted: (tmdbId: number) => boolean,
  }
}
```

### Data flow

1. **On mount:** Fetch user's wishlist via `supabase.from('wishlisted_movies').select('tmdb_id, title, poster_url').eq('user_id', userId)`. Build `Set<number>` of tmdb_ids.
2. **Toggle add:** `supabase.from('wishlisted_movies').insert(...)`. Add to local set optimistically.
3. **Toggle remove:** `supabase.from('wishlisted_movies').delete().eq(...).eq(...)`. Remove from local set optimistically.
4. **Optimistic updates** with rollback on error.
5. **Debounce rapid toggles** (500ms) — only send final state to prevent race conditions.
6. **Error handling:** Roll back optimistic update, show toast error.

### Design decisions

- Shared hook in `hooks/` (not `league/[id]/hooks/`) since wishlist is global.
- Stores only `tmdb_id`s in the set for toggle checks. Full movie data fetched separately for rendering.
- No Realtime subscription needed for own wishlist (personal data, page refresh syncs).
- Replaces `DraftClient.tsx` localStorage logic entirely.

---

## Shared Component: `WishlistToggle`

**Location:** `apps/frontend/components/WishlistToggle.tsx`

Single source of truth for heart icon behavior across all surfaces.

### Props

```typescript
interface WishlistToggleProps {
  movie: TMDbSearchResult
  size?: 'sm' | 'md'        // sm for card overlays, md for modals/list views
  variant?: 'overlay' | 'inline'  // overlay for poster-positioned, inline for list views
}
```

### Behavior

- Uses `useWishlist()` hook internally for state and toggle action.
- Uses `useAsyncAction` for double-click protection.
- **Optimistic update:** Visual state changes immediately on click, rolls back on error.
- **Animation:** Scale 1 -> 1.3 -> 1 on add (~300ms ease-out), scale 1 -> 0.9 -> 1 on remove (~200ms).
- **Toast feedback:** Shows "Added to Wishlist" with "View" link on add, "Removed from Wishlist" on remove.
- **Debounce:** 500ms debounce on rapid toggles, only sends final state.

### Accessibility

- `aria-pressed={isWishlisted}` (toggle button pattern).
- `aria-label="Wishlist [Movie Title]"` (stable label, state communicated via pressed).
- Visually hidden `<span className="sr-only">` with movie title.
- `aria-live="polite"` region (single instance at app level) announces state changes.
- Reachable via Tab, activatable with Enter/Space.

### Animation keyframe

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
```

---

## UI Surfaces

### Surface 1: Heart icon on movie cards

**Files:** `DraftMovieCard.tsx`, `MovieQuickPreview.tsx`, any future movie card components.

- Replace inline heart logic with shared `<WishlistToggle>` component.
- No visual change to card layout; heart remains in same position.
- Works on draft board, bidding modal, movies page, wishlist page.

### Surface 2: Draft board "Wishlist" tab (renamed from "Favorites")

**File:** `MoviePicker.tsx`

- Rename "Favorites" tab to "Wishlist" (icon remains HeartIcon).
- Replace localStorage filtering with query from `useWishlist`.
- Still filters out already-drafted movies.
- **Badge enhancement:** When a wishlisted movie becomes available during draft, badge briefly glows gold using `animate-glow-pulse`.
- **Empty state:** "Your wishlist is empty. Heart movies to add them here!" with outlined heart + film strip illustration and "Browse All Movies" button.

### Surface 3: Bidding modal integration

**File:** `PlaceBidModal.tsx` (movie browse/search within the modal)

- Add `<WishlistToggle>` to movie cards in the browse/search results.
- Add "Wishlisted" filter toggle to filter results to only wishlisted movies.
- Do NOT add heart badges to `BidCard` components (existing bids) — visual noise with no actionable value.
- **Bidding panel nudge:** In `BiddingPanel.tsx`, show "You have X wishlisted movies available for bidding" when applicable.

### Surface 4: Dedicated `/wishlist` page

**Route:** `/wishlist` (top-level authenticated route)

#### Layout

- **Page header:** Title "Wishlist" + wishlist count + settings gear icon (sharing toggle inside).
- **League context dropdown:** Defaults to "All Leagues" (no annotations). Selecting a league adds per-movie status badges. Stored in `sessionStorage`.
- **Movie grid:** Poster cards with title, release date. Remove (X) button appears on hover AND focus (`group-focus-within:opacity-100`).
- **Bulk actions:** Select-all checkbox, "Clear drafted movies" quick action.
- **Sort options:** Date added (default), release date, title A-Z.

#### League context annotations (when league selected)

| Badge | Condition | Color |
|-------|-----------|-------|
| Available | Not drafted by anyone | Green (success) |
| On Your Roster | You drafted this | Gold |
| Drafted by [Team] | Someone else has it | Muted gray |
| Up for Bidding | Available in bidding phase | Warning yellow |

#### Quick action

When a movie shows "Available" and the selected league is in drafting/bidding phase, show a "Draft" or "Place Bid" link that navigates to the relevant league page.

#### Empty state

"Your wishlist is empty. Browse upcoming movies and heart the ones you want to track." with cinematic illustration (film reel with hearts) and "Explore Movies" button linking to `/movies`.

#### Progressive disclosure

- Default view is clean movie grid with no league annotations.
- League annotations only appear after selecting a league from dropdown.
- Sharing toggle is behind settings gear (one-time config, not prime real estate).

### Surface 5: League-mate wishlists

**Primary location:** `/wishlist` page, "League Wishlists" tab.

- When a league is selected in the dropdown, show a secondary tab: "League Wishlists".
- Lists league-mates who have public wishlists with movie count.
- Click through to view their wishlist (read-only, annotated with league context).
- **Overlap indicator:** Movies that overlap with your wishlist get a "You both want this" badge.

**Dashboard nudge:** Compact card on league dashboard: "X league-mates have shared their wishlists" with link. Not a full wishlist display.

### Surface 6: Navigation entry

**File:** `CinemaNav.tsx`

- **Desktop:** Heart icon button in the right side of nav bar (alongside NotificationBell). Badge count showing wishlist size.
- **Mobile:** "Wishlist" link in `NavMobileDrawer.tsx` between "Movies" and "Settings".
- Badge has `aria-label="Wishlist, X movies"`.

---

## Micro-Interactions & Delight

### Heart toggle

- **Add:** Scale pop animation (1 -> 1.3 -> 1, 300ms ease-out) + fill to crimson.
- **Remove:** Lighter scale (1 -> 0.9 -> 1, 200ms) + unfill.
- **First ever add:** Brief gold sparkle particle effect (500ms). Subsequent adds use only scale.
- **Toast:** "Added to Wishlist" with "View" link / "Removed from Wishlist".

### Wishlist page

- **Card entrance:** Staggered `animate-slide-up` with 50ms delays ("curtain rise" effect).
- **Card removal:** Fade + shrink animation (~250ms) before removing from DOM.
- **Empty-to-populated:** Empty state illustration fades out, first card fades in.

### Draft board nudges

- **"X of your wishlist is available"** gold-accented banner on draft board during active draft.
- **Wishlist tab glow:** When a wishlisted movie is still available after previous picker's turn, tab badge glows gold (`animate-glow-pulse`).
- **Post-draft cleanup prompt:** "X movies from your wishlist went undrafted. Remove them or keep them for bidding?"

### Social

- **Overlap indicator** on league-mate wishlists: "You both want this" badge.
- **No real-time notifications** for others' wishlist changes (avoids social pressure / copycat drafting).

---

## Accessibility Requirements

| Element | Requirement |
|---------|-------------|
| Heart button | `aria-pressed`, `aria-label="Wishlist [Movie Title]"`, `sr-only` span |
| State changes | `aria-live="polite"` region at app level for add/remove/error announcements |
| Movie grid | Focusable cards with visible gold focus ring (`:focus-visible`) |
| Remove button | Visible on focus AND hover (`group-focus-within:opacity-100`) |
| League dropdown | Native `<select>` or fully ARIA-compliant custom (`role="listbox"`) |
| Nav badge | `aria-label="Wishlist, X movies"` with dynamic count |
| Error states | Announced via `aria-live` region |

---

## Migration from localStorage

On first load after feature ships:

1. Read `draft-favorites-{leagueId}` keys from localStorage.
2. For each tmdb_id found, insert into `wishlisted_movies` (skip duplicates via `ON CONFLICT DO NOTHING`).
3. Clear localStorage keys after successful migration.
4. No UI for this — invisible to user.
5. Handle edge cases: skip tmdb_ids that fail validation.

---

## Prop/Variable Renaming

Rename across codebase for consistency:

| Old | New |
|-----|-----|
| `favoriteMovieIds` | `wishlistedIds` |
| `onToggleFavorite` | `onToggleWishlist` |
| `isFavorite` | `isWishlisted` |
| `setFavoriteMovieIds` | removed (managed by hook) |
| `draft-favorites-{id}` localStorage key | removed (migrated to DB) |

---

## Out of Scope (Future Iteration)

- Wishlist "heat map" for league owners (most-wishlisted movies across participants)
- Bulk import/export of wishlists
- Wishlist sharing via link (non-league-mate viewing)
- Notifications when a wishlisted movie's scores update
