'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { formatDate, getDaysUntil } from '@/utils/date'
import { LoadingSpinner } from '@/app/components/LoadingSpinner'
import { ErrorAlert } from '@/app/components/FormError'
import type { InvitationWithLeague } from '@/types'

export default function PendingInvitations(): React.ReactElement | null {
  const router = useRouter()
  const supabase = createClient()

  const [invitations, setInvitations] = useState<InvitationWithLeague[]>([])
  const [loading, setLoading] = useState(true)
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPendingInvitations()
  }, [])

  async function fetchPendingInvitations(): Promise<void> {
    setLoading(true)
    setError(null)

    // Get current user's email to filter invitations sent TO them
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      setLoading(false)
      return
    }

    const { data, error: queryError } = await supabase
      .from('invitations')
      .select('*, leagues(id, name, status, owner_id)')
      .eq('status', 'pending')
      .eq('email', user.email)
      .gte('expires_at', new Date().toISOString())
      .order('sent_at', { ascending: false })

    if (queryError) {
      console.error('Error fetching invitations:', queryError)
      setError('Failed to load invitations')
    } else {
      // Filter out invitations where the league was deleted or inaccessible
      const validInvitations = (data || []).filter(
        (inv): inv is InvitationWithLeague & { leagues: NonNullable<InvitationWithLeague['leagues']> } =>
          inv.leagues !== null
      )
      setInvitations(validInvitations)
    }

    setLoading(false)
  }

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

  if (!loading && invitations.length === 0) {
    return null
  }

  return (
    <div className="card mb-6">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg leading-6 font-medium font-display text-foreground mb-4">
          Pending Invitations
        </h3>

        {loading ? (
          <LoadingSpinner message="Loading invitations..." />
        ) : (
          <>
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
          </>
        )}
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
