'use client'

import { ArrowRightIcon } from './Icons'
import { cn } from './utils'
import type { ParticipantWithProfile } from '@/types'

interface Props {
  participants: ParticipantWithProfile[]
  currentPickIndex: number
  currentUserId: string
  rounds: number
}

interface QueueItem {
  participant: ParticipantWithProfile
  round: number
  pickNumber: number
  isCurrentPick: boolean
  isCurrentUser: boolean
}

function calculatePickOrder(
  participants: ParticipantWithProfile[],
  currentPickIndex: number,
  rounds: number,
  currentUserId: string
): QueueItem[] {
  const queue: QueueItem[] = []
  const totalParticipants = participants.length
  const totalPicks = totalParticipants * rounds

  // Show 5 upcoming picks including current
  for (let i = 0; i < 5 && currentPickIndex + i < totalPicks; i++) {
    const pickIndex = currentPickIndex + i
    const round = Math.floor(pickIndex / totalParticipants) + 1
    const pickInRound = (pickIndex % totalParticipants) + 1

    // Snake draft: reverse on even rounds
    const draftOrder = round % 2 === 0
      ? totalParticipants - pickInRound + 1
      : pickInRound

    const participant = participants.find((p) => p.draft_order === draftOrder)
    if (participant) {
      queue.push({
        participant,
        round,
        pickNumber: pickInRound,
        isCurrentPick: i === 0,
        isCurrentUser: participant.user_id === currentUserId,
      })
    }
  }

  return queue
}

function getQueueItemStyles(isCurrentPick: boolean, isCurrentUser: boolean): string {
  if (isCurrentPick && isCurrentUser) {
    return 'bg-success-bg border-success animate-glow-pulse'
  }
  if (isCurrentPick) {
    return 'bg-gold-muted border-gold'
  }
  if (isCurrentUser) {
    return 'bg-success-bg/50 border-success/50'
  }
  return 'bg-elevated border-border'
}

function getPositionBadgeStyles(isCurrentPick: boolean, isCurrentUser: boolean): string {
  if (isCurrentPick && isCurrentUser) {
    return 'bg-success text-background'
  }
  if (isCurrentPick) {
    return 'bg-gold text-background'
  }
  return 'bg-border text-foreground-muted'
}

export default function PickOrderQueue({
  participants,
  currentPickIndex,
  currentUserId,
  rounds,
}: Props) {
  const totalPicks = participants.length * rounds
  const queue = calculatePickOrder(participants, currentPickIndex, rounds, currentUserId)

  if (queue.length === 0) {
    return null
  }

  return (
    <div className="space-y-2" data-testid="pick-order-queue">
      <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
        Upcoming Picks
      </h4>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-none">
        {queue.map((item, index) => (
          <div
            key={`${item.round}-${item.pickNumber}`}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border transition-all',
              getQueueItemStyles(item.isCurrentPick, item.isCurrentUser)
            )}
          >
            {/* Position indicator */}
            <div
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                getPositionBadgeStyles(item.isCurrentPick, item.isCurrentUser)
              )}
            >
              {index + 1}
            </div>

            {/* Team info */}
            <div className="min-w-0">
              <p
                className={cn(
                  'text-sm font-medium truncate max-w-20 sm:max-w-32',
                  item.isCurrentPick ? 'text-foreground' : 'text-foreground-secondary'
                )}
              >
                {item.participant.teams?.name || 'Unknown'}
              </p>
              {item.participant.profiles?.display_name && (
                <p className="text-xs text-foreground-muted truncate max-w-20 sm:max-w-32">
                  {item.participant.profiles.display_name}
                </p>
              )}
              <p className="text-xs text-foreground-muted">
                R{item.round} P{item.pickNumber}
              </p>
            </div>

            {/* Current user indicator */}
            {item.isCurrentUser && (
              <span className="text-xs font-medium text-success">You</span>
            )}

            {/* Current pick arrow */}
            {item.isCurrentPick && (
              <ArrowRightIcon
                className={cn('w-4 h-4', item.isCurrentUser ? 'text-success' : 'text-gold')}
              />
            )}
          </div>
        ))}

        {/* More picks indicator */}
        {currentPickIndex + 5 < totalPicks && (
          <div className="flex-shrink-0 flex items-center px-3">
            <span className="text-xs text-foreground-muted">
              +{totalPicks - currentPickIndex - 5} more
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
