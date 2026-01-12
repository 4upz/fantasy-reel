'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { formatDate, getDaysUntil } from '@/utils/date'
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

    const { data, error: queryError } = await supabase
      .from('invitations')
      .select('*, leagues(id, name, status, owner_id)')
      .eq('status', 'pending')
      .gte('expires_at', new Date().toISOString())
      .order('sent_at', { ascending: false })

    if (queryError) {
      console.error('Error fetching invitations:', queryError)
      setError('Failed to load invitations')
    } else {
      setInvitations((data as InvitationWithLeague[]) || [])
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
    <div className="bg-white shadow rounded-lg mb-6">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
          Pending Invitations
        </h3>

        {loading ? (
          <LoadingSpinner message="Loading invitations..." />
        ) : (
          <>
            {error && <ErrorMessage message={error} />}

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

function InvitationCard({ invitation, onAccept, onDecline, isDeclining }: InvitationCardProps): React.ReactElement {
  const daysLeft = getDaysUntil(invitation.expires_at)
  const isExpiringSoon = daysLeft <= 2

  return (
    <div className="border rounded-lg p-4 bg-gray-50 hover:bg-gray-100 transition-colors">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h4 className="text-lg font-medium text-gray-900">
            {invitation.leagues.name}
          </h4>
          <div className="mt-1 space-y-1 text-sm text-gray-500">
            <p>Sent on {formatDate(invitation.sent_at)}</p>
            <p className={isExpiringSoon ? 'text-orange-600 font-medium' : ''}>
              {daysLeft > 0
                ? `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
                : 'Expires today'}
            </p>
          </div>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => onAccept(invitation.token)}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded text-sm transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => onDecline(invitation.id)}
            disabled={isDeclining}
            className="bg-gray-300 hover:bg-gray-400 disabled:opacity-50 text-gray-800 font-medium py-2 px-4 rounded text-sm transition-colors"
          >
            {isDeclining ? 'Declining...' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LoadingSpinner({ message }: { message: string }): React.ReactElement {
  return (
    <div className="text-center py-4">
      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
    </div>
  )
}

function ErrorMessage({ message }: { message: string }): React.ReactElement {
  return (
    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
      <p className="text-sm text-red-600">{message}</p>
    </div>
  )
}
