import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

interface ResendInvitationRequest {
  invitation_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user, supabase } = authResult
    const { invitation_id }: ResendInvitationRequest = await req.json()

    if (!invitation_id || !isValidUUID(invitation_id)) {
      return errorResponse('Valid invitation_id is required', 400)
    }

    // Fetch invitation
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .select('id, league_id, email, status')
      .eq('id', invitation_id)
      .single()

    if (invitationError || !invitation) {
      return errorResponse('Invitation not found', 404)
    }

    // Fetch league separately for cleaner type inference
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('id, owner_id, status')
      .eq('id', invitation.league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can resend invitations', 403)
    }

    if (league.status !== 'setup') {
      return errorResponse('Cannot resend invitations - draft has already started', 400)
    }

    if (invitation.status === 'accepted') {
      return errorResponse('Cannot resend - invitation has already been accepted', 400)
    }

    if (invitation.status === 'declined') {
      return errorResponse('Cannot resend - invitation was declined', 400)
    }

    const { data: updated, error: updateError } = await supabase
      .from('invitations')
      .update({
        token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
        status: 'pending',
        sent_at: new Date().toISOString(),
        responded_at: null,
      })
      .eq('id', invitation_id)
      .select('id, league_id, email, token, status, expires_at')
      .single()

    if (updateError) {
      console.error('Error resending invitation:', updateError)
      return errorResponse('Failed to resend invitation', 500)
    }

    const siteUrl = Deno.env.get('SITE_URL') || 'http://localhost:3000'
    const inviteUrl = `${siteUrl}/join?token=${updated.token}`

    // TODO: Send email with invitation link
    console.log(`Invitation resent for ${updated.email}: ${inviteUrl}`)

    return jsonResponse({
      invitation: updated,
      invite_url: inviteUrl,
      message: `Invitation resent to ${updated.email}`,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
