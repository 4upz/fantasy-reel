'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { announce } from '@/utils/announce'
import { formatDate, getDaysUntil } from '@/utils/date'
import { ErrorAlert } from '@/app/components/FormError'
import type { InvitationWithLeague } from '@/types'

interface PendingInvitationsProps {
  initialInvitations: InvitationWithLeague[]
  /**
   * Declining the last invitation removes the banner along with the focused
   * button; the page moves focus somewhere stable (its heading).
   */
  onAllHandled?: () => void
}

export default function PendingInvitations({ initialInvitations, onAllHandled }: PendingInvitationsProps): React.ReactElement | null {
  const router = useRouter()

  const [invitations, setInvitations] = useState<InvitationWithLeague[]>(initialInvitations)
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Declining removes the focused card; this names the card whose Accept
  // button takes focus next ('' means none is left).
  const focusAfterDeclineRef = useRef<string | null>(null)

  useEffect(() => {
    const target = focusAfterDeclineRef.current
    if (target === null) return
    focusAfterDeclineRef.current = null
    const next = target
      ? listRef.current?.querySelector<HTMLElement>(`[data-accept-id="${target}"]`)
      : null
    if (next) next.focus()
    else onAllHandled?.()
  }, [invitations, onAllHandled])

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
      const index = invitations.findIndex((inv) => inv.id === invitationId)
      const declined = invitations[index]
      const neighbour = invitations[index + 1] ?? invitations[index - 1]
      focusAfterDeclineRef.current = neighbour?.id ?? ''
      setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId))
      announce(declined?.leagues ? `Invitation to ${declined.leagues.name} declined` : 'Invitation declined')
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
          <svg className="w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true" focusable="false">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="type-panel text-foreground">
          {invitations.length === 1 ? 'You have a pending invitation' : `You have ${invitations.length} pending invitations`}
        </h2>
      </div>

      {error && <ErrorAlert message={error} />}

      <ul ref={listRef} role="list" className="space-y-2">
        {invitations.map((invitation) => (
          <InvitationCard
            key={invitation.id}
            invitation={invitation}
            onAccept={handleAccept}
            onDecline={handleDecline}
            isDeclining={decliningId === invitation.id}
          />
        ))}
      </ul>
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

  const leagueName = invitation.leagues.name

  return (
    <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-surface border border-border" data-testid="invitation-card">
      <div className="flex-1 min-w-0">
        <h3 className="type-label text-foreground truncate">
          {leagueName}
        </h3>
        <div className="type-body-sm flex items-center gap-2 text-foreground-secondary">
          <span>Sent {formatDate(invitation.sent_at)}</span>
          <span aria-hidden="true" className="w-1 h-1 rounded-full bg-foreground-muted" />
          <span className={isExpiringSoon ? 'text-warning font-medium' : ''}>
            {daysLeft > 0
              ? `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
              : 'Expires today'}
          </span>
        </div>
      </div>

      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onAccept(invitation.token)}
          className="type-control btn btn-primary"
          data-testid="accept-invitation-button"
          data-accept-id={invitation.id}
        >
          Accept<span className="sr-only"> invitation to {leagueName}</span>
        </button>
        <button
          type="button"
          onClick={() => onDecline(invitation.id)}
          disabled={isDeclining}
          className="type-control btn btn-ghost"
          data-testid="decline-invitation-button"
        >
          {isDeclining ? 'Declining…' : 'Decline'}
          <span className="sr-only"> invitation to {leagueName}</span>
        </button>
      </div>
    </li>
  )
}
