import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID, isValidEmail, authenticateRequest, isAuthError, internalErrorResponse, createServiceClient } from '../_shared/utils.ts'
import { sendInvitationEmail } from '../_shared/email.ts'
import { createLogger } from '../_shared/logger.ts'
import { ownerVisibleEmail } from '../_shared/invitations.ts'
import { logNotificationDelivery, statusFromEmailResult } from '../_shared/notification-log.ts'

const log = createLogger('send-invite')

interface SendInviteRequest {
  league_id: string
  email?: string
  user_id?: string
}

/**
 * Resolve email from user_id lookup or validate provided email
 */
async function resolveEmail(user_id?: string, email?: string): Promise<string | Response> {
  if (user_id) {
    if (!isValidUUID(user_id)) {
      return errorResponse('Valid user_id is required', 400)
    }
    const { data: targetUser, error } = await createServiceClient().auth.admin.getUserById(user_id)
    if (error || !targetUser?.user?.email) {
      return errorResponse('User not found', 404)
    }
    return targetUser.user.email.toLowerCase().trim()
  }

  if (email) {
    if (!isValidEmail(email)) {
      return errorResponse('Valid email is required', 400)
    }
    return email.toLowerCase().trim()
  }

  return errorResponse('Either email or user_id is required', 400)
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user, supabase: supabaseClient } = authResult

    // Parse request body
    const { league_id, email, user_id }: SendInviteRequest = await req.json()

    // Validate required fields
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!email && !user_id) {
      return errorResponse('Either email or user_id is required', 400)
    }

    // Fetch the league and verify ownership
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .select('id, name, owner_id, status, max_participants')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Verify user is the league owner
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can send invitations', 403)
    }

    // Resolve the email only after ownership is confirmed, so a non-owner
    // can't use the admin lookup to probe accounts by user_id.
    const normalizedEmail = await resolveEmail(user_id, email)
    if (normalizedEmail instanceof Response) return normalizedEmail

    // Prevent self-invitation
    if (normalizedEmail === user.email?.toLowerCase()) {
      return errorResponse('You cannot invite yourself to a league', 400)
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

    // Ownership is verified above. Invitation rows go through the service
    // role because owners can't read username invites (their email is hidden).
    const serviceClient = createServiceClient()

    // Check for existing invitation
    const { data: existingInvite } = await serviceClient
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
      const { error: deleteError } = await serviceClient
        .from('invitations')
        .delete()
        .eq('id', existingInvite.id)

      if (deleteError) {
        console.error('Error deleting old invitation:', deleteError)
        return errorResponse('Failed to resend invitation', 500)
      }
    }

    // Create invitation
    const { data: invitation, error: inviteError } = await serviceClient
      .from('invitations')
      .insert({
        league_id,
        invited_by: user.id,
        email: normalizedEmail,
        invited_user_id: user_id ?? null,
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
    const siteUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
    const inviteUrl = `${siteUrl}/join?token=${invitation.token}`

    // Fetch inviter's display name for email personalization
    const { data: inviterProfile } = await supabaseClient
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .single()

    const inviterName = inviterProfile?.display_name || 'A Fantasy Reel user'

    // Send invitation email (non-blocking - don't fail if email fails)
    const emailResult = await sendInvitationEmail({
      recipientEmail: normalizedEmail,
      inviterName,
      leagueName: league.name,
      inviteUrl,
      expiresAt: invitation.expires_at,
    })

    if (!emailResult.success) {
      console.warn('Failed to send invitation email:', emailResult.error)
    }

    await logNotificationDelivery(serviceClient, {
      notificationType: 'invitation',
      recipientEmail: normalizedEmail,
      recipientUserId: user_id ?? null,
      status: statusFromEmailResult(emailResult),
      messageId: emailResult.messageId,
      errorMessage: emailResult.error,
      metadata: { league_id, league_name: league.name, invitation_id: invitation.id },
    })

    // An invite by user_id resolved the address server-side. Echoing it would
    // hand the caller another user's email, so only echo what they typed.
    const echoedEmail = ownerVisibleEmail(invitation)
    const recipient = echoedEmail ?? 'this user'

    return jsonResponse({
      invitation: {
        id: invitation.id,
        league_id: invitation.league_id,
        email: echoedEmail,
        token: invitation.token,
        status: invitation.status,
        expires_at: invitation.expires_at
      },
      invite_url: inviteUrl,
      email_sent: emailResult.success,
      message: emailResult.success
        ? `Invitation sent to ${recipient}`
        : `Invitation created for ${recipient} (email delivery pending)`
    }, 201)

  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
