-- Migration: Fix infinite recursion in league_participants RLS policy
-- The SELECT policy was referencing league_participants within itself

-- Create a security definer function to check league membership
-- SECURITY DEFINER allows the function to bypass RLS policies
CREATE OR REPLACE FUNCTION is_league_member(check_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM league_participants
        WHERE league_id = check_league_id
        AND user_id = auth.uid()
        AND status = 'active'
    )
$$;

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can view participants in their leagues" ON league_participants;

-- Create new policy that doesn't cause recursion
-- Uses the security definer function to check membership
CREATE POLICY "Users can view participants in their leagues" ON league_participants
    FOR SELECT USING (
        -- User can always see their own participation records
        user_id = auth.uid()
        -- League owner can see all participants
        OR league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
        -- Members can see other members (uses security definer to avoid recursion)
        OR is_league_member(league_id)
    );

-- Also fix the leagues SELECT policy which has a similar issue
DROP POLICY IF EXISTS "Users can view leagues they participate in" ON leagues;

CREATE POLICY "Users can view leagues they participate in" ON leagues
    FOR SELECT USING (
        owner_id = auth.uid()
        OR is_league_member(id)
    );
