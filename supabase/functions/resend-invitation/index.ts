import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface ResendInvitationRequest {
  invitation_id: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Create Supabase client with user auth
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get the user from the JWT token
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Parse request body
    const { invitation_id }: ResendInvitationRequest = await req.json()

    // Validate required fields
    if (!invitation_id || !isValidUUID(invitation_id)) {
      return errorResponse('Valid invitation_id is required', 400)
    }

    // Fetch the invitation with league info
    const { data: invitation, error: invitationError } = await supabaseClient
      .from('invitations')
      .select('*, leagues(*)')
      .eq('id', invitation_id)
      .single()

    if (invitationError || !invitation) {
      return errorResponse('Invitation not found', 404)
    }

    const league = invitation.leagues

    // Verify user is the league owner
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can resend invitations', 403)
    }

    // Check league status
    if (league.status !== 'setup') {
      return errorResponse('Cannot resend invitations - draft has already started', 400)
    }

    // Check invitation status - can only resend pending or expired
    if (invitation.status === 'accepted') {
      return errorResponse('Cannot resend - invitation has already been accepted', 400)
    }
    if (invitation.status === 'declined') {
      return errorResponse('Cannot resend - invitation was declined', 400)
    }

    // Generate new token and expiration
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    // Update invitation with new token and expiration
    const { data: updatedInvitation, error: updateError } = await supabaseClient
      .from('invitations')
      .update({
        token: crypto.randomUUID(),
        expires_at: newExpiresAt,
        status: 'pending',
        sent_at: new Date().toISOString(),
        responded_at: null,
      })
      .eq('id', invitation_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error resending invitation:', updateError)
      return errorResponse('Failed to resend invitation', 500)
    }

    // Construct invite URL
    const siteUrl = Deno.env.get('SITE_URL') || 'http://localhost:3000'
    const inviteUrl = `${siteUrl}/join?token=${updatedInvitation.token}`

    // TODO: Send email with invitation link
    console.log(`Invitation resent for ${updatedInvitation.email}: ${inviteUrl}`)

    return jsonResponse({
      invitation: {
        id: updatedInvitation.id,
        league_id: updatedInvitation.league_id,
        email: updatedInvitation.email,
        token: updatedInvitation.token,
        status: updatedInvitation.status,
        expires_at: updatedInvitation.expires_at,
      },
      invite_url: inviteUrl,
      message: `Invitation resent to ${updatedInvitation.email}`,
    })

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
