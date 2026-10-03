import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from './logger.ts'
import { errorResponse } from './utils.ts'
import { consumeRateLimit, describeRetryAfter, hashSubject, rateLimitResponse } from './rate-limit.ts'

/**
 * Invitations sent by username (`invited_user_id` set) carry an email the
 * owner never typed: send-invite resolved it server-side. Owners must not see
 * it, so anything returned to the owner goes through these helpers.
 */

interface InvitationRecipient {
  email: string
  invited_user_id: string | null
}

/** The email the owner may see: their own input, never a resolved address. */
export function ownerVisibleEmail(invitation: InvitationRecipient): string | null {
  return invitation.invited_user_id ? null : invitation.email
}

/** Copy of an invitation row that is safe to return to the league owner. */
export function toOwnerInvitation<T extends InvitationRecipient>(
  invitation: T
): Omit<T, 'email'> & { email: string | null } {
  return { ...invitation, email: ownerVisibleEmail(invitation) }
}

/**
 * Invitation email limits. Invites go out through the same Resend account as
 * Supabase Auth's sign-up and password-reset emails, so unlimited invites
 * could exhaust (or get suspended) the account every user signs in through.
 * Each is well above what a commissioner filling a 20-team league needs.
 */
export const INVITE_LIMITS = {
  /** Invitation emails (sends + resends) one owner can trigger per UTC day. */
  emailsPerOwnerPerDay: 50,
  /** Emails to one address for one league per UTC day (send + resends). */
  emailsPerRecipientPerDay: 3,
  /** Open invitations a league can hold, as a multiple of its team cap. */
  pendingPerParticipantSlot: 2,
} as const

const DAY_SECONDS = 24 * 60 * 60

/** Most open (pending, unexpired) invitations a league may hold. */
export function maxPendingInvitations(maxParticipants: number): number {
  return maxParticipants * INVITE_LIMITS.pendingPerParticipantSlot
}

/** Open invitations in a league: pending and not yet expired. */
export async function countOpenInvitations(serviceClient: SupabaseClient, leagueId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
  if (error) throw error
  return count ?? 0
}

/** The 400 sent when a league already holds its maximum open invitations. */
export function tooManyOpenInvitationsResponse(maxParticipants: number): Response {
  return errorResponse(
    `This league already has ${maxPendingInvitations(maxParticipants)} open invitations. ` +
      'Cancel some you no longer need, or share the join link instead.',
    400
  )
}

/**
 * Counts one invitation email against the owner's daily allowance and the
 * per-recipient allowance. Returns the 429 to send when either is used up,
 * or null when the email may go out.
 */
export async function consumeInvitationEmailAllowance(
  serviceClient: SupabaseClient,
  params: { ownerId: string; leagueId: string; email: string },
  log?: Logger
): Promise<Response | null> {
  const recipient = await consumeRateLimit(serviceClient, {
    bucket: 'invite_email:recipient',
    subject: `${params.leagueId}:${await hashSubject(params.email)}`,
    max: INVITE_LIMITS.emailsPerRecipientPerDay,
    windowSeconds: DAY_SECONDS,
  }, log)
  if (!recipient.allowed) {
    return rateLimitResponse(
      `This person has already been sent ${INVITE_LIMITS.emailsPerRecipientPerDay} invitation emails for this league today. ` +
        `You can send another in ${describeRetryAfter(recipient.retryAfterSeconds)}, or share the join link instead.`,
      recipient.retryAfterSeconds
    )
  }

  const owner = await consumeRateLimit(serviceClient, {
    bucket: 'invite_email:owner',
    subject: params.ownerId,
    max: INVITE_LIMITS.emailsPerOwnerPerDay,
    windowSeconds: DAY_SECONDS,
  }, log)
  if (!owner.allowed) {
    return rateLimitResponse(
      `You've reached today's limit of ${INVITE_LIMITS.emailsPerOwnerPerDay} invitation emails. ` +
        `You can send more in ${describeRetryAfter(owner.retryAfterSeconds)}, or share the join link instead.`,
      owner.retryAfterSeconds
    )
  }

  return null
}
