import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID, isValidEmail } from '../_shared/utils.ts'

interface SendInviteRequest {
  league_id: string
  email: string
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
    const { league_id, email }: SendInviteRequest = await req.json()

    // Validate required fields
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!email || !isValidEmail(email)) {
      return errorResponse('Valid email is required', 400)
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Prevent self-invitation
    if (normalizedEmail === user.email?.toLowerCase()) {
      return errorResponse('You cannot invite yourself to a league', 400)
    }

    // Fetch the league and verify ownership
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Verify user is the league owner
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can send invitations', 403)
    }

    // Check league status
    if (league.status !== 'setup') {
      return errorResponse('Cannot send invitations - draft has already started', 400)
    }

    // Check if league is full
    const { count: participantCount } = await supabaseClient
      .from('league_participants')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', league_id)
      .eq('status', 'active')

    if (participantCount !== null && participantCount >= league.max_participants) {
      return errorResponse('League is full', 400)
    }

    // Check for existing invitation
    const { data: existingInvite } = await supabaseClient
      .from('invitations')
      .select('id, status')
      .eq('league_id', league_id)
      .eq('email', normalizedEmail)
      .single()

    if (existingInvite) {
      if (existingInvite.status === 'accepted') {
        return errorResponse('This user has already joined the league', 400)
      }
      if (existingInvite.status === 'pending') {
        return errorResponse('An invitation has already been sent to this email', 400)
      }
      // For expired/cancelled/declined: delete old invitation to allow resend
      const { error: deleteError } = await supabaseClient
        .from('invitations')
        .delete()
        .eq('id', existingInvite.id)

      if (deleteError) {
        console.error('Error deleting old invitation:', deleteError)
        return errorResponse('Failed to resend invitation', 500)
      }
    }

    // Check if user is already a participant (by checking auth.users email)
    // Note: This requires a join or separate query since we can't easily lookup by email
    // For now, we'll let the join-league function handle this case

    // Create invitation
    const { data: invitation, error: inviteError } = await supabaseClient
      .from('invitations')
      .insert({
        league_id,
        invited_by: user.id,
        email: normalizedEmail,
        status: 'pending'
        // token and expires_at have DB defaults
      })
      .select()
      .single()

    if (inviteError) {
      console.error('Error creating invitation:', inviteError)
      if (inviteError.code === '23505') {
        // Unique constraint violation
        return errorResponse('An invitation already exists for this email', 400)
      }
      return errorResponse('Failed to create invitation', 500)
    }

    // Construct invite URL
    const siteUrl = Deno.env.get('SITE_URL') || 'http://localhost:3000'
    const inviteUrl = `${siteUrl}/join?token=${invitation.token}`

    // TODO: Send email with invitation link
    // For now, just log it
    console.log(`Invitation created for ${normalizedEmail}: ${inviteUrl}`)

    return jsonResponse({
      invitation: {
        id: invitation.id,
        league_id: invitation.league_id,
        email: invitation.email,
        token: invitation.token,
        status: invitation.status,
        expires_at: invitation.expires_at
      },
      invite_url: inviteUrl,
      message: `Invitation created for ${normalizedEmail}`
    }, 201)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
