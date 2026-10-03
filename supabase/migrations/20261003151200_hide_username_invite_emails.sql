-- ============================================================================
-- OWNERS NO LONGER READ THE EMAIL BEHIND A USERNAME INVITE
-- ============================================================================
--
-- Inviting by username sends send-invite a user_id, and the function looks up
-- that user's email with the admin API so the invitation can be matched to
-- their JWT. The owner never typed that address, yet "Users can view relevant
-- invitations" let them read invitations.email, so any league owner could
-- turn search-users ids into email addresses.
--
--   * invited_user_id marks a username invite. send-invite sets it; it is
--     write-once so an owner can't clear it to unmask the row.
--   * The owner branch of the SELECT policy now covers only invites they
--     addressed themselves (invited_user_id IS NULL). The invitee branch is
--     unchanged, so the dashboard, decline-invitation, join-league and
--     has_pending_invitation() keep matching on the JWT email.
--   * get_league_invitations() gives owners the whole list, with the email
--     withheld and the invitee's display name in its place for username
--     invites. The Edge Functions that act as the owner use the service role
--     after their own ownership check.
--
-- Rows created before this migration have no marker and stay visible to
-- their owner as before; pending ones expire after seven days.
-- ============================================================================

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS invited_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN invitations.invited_user_id IS
  'Set when the owner invited by username. The email was resolved server-side and is hidden from the owner.';

-- ============================================================================
-- PART 1: THE MARKER IS WRITE-ONCE
-- ============================================================================

CREATE OR REPLACE FUNCTION guard_invitation_invited_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.invited_user_id IS DISTINCT FROM OLD.invited_user_id THEN
    RAISE EXCEPTION 'An invitation''s invited user cannot be changed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION guard_invitation_invited_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_invitation_invited_user ON invitations;
CREATE TRIGGER guard_invitation_invited_user
  BEFORE UPDATE ON invitations
  FOR EACH ROW
  EXECUTE FUNCTION guard_invitation_invited_user();

-- ============================================================================
-- PART 2: SELECT POLICY
-- ============================================================================

DROP POLICY IF EXISTS "Users can view relevant invitations" ON invitations;

CREATE POLICY "Users can view relevant invitations" ON invitations
  FOR SELECT
  USING (
    (is_league_owner(league_id) AND invited_user_id IS NULL)
    OR email = LOWER((SELECT auth.jwt()) ->> 'email')
  );

-- ============================================================================
-- PART 3: THE OWNER'S LIST
-- ============================================================================

CREATE OR REPLACE FUNCTION get_league_invitations(p_league_id UUID)
RETURNS TABLE (
  id UUID,
  league_id UUID,
  invited_by UUID,
  email VARCHAR,
  invited_user_id UUID,
  invitee_display_name TEXT,
  token UUID,
  status VARCHAR,
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.league_id,
    i.invited_by,
    (CASE WHEN i.invited_user_id IS NULL THEN i.email END)::VARCHAR,
    i.invited_user_id,
    p.display_name::TEXT,
    i.token,
    i.status::VARCHAR,
    i.sent_at,
    i.expires_at,
    i.responded_at,
    i.created_at,
    i.updated_at
  FROM invitations i
  JOIN leagues l ON l.id = i.league_id
  LEFT JOIN profiles p ON p.user_id = i.invited_user_id
  WHERE i.league_id = p_league_id
    AND l.owner_id = (SELECT auth.uid())
  ORDER BY i.sent_at DESC;
$$;

REVOKE ALL ON FUNCTION get_league_invitations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_league_invitations(UUID) TO authenticated;
