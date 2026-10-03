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
