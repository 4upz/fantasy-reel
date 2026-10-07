'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { formatDate, isExpired } from '@/utils/date'
import type { LeagueInvitation } from '@/types'
import { ErrorAlert } from '@/app/components/FormError'
import { LoadingSpinner } from '@/app/components/LoadingSpinner'
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss'

interface Props {
  leagueId: string
  isOwner: boolean
  leagueStatus: string
}

type EffectiveStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'

export default function InvitationsList({ leagueId, isOwner, leagueStatus }: Props): React.ReactElement | null {
  const supabase = useMemo(() => createClient(), [])

  const [invitations, setInvitations] = useState<LeagueInvitation[]>([])
  const [loading, setLoading] = useState(true)
  // Realtime refetches keep the rows on screen; only the first load shows a
  // spinner, so a focused row is never swapped out from under the user.
  const [hasLoaded, setHasLoaded] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const panelId = useId()

  const fetchInvitations = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)

    // Owners can't read username invites directly; this RPC lists every
    // invitation with those invitees' emails withheld.
    const { data, error: queryError } = await supabase
      .rpc('get_league_invitations', { p_league_id: leagueId })

    if (queryError) {
      console.error('Error fetching invitations:', queryError)
      setError('Failed to load invitations')
    } else {
      setInvitations(data || [])
    }

    setLoading(false)
    setHasLoaded(true)
  }, [supabase, leagueId])

  // Initial fetch
  useEffect(() => {
    if (isOwner) {
      fetchInvitations()
    }
  }, [isOwner, fetchInvitations])

  // Real-time subscription for invitation updates
  useEffect(() => {
    if (!isOwner) return

    const channel = supabase
      .channel(`invitations-${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invitations',
          filter: `league_id=eq.${leagueId}`,
        },
        fetchInvitations
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, leagueId, isOwner, fetchInvitations])

  async function handleCopy(invitation: LeagueInvitation): Promise<void> {
    const inviteUrl = `${window.location.origin}/join?token=${invitation.token}`

    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast.success('Invite link copied')
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
                status: data.invitation.status as LeagueInvitation['status'],
                expires_at: data.invitation.expires_at,
                sent_at: new Date().toISOString(),
                responded_at: null,
              }
            : inv
        )
      )

      try {
        await navigator.clipboard.writeText(data.invite_url)
        toast.success('Invitation renewed. New invite link copied')
      } catch {
        toast.success('Invitation renewed')
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
      toast.success('Invitation cancelled')
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
      <h3 className="type-panel text-foreground">
        <button
          className="w-full px-4 py-4 sm:px-6 flex justify-between items-center text-left cursor-pointer hover:bg-surface-hover transition-colors rounded-t-lg"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? panelId : undefined}
        >
          <span className="flex items-center gap-3">
            <span>Invitations</span>
            <span className="type-body-sm text-foreground-secondary">
              ({invitations.length} total
              {pendingCount > 0 && `, ${pendingCount} pending`}
              {expiredCount > 0 && `, ${expiredCount} expired`})
            </span>
          </span>
          <ChevronIcon isExpanded={isExpanded} />
        </button>
      </h3>

      {isExpanded && (
        <div id={panelId} className="border-t border-border px-4 py-4 sm:px-6">
          {loading && !hasLoaded ? (
            <div role="status">
              <LoadingSpinner message="Loading invitations..." />
            </div>
          ) : (
            <>
              {/* Before the empty check: a failed load is not "no invitations". */}
              {error && <ErrorAlert message={error} />}

              {invitations.length === 0 ? (
                !error && (
                  <p className="type-body-sm text-foreground-secondary text-center py-4">
                    No invitations sent yet. Use the &quot;Invite Players&quot; button to invite people to your league.
                  </p>
                )
              ) : (
                <ul className="space-y-3" role="list">
                  {invitations.map((invitation) => (
                    <InvitationRow
                      key={invitation.id}
                      invitation={invitation}
                      onCopy={handleCopy}
                      onResend={handleResend}
                      onCancel={handleCancel}
                      isResending={resendingId === invitation.id}
                      isCancelling={cancellingId === invitation.id}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function getEffectiveStatus(invitation: LeagueInvitation): EffectiveStatus {
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
  invitation: LeagueInvitation
  onCopy: (invitation: LeagueInvitation) => void
  onResend: (id: string) => void
  onCancel: (id: string) => void
  isResending: boolean
  isCancelling: boolean
}

function InvitationRow({ invitation, onCopy, onResend, onCancel, isResending, isCancelling }: InvitationRowProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const inviteeName = invitation.email ?? invitation.invitee_display_name ?? 'Invited user'
  const status = getEffectiveStatus(invitation)
  const statusConfig = STATUS_CONFIG[status]
  const canCopy = status === 'pending'
  const canCancel = status === 'pending'
  const canResend = status === 'expired'
  const hasActions = canCopy || canCancel || canResend

  // A plain disclosure: closes on a click or Tab outside it, and on Escape,
  // which returns focus to the button that opened it.
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  usePopoverDismiss(menuOpen, closeMenu, menuRef, menuButtonRef)

  // Choosing an action closes the menu, removing the focused item with it.
  function runAction(action: () => void): void {
    setMenuOpen(false)
    menuButtonRef.current?.focus()
    action()
  }

  return (
    <li className={`group relative flex items-center justify-between p-3 rounded-lg border border-border ${statusConfig.bg} transition-all duration-150 hover:border-border-hover`}>
      {/* Left side: Email and metadata */}
      <div className="flex-1 min-w-0 pr-4">
        <div className="flex items-center gap-2.5">
          <span className="font-medium text-foreground truncate">
            {inviteeName}
          </span>
          <span className="type-meta inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-foreground-secondary bg-surface border border-border shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} aria-hidden="true" />
            {statusConfig.label}
          </span>
        </div>
        <p className="type-meta mt-0.5 text-foreground-secondary">
          Sent {formatDate(invitation.sent_at)}
          {invitation.responded_at && <span><span aria-hidden="true"> · </span><span className="sr-only">, </span>Responded {formatDate(invitation.responded_at)}</span>}
        </p>
      </div>

      {/* Right side: Actions menu */}
      {hasActions && (
        <div className="relative" ref={menuRef}>
          <button
            ref={menuButtonRef}
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 rounded-md cursor-pointer text-foreground-secondary hover:text-foreground hover:bg-surface transition-colors"
            aria-label={`Actions for ${inviteeName}`}
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div id={menuId} className="absolute right-0 mt-1 w-44 bg-surface rounded-lg shadow-heavy border border-border py-1 z-20 animate-fade-in">
              {canCopy && (
                <button
                  onClick={() => runAction(() => onCopy(invitation))}
                  className="type-control w-full flex items-center gap-2.5 px-3 py-2 cursor-pointer text-foreground hover:bg-surface-hover transition-colors"
                >
                  <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" focusable="false">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  </svg>
                  Copy invite link
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => runAction(() => onCancel(invitation.id))}
                  disabled={isCancelling}
                  className="type-control w-full flex items-center gap-2.5 px-3 py-2 cursor-pointer text-crimson-text hover:bg-error-bg disabled:opacity-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" focusable="false">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {isCancelling ? 'Cancelling...' : 'Cancel invitation'}
                </button>
              )}
              {canResend && (
                <button
                  onClick={() => runAction(() => onResend(invitation.id))}
                  disabled={isResending}
                  className="type-control w-full flex items-center gap-2.5 px-3 py-2 cursor-pointer text-gold hover:bg-gold-muted disabled:opacity-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" focusable="false">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  {isResending ? 'Resending...' : 'Resend invitation'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }): React.ReactElement {
  return (
    <span className="text-foreground-secondary hover:text-foreground transition-colors" aria-hidden="true">
      <svg
        className={`h-5 w-5 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        focusable="false"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </span>
  )
}
