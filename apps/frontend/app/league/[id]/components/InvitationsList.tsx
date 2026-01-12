'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { formatDate, isExpired } from '@/utils/date'
import type { Invitation } from '@/types'

interface Props {
  leagueId: string
  isOwner: boolean
  leagueStatus: string
}

type EffectiveStatus = 'pending' | 'accepted' | 'declined' | 'expired'

export default function InvitationsList({ leagueId, isOwner, leagueStatus }: Props): React.ReactElement | null {
  const supabase = createClient()

  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    if (isOwner) {
      fetchInvitations()
    }
  }, [isOwner, leagueId])

  async function fetchInvitations(): Promise<void> {
    setLoading(true)
    setError(null)

    const { data, error: queryError } = await supabase
      .from('invitations')
      .select('*')
      .eq('league_id', leagueId)
      .order('sent_at', { ascending: false })

    if (queryError) {
      console.error('Error fetching invitations:', queryError)
      setError('Failed to load invitations')
    } else {
      setInvitations(data || [])
    }

    setLoading(false)
  }

  async function handleCopyLink(invitation: Invitation): Promise<void> {
    const inviteUrl = `${window.location.origin}/join?token=${invitation.token}`

    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopiedId(invitation.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      setError('Failed to copy link')
    }
  }

  async function handleResend(invitationId: string): Promise<void> {
    setResendingId(invitationId)
    setError(null)

    const { data, error: resendError } = await callEdgeFunction<{
      invitation: { token: string; status: string; expires_at: string }
      invite_url: string
    }>('resend-invitation', {
      body: { invitation_id: invitationId },
    })

    if (resendError) {
      setError(resendError)
      setResendingId(null)
      return
    }

    if (data?.invitation) {
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

  if (!isOwner || leagueStatus !== 'setup') {
    return null
  }

  const pendingCount = invitations.filter((inv) => getEffectiveStatus(inv) === 'pending').length
  const expiredCount = invitations.filter((inv) => getEffectiveStatus(inv) === 'expired').length

  return (
    <div className="bg-white shadow rounded-lg mt-6">
      <button
        className="w-full px-4 py-4 sm:px-6 flex justify-between items-center hover:bg-gray-50"
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
        <ChevronIcon isExpanded={isExpanded} />
      </button>

      {isExpanded && (
        <div className="border-t border-gray-200 px-4 py-4 sm:px-6">
          {loading ? (
            <LoadingSpinner />
          ) : invitations.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              No invitations sent yet. Use the "Invite Players" button to invite people to your league.
            </p>
          ) : (
            <>
              {error && <ErrorMessage message={error} />}

              <div className="space-y-3">
                {invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    onCopy={handleCopyLink}
                    onResend={handleResend}
                    isResending={resendingId === invitation.id}
                    isCopied={copiedId === invitation.id}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function getEffectiveStatus(invitation: Invitation): EffectiveStatus {
  if (invitation.status === 'pending' && isExpired(invitation.expires_at)) {
    return 'expired'
  }
  return invitation.status
}

const STATUS_BADGE_STYLES: Record<EffectiveStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
}

interface InvitationRowProps {
  invitation: Invitation
  onCopy: (invitation: Invitation) => void
  onResend: (id: string) => void
  isResending: boolean
  isCopied: boolean
}

function InvitationRow({ invitation, onCopy, onResend, isResending, isCopied }: InvitationRowProps): React.ReactElement {
  const status = getEffectiveStatus(invitation)
  const canCopy = status === 'pending'
  const canResend = status === 'expired'

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
      <div className="flex-1">
        <div className="flex items-center space-x-3">
          <span className="font-medium text-gray-900">{invitation.email}</span>
          <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_BADGE_STYLES[status]}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
        <div className="mt-1 text-sm text-gray-500">
          Sent {formatDate(invitation.sent_at)}
          {invitation.responded_at && <> · Responded {formatDate(invitation.responded_at)}</>}
        </div>
      </div>

      <div className="flex space-x-2">
        {canCopy && (
          <button
            onClick={() => onCopy(invitation)}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1.5 px-3 rounded text-sm transition-colors"
          >
            {isCopied ? 'Copied!' : 'Copy Link'}
          </button>
        )}
        {canResend && (
          <button
            onClick={() => onResend(invitation.id)}
            disabled={isResending}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-1.5 px-3 rounded text-sm transition-colors"
          >
            {isResending ? 'Resending...' : 'Resend'}
          </button>
        )}
      </div>
    </div>
  )
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }): React.ReactElement {
  return (
    <span className="text-gray-400 hover:text-gray-600">
      <svg
        className={`h-5 w-5 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </span>
  )
}

function LoadingSpinner(): React.ReactElement {
  return (
    <div className="text-center py-4">
      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
      <p className="mt-2 text-sm text-gray-600">Loading invitations...</p>
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
