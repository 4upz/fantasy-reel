-- ============================================================================
-- Migration: Create wishlisted_movies table and wishlist visibility
--
-- 1. Creates wishlisted_movies table (user <-> tmdb movie wishlist)
-- 2. Adds wishlist_public boolean column to profiles
-- 3. Enables RLS on wishlisted_movies
-- 4. Creates private.can_view_wishlist() security definer helper
-- 5. Creates RLS policies for own management + shared viewing
-- ============================================================================

-- ============================================================================
-- PART 1: wishlisted_movies table
-- ============================================================================

CREATE TABLE IF NOT EXISTS wishlisted_movies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id    integer NOT NULL,
  title      text NOT NULL,
  poster_url text,
  added_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tmdb_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlisted_movies_user_id ON wishlisted_movies(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlisted_movies_tmdb_id ON wishlisted_movies(tmdb_id);

-- ============================================================================
-- PART 2: Add wishlist_public column to profiles
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wishlist_public boolean NOT NULL DEFAULT false;

-- ============================================================================
-- PART 3: Enable RLS
-- ============================================================================

ALTER TABLE wishlisted_movies ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 4: Security definer helper function
-- Checks if the target user has wishlist_public = true AND the querying user
-- shares at least one league with them (both with status = 'active').
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.can_view_wishlist(target_user_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = target_user_id
      AND p.wishlist_public = true
  )
  AND EXISTS (
    SELECT 1
    FROM public.league_participants lp1
    JOIN public.league_participants lp2
      ON lp1.league_id = lp2.league_id
    WHERE lp1.user_id = target_user_id
      AND lp1.status = 'active'
      AND lp2.user_id = (SELECT auth.uid())
      AND lp2.status = 'active'
  )
$$;

-- ============================================================================
-- PART 5: RLS Policies
-- ============================================================================

-- Users can manage (select, insert, update, delete) their own wishlist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can manage own wishlist' AND tablename = 'wishlisted_movies') THEN
    CREATE POLICY "Users can manage own wishlist"
      ON wishlisted_movies
      FOR ALL
      TO authenticated
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

-- Users can view wishlists of league-mates who have opted in
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view shared wishlists' AND tablename = 'wishlisted_movies') THEN
    CREATE POLICY "Users can view shared wishlists"
      ON wishlisted_movies
      FOR SELECT
      TO authenticated
      USING (private.can_view_wishlist(user_id));
  END IF;
END $$;
