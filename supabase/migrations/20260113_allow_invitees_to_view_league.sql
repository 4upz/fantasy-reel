-- Allow invited users to view league details before joining
-- Fixes case sensitivity for email matching (JWT preserves case, DB stores lowercase)

-- Leagues: Allow owners, members, and pending invitees to view
DROP POLICY IF EXISTS "Users can view leagues they participate in" ON leagues;

CREATE POLICY "Users can view leagues they participate in" ON leagues
    FOR SELECT USING (
        owner_id = auth.uid()
        OR is_league_member(id)
        OR id IN (
            SELECT league_id FROM invitations
            WHERE email = LOWER(auth.jwt() ->> 'email')
            AND status = 'pending'
        )
    );

-- Invitations: Case-insensitive email matching for viewing and responding
DROP POLICY IF EXISTS "Users can view relevant invitations" ON invitations;
DROP POLICY IF EXISTS "Invitees can respond to invitations" ON invitations;

CREATE POLICY "Users can view relevant invitations" ON invitations
    FOR SELECT USING (
        league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
        OR email = LOWER(auth.jwt() ->> 'email')
    );

CREATE POLICY "Invitees can respond to invitations" ON invitations
    FOR UPDATE USING (
        email = LOWER(auth.jwt() ->> 'email')
    );
