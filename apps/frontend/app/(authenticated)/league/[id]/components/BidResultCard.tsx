'use client'

import Image from 'next/image'
import { Film } from 'lucide-react'
import type { BidHistoryResult, TeamWithOwner } from '@/types'
import { getBidTypeClass, getTmdbPosterUrl } from './utils'

interface Props {
  result: BidHistoryResult
  /** Team lookup for naming bidders; teams that have left may be missing. */
  teamsById: Map<string, TeamWithOwner>
  currentTeamId: string
}

function teamName(teamsById: Map<string, TeamWithOwner>, teamId: string): string {
  const team = teamsById.get(teamId)
  return team?.name || team?.display_name || 'Unknown team'
}

/**
 * What the winner beat the field by. The number a bare list of prices hides:
 * it's the difference between a steal and a bidding war, and it's the reason
 * to read the row underneath.
 */
function marginNote(result: BidHistoryResult): string | null {
  if (!result.winner) return null
  const runnerUp = result.losers[0]
  if (!runnerUp) return 'no other bids'
  const margin = result.winner.amount - runnerUp.amount
  // process-bids breaks a tie on whoever bid first, so "won by $0" would be
  // true but unhelpful - say what actually decided it.
  if (margin === 0) return 'tied, won on the earlier bid'
  return `won by $${margin}`
}

export default function BidResultCard({
  result,
  teamsById,
  currentTeamId,
}: Props): React.ReactElement {
  const posterUrl = getTmdbPosterUrl(result.posterUrl, 'w92')
  const wonByMe = result.winner?.teamId === currentTeamId
  const lostByMe = result.losers.some((loser) => loser.teamId === currentTeamId)
  const margin = marginNote(result)

  return (
    <article
      className={`card ${getBidTypeClass(result.kind)} p-3 sm:p-4`}
      aria-label={`${result.title} bid result`}
    >
      <div className="flex gap-3">
        {/* Poster */}
        <div className="relative w-10 h-15 sm:w-12 sm:h-18 flex-none rounded overflow-hidden bg-elevated">
          {posterUrl ? (
            <Image
              src={posterUrl}
              alt=""
              fill
              sizes="48px"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-4 h-4 text-foreground-muted" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Title and outcome */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display font-semibold text-foreground leading-snug line-clamp-2">
                {result.title}
              </h3>
              {result.kind === 'counterpick' && result.targetTeamId && (
                <p className="text-xs text-crimson mt-0.5 truncate">
                  Counterpick on {teamName(teamsById, result.targetTeamId)}
                </p>
              )}
            </div>

            {/* Price, right-aligned so a round's amounts read as one column */}
            <div className="flex-none text-right">
              {result.winner ? (
                <p className="bid-amount-display text-xl sm:text-2xl tabular-nums leading-none">
                  ${result.winner.amount}
                </p>
              ) : (
                <p className="font-display font-semibold text-sm text-foreground-muted leading-none">
                  No winner
                </p>
              )}
              {(wonByMe || lostByMe) && (
                <span
                  className={`inline-block mt-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded ${
                    wonByMe ? 'bg-gold-muted text-gold' : 'bg-elevated text-foreground-muted'
                  }`}
                >
                  {wonByMe ? 'You won' : 'You lost'}
                </span>
              )}
            </div>
          </div>

          {result.winner && (
            <p className="text-sm text-foreground-secondary mt-1 truncate">
              <span className={wonByMe ? 'text-gold' : undefined}>
                {teamName(teamsById, result.winner.teamId)}
              </span>
              {margin && <span className="text-foreground-muted"> · {margin}</span>}
            </p>
          )}

          {/*
            The field sits in the same column as the title and price rather than
            spanning the card, so every name shares one left edge and every
            amount one right edge - the drop from the winning price reads as a
            ladder instead of two loose columns.
          */}
          {result.losers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-foreground-muted text-xs uppercase tracking-wide mb-1.5">
                {result.winner ? 'Also bid' : 'Bids'}
              </p>
              <ul className="space-y-1">
                {result.losers.map((loser) => {
                  const isMine = loser.teamId === currentTeamId
                  return (
                    <li key={loser.bidId} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className={`truncate ${isMine ? 'text-gold' : 'text-foreground-secondary'}`}>
                        {teamName(teamsById, loser.teamId)}
                      </span>
                      <span className="flex-none tabular-nums text-foreground-muted">
                        ${loser.amount}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
