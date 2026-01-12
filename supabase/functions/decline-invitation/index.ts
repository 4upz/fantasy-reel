import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
  isInvitationExpired,
} from '../_shared/utils.ts'

interface DeclineInvitationRequest {
  invitation_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user, supabase } = authResult
    const { invitation_id }: DeclineInvitationRequest = await req.json()

    if (!invitation_id || !isValidUUID(invitation_id)) {
      return errorResponse('Valid invitation_id is required', 400)
    }

    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .select('id, league_id, email, status, expires_at')
      .eq('id', invitation_id)
      .single()

    if (invitationError || !invitation) {
      return errorResponse('Invitation not found', 404)
    }

    if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
      return errorResponse('This invitation was not sent to you', 403)
    }

    if (invitation.status !== 'pending') {
      return errorResponse(`Invitation has already been ${invitation.status}`, 400)
    }

    if (isInvitationExpired(invitation.expires_at)) {
      return errorResponse('Invitation has expired', 400)
    }

    const { data: updated, error: updateError } = await supabase
      .from('invitations')
      .update({
        status: 'declined',
        responded_at: new Date().toISOString(),
      })
      .eq('id', invitation_id)
      .select('id, league_id, email, status, responded_at')
      .single()

    if (updateError) {
      console.error('Error declining invitation:', updateError)
      return errorResponse('Failed to decline invitation', 500)
    }

    return jsonResponse({
      invitation: updated,
      message: 'Invitation declined successfully',
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
