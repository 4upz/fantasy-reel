'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { formatDate, getDaysUntil } from '@/utils/date'
import { ErrorAlert } from '@/app/components/FormError'
import type { InvitationWithLeague } from '@/types'

interface PendingInvitationsProps {
  initialInvitations: InvitationWithLeague[]
}

export default function PendingInvitations({ initialInvitations }: PendingInvitationsProps): React.ReactElement | null {
  const router = useRouter()

  const [invitations, setInvitations] = useState<InvitationWithLeague[]>(initialInvitations)
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleAccept(token: string): void {
    router.push(`/join?token=${token}`)
  }

  async function handleDecline(invitationId: string): Promise<void> {
    setDecliningId(invitationId)
    setError(null)

    const { error: declineError } = await callEdgeFunction('decline-invitation', {
      body: { invitation_id: invitationId },
    })

    if (declineError) {
      setError(declineError)
    } else {
      setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId))
    }

    setDecliningId(null)
  }

  if (invitations.length === 0) {
    return null
  }

  return (
    <div className="invitation-banner px-5 py-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gold-muted shrink-0">
          <svg className="w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="font-display font-semibold text-foreground">
          {invitations.length === 1 ? 'You have a pending invitation' : `You have ${invitations.length} pending invitations`}
        </h3>
      </div>

      {error && <ErrorAlert message={error} />}

      <div className="space-y-2">
        {invitations.map((invitation) => (
          <InvitationCard
            key={invitation.id}
            invitation={invitation}
            onAccept={handleAccept}
            onDecline={handleDecline}
            isDeclining={decliningId === invitation.id}
          />
        ))}
      </div>
    </div>
  )
}

interface InvitationCardProps {
  invitation: InvitationWithLeague
  onAccept: (token: string) => void
  onDecline: (id: string) => void
  isDeclining: boolean
}

function InvitationCard({ invitation, onAccept, onDecline, isDeclining }: InvitationCardProps): React.ReactElement | null {
  const daysLeft = getDaysUntil(invitation.expires_at)
  const isExpiringSoon = daysLeft <= 2

  if (!invitation.leagues) {
    return null
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-surface border border-border">
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-foreground truncate">
          {invitation.leagues.name}
        </h4>
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <span>Sent {formatDate(invitation.sent_at)}</span>
          <span className="w-1 h-1 rounded-full bg-foreground-muted" />
          <span className={isExpiringSoon ? 'text-warning font-medium' : ''}>
            {daysLeft > 0
              ? `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
              : 'Expires today'}
          </span>
        </div>
      </div>

      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => onAccept(invitation.token)}
          className="btn btn-primary text-sm"
        >
          Accept
        </button>
        <button
          onClick={() => onDecline(invitation.id)}
          disabled={isDeclining}
          className="btn btn-ghost text-sm"
        >
          {isDeclining ? '...' : 'Decline'}
        </button>
      </div>
    </div>
  )
}
