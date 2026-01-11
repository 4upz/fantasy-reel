'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { InvitationWithLeague } from '@/types'

interface DeclineInvitationResponse {
  invitation: {
    id: string
    status: string
  }
  message: string
}

export default function PendingInvitations() {
  const router = useRouter()
  const [invitations, setInvitations] = useState<InvitationWithLeague[]>([])
  const [loading, setLoading] = useState(true)
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    fetchPendingInvitations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchPendingInvitations = async () => {
    try {
      setLoading(true)
      setError(null)

      // Query invitations with league data
      // RLS filters by email matching user's email from JWT
      const { data, error: queryError } = await supabase
        .from('invitations')
        .select('*, leagues(id, name, status, owner_id)')
        .eq('status', 'pending')
        .gte('expires_at', new Date().toISOString())
        .order('sent_at', { ascending: false })

      if (queryError) {
        console.error('Error fetching invitations:', queryError)
        setError('Failed to load invitations')
        return
      }

      setInvitations((data as InvitationWithLeague[]) || [])
    } catch (err) {
      console.error('Unexpected error fetching invitations:', err)
      setError('Failed to load invitations')
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = (token: string) => {
    router.push(`/join?token=${token}`)
  }

  const handleDecline = async (invitationId: string) => {
    setDecliningId(invitationId)
    setError(null)

    const { error: declineError } = await callEdgeFunction<DeclineInvitationResponse>(
      'decline-invitation',
      {
        body: { invitation_id: invitationId },
      }
    )

    if (declineError) {
      setError(declineError)
      setDecliningId(null)
      return
    }

    // Remove from list
    setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId))
    setDecliningId(null)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getDaysUntilExpiry = (expiresAt: string) => {
    const now = new Date()
    const expiry = new Date(expiresAt)
    const diffTime = expiry.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  // Don't render anything if no invitations
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
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            <p className="mt-2 text-sm text-gray-600">Loading invitations...</p>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              {invitations.map((invitation) => {
                const daysLeft = getDaysUntilExpiry(invitation.expires_at)
                const isExpiringSoon = daysLeft <= 2

                return (
                  <div
                    key={invitation.id}
                    className="border rounded-lg p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
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
                          onClick={() => handleAccept(invitation.token)}
                          className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded text-sm transition-colors"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleDecline(invitation.id)}
                          disabled={decliningId === invitation.id}
                          className="bg-gray-300 hover:bg-gray-400 disabled:opacity-50 text-gray-800 font-medium py-2 px-4 rounded text-sm transition-colors"
                        >
                          {decliningId === invitation.id ? 'Declining...' : 'Decline'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
