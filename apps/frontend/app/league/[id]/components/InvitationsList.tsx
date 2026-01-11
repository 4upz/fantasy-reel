'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { Invitation } from '@/types'

interface ResendInvitationResponse {
  invitation: {
    id: string
    token: string
    status: string
    expires_at: string
  }
  invite_url: string
  message: string
}

interface Props {
  leagueId: string
  isOwner: boolean
  leagueStatus: string
}

export default function InvitationsList({ leagueId, isOwner, leagueStatus }: Props) {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    if (isOwner) {
      fetchInvitations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, leagueId])

  const fetchInvitations = async () => {
    try {
      setLoading(true)
      setError(null)

      // RLS allows owners to see all invitations for their leagues
      const { data, error: queryError } = await supabase
        .from('invitations')
        .select('*')
        .eq('league_id', leagueId)
        .order('sent_at', { ascending: false })

      if (queryError) {
        console.error('Error fetching invitations:', queryError)
        setError('Failed to load invitations')
        return
      }

      setInvitations(data || [])
    } catch (err) {
      console.error('Unexpected error fetching invitations:', err)
      setError('Failed to load invitations')
    } finally {
      setLoading(false)
    }
  }

  const getEffectiveStatus = (invitation: Invitation): string => {
    if (invitation.status === 'pending') {
      const now = new Date()
      const expiresAt = new Date(invitation.expires_at)
      if (expiresAt < now) {
        return 'expired'
      }
    }
    return invitation.status
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'accepted':
        return 'bg-green-100 text-green-800'
      case 'declined':
        return 'bg-red-100 text-red-800'
      case 'expired':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const handleCopyLink = async (invitation: Invitation) => {
    const siteUrl = window.location.origin
    const inviteUrl = `${siteUrl}/join?token=${invitation.token}`

    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopiedId(invitation.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      setError('Failed to copy link')
    }
  }

  const handleResend = async (invitationId: string) => {
    setResendingId(invitationId)
    setError(null)

    const { data, error: resendError } = await callEdgeFunction<ResendInvitationResponse>(
      'resend-invitation',
      {
        body: { invitation_id: invitationId },
      }
    )

    if (resendError) {
      setError(resendError)
      setResendingId(null)
      return
    }

    if (data?.invitation) {
      // Update the invitation in the list
      setInvitations((prev) =>
        prev.map((inv) =>
          inv.id === invitationId
            ? {
                ...inv,
                token: data.invitation.token,
                status: data.invitation.status as Invitation['status'],
                expires_at: data.invitation.expires_at,
                sent_at: new Date().toISOString(),
                responded_at: null,
              }
            : inv
        )
      )

      // Copy the new link to clipboard
      try {
        await navigator.clipboard.writeText(data.invite_url)
        setCopiedId(invitationId)
        setTimeout(() => setCopiedId(null), 2000)
      } catch {
        // Ignore clipboard errors
      }
    }

    setResendingId(null)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Only show for owners
  if (!isOwner) {
    return null
  }

  // Don't show if league is not in setup
  if (leagueStatus !== 'setup') {
    return null
  }

  const pendingCount = invitations.filter((inv) => getEffectiveStatus(inv) === 'pending').length
  const expiredCount = invitations.filter((inv) => getEffectiveStatus(inv) === 'expired').length

  return (
    <div className="bg-white shadow rounded-lg mt-6">
      <div
        className="px-4 py-4 sm:px-6 flex justify-between items-center cursor-pointer hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-medium text-gray-900">Invitations</h3>
          <span className="text-sm text-gray-500">
            ({invitations.length} total
            {pendingCount > 0 && `, ${pendingCount} pending`}
            {expiredCount > 0 && `, ${expiredCount} expired`})
          </span>
        </div>
        <button className="text-gray-400 hover:text-gray-600">
          <svg
            className={`h-5 w-5 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-200 px-4 py-4 sm:px-6">
          {loading ? (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
              <p className="mt-2 text-sm text-gray-600">Loading invitations...</p>
            </div>
          ) : invitations.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              No invitations sent yet. Use the "Invite Players" button to invite people to your league.
            </p>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <div className="space-y-3">
                {invitations.map((invitation) => {
                  const effectiveStatus = getEffectiveStatus(invitation)
                  const canResend = effectiveStatus === 'expired' || effectiveStatus === 'pending'
                  const canCopy = effectiveStatus === 'pending'

                  return (
                    <div
                      key={invitation.id}
                      className="flex items-center justify-between p-3 border rounded-lg bg-gray-50"
                    >
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <span className="font-medium text-gray-900">{invitation.email}</span>
                          <span
                            className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusBadge(effectiveStatus)}`}
                          >
                            {effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          Sent {formatDate(invitation.sent_at)}
                          {invitation.responded_at && (
                            <> · Responded {formatDate(invitation.responded_at)}</>
                          )}
                        </div>
                      </div>

                      <div className="flex space-x-2">
                        {canCopy && (
                          <button
                            onClick={() => handleCopyLink(invitation)}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1.5 px-3 rounded text-sm transition-colors"
                          >
                            {copiedId === invitation.id ? 'Copied!' : 'Copy Link'}
                          </button>
                        )}
                        {canResend && effectiveStatus === 'expired' && (
                          <button
                            onClick={() => handleResend(invitation.id)}
                            disabled={resendingId === invitation.id}
                            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-1.5 px-3 rounded text-sm transition-colors"
                          >
                            {resendingId === invitation.id ? 'Resending...' : 'Resend'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
