-- Fix: can_view_wishlist used 'accepted' but league_participants.status
-- only allows 'pending' | 'active' | 'left' | 'kicked'.

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
