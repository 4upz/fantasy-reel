import type { ReactNode } from 'react'
import DraftProgressRing from './DraftProgressRing'
import { ArrowUpIcon, ClockIcon } from './Icons'

interface Props {
  picksMade: number
  totalPicks: number
  turn: {
    round: number
    pickNumber: number
    teamName: string
    ownerName: string | null
  } | null
  isMyTurn?: boolean
  isDraftComplete?: boolean
  queue?: ReactNode
  /** A preview shows the wide app layout inside its resizable camera. */
  layout?: 'responsive' | 'wide'
}

/** @design-system League */
export default function DraftBoardHeader({
  picksMade,
  totalPicks,
  turn,
  isMyTurn = false,
  isDraftComplete = false,
  queue,
  layout = 'responsive',
}: Props) {
  const wide = layout === 'wide'

  return (
    <div className={`card ${wide ? 'p-6' : 'p-4 sm:p-6'}`}>
      <div className={wide
        ? 'flex items-start justify-between gap-6'
        : 'flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6'}>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="type-section text-foreground">Draft board</h2>
          </div>
          {turn && (
            <div
              className={`p-4 rounded-xl border-2 transition-all ${isMyTurn
                ? 'bg-success-bg border-success shadow-glow-gold animate-glow-pulse'
                : 'bg-elevated border-border'}`}
            >
              <div
                className={`flex items-center gap-3${wide ? ' w-fit max-w-full' : ''}`}
                data-preview-focus="turn"
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isMyTurn
                  ? 'bg-success text-background'
                  : 'bg-gold text-background'}`}>
                  {isMyTurn ? <ArrowUpIcon className="w-6 h-6" /> : <ClockIcon className="w-6 h-6" />}
                </div>
                <div>
                  <p className="type-body-sm text-foreground-secondary">Round {turn.round}, Pick {turn.pickNumber}</p>
                  <p className={`type-card ${isMyTurn ? 'text-success' : 'text-foreground'}`}>
                    {isMyTurn ? "It's your turn!" : `${turn.teamName}'s pick`}
                  </p>
                  {!isMyTurn && turn.ownerName && (
                    <p className="type-meta text-foreground-secondary">{turn.ownerName}</p>
                  )}
                </div>
              </div>
            </div>
          )}
          {isDraftComplete && (
            <div className="p-4 rounded-xl bg-info-bg border-2 border-info">
              <p className="type-card text-info">All draft picks are in.</p>
              <p className="type-body-sm text-foreground-secondary mt-1">Waiting for the league owner to choose the next phase.</p>
            </div>
          )}
        </div>
        <div className={`flex-shrink-0 ${wide ? 'self-start' : 'self-center sm:self-start'}`}>
          <DraftProgressRing current={picksMade} total={totalPicks} size="lg" />
        </div>
      </div>
      {queue && (
        <div
          className={`border-t border-border ${wide ? 'mt-6 pt-6' : 'mt-4 pt-4 sm:mt-6 sm:pt-6'}`}
        >
          {queue}
        </div>
      )}
    </div>
  )
}
