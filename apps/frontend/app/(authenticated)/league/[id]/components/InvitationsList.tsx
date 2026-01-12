'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { formatDate, isExpired } from '@/utils/date'
import { LoadingSpinner } from '@/app/components/LoadingSpinner'
import { ErrorAlert } from '@/app/components/FormError'
import type { Invitation } from '@/types'

interface Props {
  leagueId: string
  isOwner: boolean
  leagueStatus: string
}

type EffectiveStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'

export default function InvitationsList({ leagueId, isOwner, leagueStatus }: Props): React.ReactElement | null {
  const supabase = createClient()

  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
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

  async function handleCancel(invitationId: string): Promise<void> {
    setCancellingId(invitationId)
    setError(null)

    const { error: cancelError } = await callEdgeFunction('cancel-invitation', {
      body: { invitation_id: invitationId },
    })

    if (cancelError) {
      setError(cancelError)
    } else {
      setInvitations((prev) =>
        prev.map((inv) =>
          inv.id === invitationId
            ? { ...inv, status: 'cancelled' as const, responded_at: new Date().toISOString() }
            : inv
        )
      )
    }

    setCancellingId(null)
  }

  if (!isOwner || leagueStatus !== 'setup') {
    return null
  }

  const pendingCount = invitations.filter((inv) => getEffectiveStatus(inv) === 'pending').length
  const expiredCount = invitations.filter((inv) => getEffectiveStatus(inv) === 'expired').length

  return (
    <div className="card mt-6">
      <button
        className="w-full px-4 py-4 sm:px-6 flex justify-between items-center hover:bg-surface-hover transition-colors rounded-t-lg"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium text-foreground">Invitations</h3>
          <span className="text-sm text-foreground-muted">
            ({invitations.length} total
            {pendingCount > 0 && `, ${pendingCount} pending`}
            {expiredCount > 0 && `, ${expiredCount} expired`})
          </span>
        </div>
        <ChevronIcon isExpanded={isExpanded} />
      </button>

      {isExpanded && (
        <div className="border-t border-border px-4 py-4 sm:px-6">
          {loading ? (
            <LoadingSpinner message="Loading invitations..." />
          ) : invitations.length === 0 ? (
            <p className="text-sm text-foreground-muted text-center py-4">
              No invitations sent yet. Use the &quot;Invite Players&quot; button to invite people to your league.
            </p>
          ) : (
            <>
              {error && <ErrorAlert message={error} />}

              <div className="space-y-3">
                {invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    onCopy={handleCopyLink}
                    onResend={handleResend}
                    onCancel={handleCancel}
                    isResending={resendingId === invitation.id}
                    isCancelling={cancellingId === invitation.id}
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

const STATUS_CONFIG: Record<EffectiveStatus, { bg: string; dot: string; label: string }> = {
  pending: { bg: 'bg-warning-bg', dot: 'bg-warning', label: 'Pending' },
  accepted: { bg: 'bg-success-bg', dot: 'bg-success', label: 'Accepted' },
  declined: { bg: 'bg-error-bg', dot: 'bg-error', label: 'Declined' },
  expired: { bg: 'bg-elevated', dot: 'bg-foreground-muted', label: 'Expired' },
  cancelled: { bg: 'bg-elevated', dot: 'bg-foreground-muted', label: 'Cancelled' },
}

interface InvitationRowProps {
  invitation: Invitation
  onCopy: (invitation: Invitation) => void
  onResend: (id: string) => void
  onCancel: (id: string) => void
  isResending: boolean
  isCancelling: boolean
  isCopied: boolean
}

function InvitationRow({ invitation, onCopy, onResend, onCancel, isResending, isCancelling, isCopied }: InvitationRowProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const status = getEffectiveStatus(invitation)
  const statusConfig = STATUS_CONFIG[status]
  const canCopy = status === 'pending'
  const canCancel = status === 'pending'
  const canResend = status === 'expired'
  const hasActions = canCopy || canCancel || canResend

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  return (
    <div className={`group relative flex items-center justify-between p-3 rounded-lg border border-border ${statusConfig.bg} transition-all duration-150 hover:border-border-hover`}>
      {/* Left side: Email and metadata */}
      <div className="flex-1 min-w-0 pr-4">
        <div className="flex items-center gap-2.5">
          <span className="font-medium text-foreground truncate">{invitation.email}</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-foreground-secondary bg-surface border border-border shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
            {statusConfig.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-foreground-muted">
          Sent {formatDate(invitation.sent_at)}
          {invitation.responded_at && <span> · Responded {formatDate(invitation.responded_at)}</span>}
        </p>
      </div>

      {/* Right side: Actions menu */}
      {hasActions && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface transition-colors"
            aria-label="Actions"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-44 bg-surface rounded-lg shadow-heavy border border-border py-1 z-20 animate-fade-in">
              {canCopy && (
                <button
                  onClick={() => {
                    onCopy(invitation)
                    setMenuOpen(false)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-surface-hover transition-colors"
                >
                  {isCopied ? (
                    <>
                      <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-success">Copied!</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                      </svg>
                      Copy invite link
                    </>
                  )}
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => {
                    onCancel(invitation.id)
                    setMenuOpen(false)
                  }}
                  disabled={isCancelling}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-crimson hover:bg-error-bg disabled:opacity-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {isCancelling ? 'Cancelling...' : 'Cancel invitation'}
                </button>
              )}
              {canResend && (
                <button
                  onClick={() => {
                    onResend(invitation.id)
                    setMenuOpen(false)
                  }}
                  disabled={isResending}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gold hover:bg-gold-muted disabled:opacity-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  {isResending ? 'Resending...' : 'Resend invitation'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }): React.ReactElement {
  return (
    <span className="text-foreground-muted hover:text-foreground transition-colors">
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
