'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { UserCog, Crown, UserMinus } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { getParticipantDisplayName } from '@/utils/league'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import type { League, ParticipantWithProfile } from '@/types'
import { SectionHeader, LockedMessage } from './shared'
import ConfirmKickModal from './ConfirmKickModal'

interface Props {
  league: League
  participants: ParticipantWithProfile[]
  currentUserId: string
  isLocked: boolean
  onKick: (participantId: string) => void
}

interface KickResponse {
  message: string
}

/** A removal that just finished: what to say, and whose button takes focus next. */
interface KickResult {
  message: string
  nextFocusId: string | null
}

export default function ParticipantsSection({
  league,
  participants,
  currentUserId,
  isLocked,
  onKick,
}: Props): React.ReactElement {
  const [kickTarget, setKickTarget] = useState<ParticipantWithProfile | null>(null)
  const [kickResult, setKickResult] = useState<KickResult | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const canKick = useCallback(
    (participant: ParticipantWithProfile) =>
      !isLocked && participant.role !== 'owner' && participant.user_id !== currentUserId,
    [isLocked, currentUserId]
  )

  const kickAction = useCallback(async () => {
    if (!kickTarget) return

    const { data, error } = await callEdgeFunction<KickResponse>('update-league', {
      body: {
        action: 'kick_participant',
        league_id: league.id,
        participant_id: kickTarget.id,
      },
    })

    if (error) throw new Error(error)

    if (data?.message) {
      // The row that opened the dialog is about to go, so focus moves to the
      // next removable participant (or the previous one, or the list).
      const index = participants.findIndex((p) => p.id === kickTarget.id)
      const removable = (p: ParticipantWithProfile) => p.id !== kickTarget.id && canKick(p)
      const next =
        participants.slice(index + 1).find(removable) ??
        participants.slice(0, Math.max(index, 0)).reverse().find(removable) ??
        null

      setKickResult({ message: data.message, nextFocusId: next?.id ?? null })
      onKick(kickTarget.id)
      setKickTarget(null)
    }
  }, [kickTarget, league.id, onKick, participants, canKick])

  const { execute: handleConfirmKick, isLoading: isKicking, error: kickError, reset: resetKickError } =
    useAsyncAction(kickAction)

  // Runs after the dialog has closed and the row is gone. The toast is raised
  // here rather than in kickAction so it can never land while the dialog still
  // makes the page (and the toaster's live region) inert; it is the only
  // announcement of the result.
  useEffect(() => {
    if (!kickResult) return
    toast.success(kickResult.message)
    const nextButton = kickResult.nextFocusId
      ? listRef.current?.querySelector<HTMLElement>(`[data-kick-participant="${kickResult.nextFocusId}"]`)
      : null
    ;(nextButton ?? listRef.current)?.focus()
    setKickResult(null)
  }, [kickResult])

  return (
    <>
      <section className="card p-6">
        <SectionHeader
          icon={UserCog}
          title="Participants"
          headingId="participants_heading"
          description={isLocked ? 'Locked after draft starts' : 'Manage league members'}
          isLocked={isLocked}
        />

        {isLocked && (
          <div className="mb-4">
            <LockedMessage message="Participants cannot be removed after the draft has started." />
          </div>
        )}

        <ul
          ref={listRef}
          role="list"
          aria-labelledby="participants_heading"
          // A focus target for when the last removable participant goes.
          tabIndex={-1}
          className="space-y-2"
        >
          {participants.map((participant) => {
            const isOwner = participant.role === 'owner'
            const displayName = getParticipantDisplayName(participant)

            return (
              <li
                key={participant.id}
                className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="type-label text-foreground">
                        {displayName}
                      </span>
                      {isOwner && (
                        <>
                          <Crown className="w-4 h-4 text-gold" aria-hidden="true" />
                          <span className="sr-only">(league owner)</span>
                        </>
                      )}
                    </div>
                    {participant.teams && (
                      <span className="type-meta text-foreground-secondary">
                        {participant.teams.name}
                      </span>
                    )}
                  </div>
                </div>

                {canKick(participant) && (
                  <button
                    type="button"
                    onClick={() => {
                      resetKickError()
                      setKickTarget(participant)
                    }}
                    className="btn btn-ghost text-crimson-text hover:bg-crimson/10 p-2"
                    title="Remove from league"
                    aria-label={`Remove ${displayName} from league`}
                    data-kick-participant={participant.id}
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {participants.length === 0 && (
          <p className="text-center text-foreground-secondary py-8">
            No participants yet
          </p>
        )}
      </section>

      {kickTarget && (
        <ConfirmKickModal
          participant={kickTarget}
          onConfirm={() => handleConfirmKick().catch(() => {
            /* shown in the dialog via kickError */
          })}
          onCancel={() => setKickTarget(null)}
          loading={isKicking}
          error={kickError}
        />
      )}
    </>
  )
}
