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
    <div className="card mb-6">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg leading-6 font-medium font-display text-foreground mb-4">
          Pending Invitations
        </h3>

        {error && <ErrorAlert message={error} />}

        <div className="space-y-3">
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
    <div className="border border-border rounded-lg p-4 bg-elevated hover:bg-surface-hover transition-colors">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h4 className="text-lg font-medium text-foreground">
            {invitation.leagues.name}
          </h4>
          <div className="mt-1 space-y-1 text-sm text-foreground-muted">
            <p>Sent on {formatDate(invitation.sent_at)}</p>
            <p className={isExpiringSoon ? 'text-warning font-medium' : ''}>
              {daysLeft > 0
                ? `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
                : 'Expires today'}
            </p>
          </div>
        </div>

        <div className="flex space-x-2">
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
            {isDeclining ? 'Declining...' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  )
}
