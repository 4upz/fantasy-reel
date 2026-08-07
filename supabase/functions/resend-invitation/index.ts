import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { sendInvitationEmail } from '../_shared/email.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('resend-invitation')

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
      .select('id, name, owner_id, status')
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

    const siteUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
    const inviteUrl = `${siteUrl}/join?token=${updated.token}`

    // Fetch inviter's display name for email personalization
    const { data: inviterProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .single()

    const inviterName = inviterProfile?.display_name || 'A Fantasy Reel user'

    // Send invitation email (non-blocking - don't fail if email fails)
    const emailResult = await sendInvitationEmail({
      recipientEmail: updated.email,
      inviterName,
      leagueName: league.name,
      inviteUrl,
      expiresAt: updated.expires_at,
    })

    if (!emailResult.success) {
      console.warn('Failed to send invitation email:', emailResult.error)
    }

    return jsonResponse({
      invitation: updated,
      invite_url: inviteUrl,
      email_sent: emailResult.success,
      message: emailResult.success
        ? `Invitation resent to ${updated.email}`
        : `Invitation refreshed for ${updated.email} (email delivery pending)`,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
