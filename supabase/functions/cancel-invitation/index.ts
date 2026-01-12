import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'

interface CancelInvitationRequest {
  invitation_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user, supabase } = authResult
    const { invitation_id }: CancelInvitationRequest = await req.json()

    if (!invitation_id || !isValidUUID(invitation_id)) {
      return errorResponse('Valid invitation_id is required', 400)
    }

    // Get invitation with league info to verify ownership
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .select('id, league_id, email, status, leagues(owner_id)')
      .eq('id', invitation_id)
      .single()

    if (invitationError || !invitation) {
      return errorResponse('Invitation not found', 404)
    }

    // Verify user is the league owner
    const leagueData = invitation.leagues as { owner_id: string } | null
    if (!leagueData || leagueData.owner_id !== user.id) {
      return errorResponse('Only the league owner can cancel invitations', 403)
    }

    if (invitation.status !== 'pending') {
      return errorResponse(`Invitation has already been ${invitation.status}`, 400)
    }

    const { data: updated, error: updateError } = await supabase
      .from('invitations')
      .update({
        status: 'cancelled',
        responded_at: new Date().toISOString(),
      })
      .eq('id', invitation_id)
      .select('id, league_id, email, status, responded_at')
      .single()

    if (updateError) {
      console.error('Error cancelling invitation:', updateError)
      return errorResponse('Failed to cancel invitation', 500)
    }

    return jsonResponse({
      invitation: updated,
      message: 'Invitation cancelled successfully',
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
