-- Migration: Fix circular dependency in RLS policies
-- leagues SELECT policy queries invitations, invitations SELECT policy queries leagues
-- Create SECURITY DEFINER helper functions to break the recursion cycle

-- Helper function to check if user owns a league (bypasses leagues RLS)
CREATE OR REPLACE FUNCTION is_league_owner(check_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM leagues
        WHERE id = check_league_id
        AND owner_id = auth.uid()
    )
$$;

-- Helper function to check if user has pending invitation (bypasses invitations RLS)
CREATE OR REPLACE FUNCTION has_pending_invitation(check_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM invitations
        WHERE league_id = check_league_id
        AND email = LOWER(auth.jwt() ->> 'email')
        AND status = 'pending'
    )
$$;

-- Update leagues SELECT policy to use helper function instead of subquery
DROP POLICY IF EXISTS "Users can view leagues they participate in" ON leagues;

CREATE POLICY "Users can view leagues they participate in" ON leagues
    FOR SELECT USING (
        -- Owner can always see their leagues
        owner_id = auth.uid()
        -- Members can see leagues they've joined
        OR is_league_member(id)
        -- Invitees can see leagues they're invited to (uses helper to avoid recursion)
        OR has_pending_invitation(id)
    );

-- Update invitations policies to use helper function instead of subquery
DROP POLICY IF EXISTS "Users can view relevant invitations" ON invitations;
DROP POLICY IF EXISTS "League owners can update invitations" ON invitations;

CREATE POLICY "Users can view relevant invitations" ON invitations
    FOR SELECT USING (
        -- League owners can see all invitations for their leagues
        is_league_owner(league_id)
        -- Users can see invitations sent to their email
        OR email = LOWER(auth.jwt() ->> 'email')
    );

CREATE POLICY "League owners can update invitations" ON invitations
    FOR UPDATE USING (
        is_league_owner(league_id)
    );
