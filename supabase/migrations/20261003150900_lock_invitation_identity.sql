-- ============================================================================
-- INVITATIONS CANNOT BE REPOINTED
-- ============================================================================
--
-- "Invitees can respond to invitations" (20260126) has no WITH CHECK, so its
-- USING clause (the row's email is mine) was the only test applied to the
-- updated row. That let an invitee rewrite any column, league_id included:
-- create a league, invite yourself, point the invitation at someone else's
-- invite-only league, then redeem its token through join-league, which trusts
-- invitations.league_id. The same pending row also made that league readable
-- through has_pending_invitation().
--
-- Two layers close it:
--   * a trigger fixes league_id, email and invited_by once a row exists, for
--     every writer (owners, invitees and the service role alike). Nothing
--     legitimately changes them: send-invite deletes and re-inserts instead,
--     and cancel/resend/decline/join-league only touch status, token and
--     timestamps;
--   * the invitee policy only matches a pending invitation and only lets it
--     become 'declined' -- the one change decline-invitation makes. Accepting
--     runs through join-league with the service role, which RLS doesn't see.
--
-- Creating an invitation for a league you don't own was already refused:
-- "League owners can create invitations" checks is_league_owner(league_id)
-- and invited_by = auth.uid(). The owner UPDATE policy gets the same
-- ownership test as an explicit WITH CHECK; it was already implied, since a
-- missing WITH CHECK reuses USING.
-- ============================================================================

-- ============================================================================
-- PART 1: IDENTITY COLUMNS ARE WRITE-ONCE
-- ============================================================================

CREATE OR REPLACE FUNCTION guard_invitation_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.league_id IS DISTINCT FROM OLD.league_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
    RAISE EXCEPTION 'An invitation''s league, recipient and sender cannot be changed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION guard_invitation_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_invitation_identity ON invitations;
CREATE TRIGGER guard_invitation_identity
  BEFORE UPDATE ON invitations
  FOR EACH ROW
  EXECUTE FUNCTION guard_invitation_identity();

-- ============================================================================
-- PART 2: UPDATE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "League owners can update invitations" ON invitations;
DROP POLICY IF EXISTS "Invitees can respond to invitations" ON invitations;

CREATE POLICY "League owners can update invitations" ON invitations
  FOR UPDATE TO authenticated
  USING (is_league_owner(league_id))
  WITH CHECK (is_league_owner(league_id));

CREATE POLICY "Invitees can respond to invitations" ON invitations
  FOR UPDATE TO authenticated
  USING (
    email = LOWER((SELECT auth.jwt()) ->> 'email')
    AND status = 'pending'
  )
  WITH CHECK (
    email = LOWER((SELECT auth.jwt()) ->> 'email')
    AND status = 'declined'
  );
