import { ArrowRightIcon } from './Icons'
import { cn } from './utils'
import type { ParticipantWithProfile, Team, Profile } from '@/types'

export type PickQueueParticipant = Pick<ParticipantWithProfile, 'user_id' | 'draft_order'> & {
  teams: Pick<Team, 'name'> | null
  profiles: Pick<Profile, 'display_name'> | null
}

interface Props {
  participants: readonly PickQueueParticipant[]
  currentPickIndex: number
  currentUserId: string
  rounds: number
}

interface QueueItem {
  participant: PickQueueParticipant
  round: number
  pickNumber: number
  isCurrentPick: boolean
  isCurrentUser: boolean
}

function calculatePickOrder(
  participants: readonly PickQueueParticipant[],
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
    return 'bg-success text-foreground-inverse'
  }
  if (isCurrentPick) {
    return 'bg-gold text-foreground-inverse'
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
  const nextUserPickIndex = queue.findIndex((item) => item.isCurrentUser)

  if (queue.length === 0) {
    return null
  }

  return (
    <div className="space-y-2" data-testid="pick-order-queue">
      <h4 className="type-label text-foreground-secondary">
        Upcoming picks
      </h4>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-none">
        {queue.map((item, index) => (
          <div
            key={`${item.round}-${item.pickNumber}`}
            data-preview-focus={index === nextUserPickIndex ? 'queue' : undefined}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border transition-all',
              getQueueItemStyles(item.isCurrentPick, item.isCurrentUser)
            )}
          >
            {/* Position indicator */}
            <div
              className={cn(
                'type-meta w-6 h-6 rounded-full flex items-center justify-center',
                getPositionBadgeStyles(item.isCurrentPick, item.isCurrentUser)
              )}
            >
              {index + 1}
            </div>

            {/* Team info */}
            <div className="min-w-0">
              <p
                className={cn(
                  'type-label truncate max-w-20 sm:max-w-32',
                  item.isCurrentPick ? 'text-foreground' : 'text-foreground-secondary'
                )}
              >
                {item.participant.teams?.name || 'Unknown'}
              </p>
              {item.participant.profiles?.display_name && (
                <p className="type-meta text-foreground-secondary truncate max-w-20 sm:max-w-32">
                  {item.participant.profiles.display_name}
                </p>
              )}
              <p className="type-meta text-foreground-secondary">
                R{item.round} P{item.pickNumber}
              </p>
            </div>

            {/* Current user indicator */}
            {item.isCurrentUser && (
              <span className="type-meta text-success">You</span>
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
            <span className="type-meta text-foreground-secondary">
              +{totalPicks - currentPickIndex - 5} more
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
