import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface DeclineInvitationRequest {
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
    const { invitation_id }: DeclineInvitationRequest = await req.json()

    // Validate required fields
    if (!invitation_id || !isValidUUID(invitation_id)) {
      return errorResponse('Valid invitation_id is required', 400)
    }

    // Fetch the invitation
    const { data: invitation, error: invitationError } = await supabaseClient
      .from('invitations')
      .select('*')
      .eq('id', invitation_id)
      .single()

    if (invitationError || !invitation) {
      return errorResponse('Invitation not found', 404)
    }

    // Verify the invitation is for the authenticated user's email
    if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
      return errorResponse('This invitation was not sent to you', 403)
    }

    // Check invitation status
    if (invitation.status !== 'pending') {
      return errorResponse(`Invitation has already been ${invitation.status}`, 400)
    }

    // Check if invitation is expired
    const expiresAt = new Date(invitation.expires_at)
    if (expiresAt < new Date()) {
      return errorResponse('Invitation has expired', 400)
    }

    // Update invitation status to declined
    const { data: updatedInvitation, error: updateError } = await supabaseClient
      .from('invitations')
      .update({
        status: 'declined',
        responded_at: new Date().toISOString(),
      })
      .eq('id', invitation_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error declining invitation:', updateError)
      return errorResponse('Failed to decline invitation', 500)
    }

    return jsonResponse({
      invitation: {
        id: updatedInvitation.id,
        league_id: updatedInvitation.league_id,
        email: updatedInvitation.email,
        status: updatedInvitation.status,
        responded_at: updatedInvitation.responded_at,
      },
      message: 'Invitation declined successfully',
    })

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
