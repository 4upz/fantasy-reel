-- Migration: Fix invitations RLS policies
-- The policies were querying auth.users which regular users can't access
-- Use auth.jwt() to get the email from the JWT token instead

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view relevant invitations" ON invitations;
DROP POLICY IF EXISTS "Invitees can respond to invitations" ON invitations;

-- Recreate policies using auth.jwt() instead of auth.users
-- auth.jwt() ->> 'email' extracts the email from the JWT token

CREATE POLICY "Users can view relevant invitations" ON invitations
    FOR SELECT USING (
        -- League owners can see all invitations for their leagues
        league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
        -- Users can see invitations sent to their email
        OR email = (auth.jwt() ->> 'email')
    );

CREATE POLICY "Invitees can respond to invitations" ON invitations
    FOR UPDATE USING (
        -- Users can update invitations sent to their email
        email = (auth.jwt() ->> 'email')
    );
