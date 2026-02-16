'use client'

import { useState, useCallback } from 'react'
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

export default function ParticipantsSection({
  league,
  participants,
  currentUserId,
  isLocked,
  onKick,
}: Props): React.ReactElement {
  const [kickTarget, setKickTarget] = useState<ParticipantWithProfile | null>(null)

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
      toast.success(data.message)
      onKick(kickTarget.id)
      setKickTarget(null)
    }
  }, [kickTarget, league.id, onKick])

  const { execute: handleConfirmKick, isLoading: isKicking } = useAsyncAction(kickAction)

  return (
    <>
      <section className="card p-6">
        <SectionHeader
          icon={UserCog}
          title="Participants"
          description={isLocked ? 'Locked after draft starts' : 'Manage league members'}
          isLocked={isLocked}
        />

        {isLocked && (
          <div className="mb-4">
            <LockedMessage message="Participants cannot be removed after the draft has started." />
          </div>
        )}

        <div className="space-y-2">
          {participants.map((participant) => {
            const isOwner = participant.role === 'owner'
            const isSelf = participant.user_id === currentUserId
            const canKick = !isLocked && !isOwner && !isSelf

            return (
              <div
                key={participant.id}
                className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {getParticipantDisplayName(participant)}
                      </span>
                      {isOwner && (
                        <Crown className="w-4 h-4 text-gold" title="League Owner" />
                      )}
                    </div>
                    {participant.teams && (
                      <span className="text-xs text-foreground-muted">
                        {participant.teams.name}
                      </span>
                    )}
                  </div>
                </div>

                {canKick && (
                  <button
                    type="button"
                    onClick={() => setKickTarget(participant)}
                    className="btn btn-ghost text-crimson hover:bg-crimson/10 p-2"
                    title="Remove from league"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {participants.length === 0 && (
          <p className="text-center text-foreground-muted py-8">
            No participants yet
          </p>
        )}
      </section>

      {kickTarget && (
        <ConfirmKickModal
          participant={kickTarget}
          onConfirm={handleConfirmKick}
          onCancel={() => setKickTarget(null)}
          loading={isKicking}
        />
      )}
    </>
  )
}
