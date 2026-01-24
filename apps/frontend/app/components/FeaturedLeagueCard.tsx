'use client'

import Link from 'next/link'
import type { League } from '@/types'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'

interface Props {
  league: League
  isYourTurn?: boolean
  userRank?: number
  totalParticipants?: number
}

export default function FeaturedLeagueCard({
  league,
  isYourTurn = false,
  userRank,
  totalParticipants,
}: Props): React.ReactElement {
  const cardClass = `card-featured cursor-pointer group ${isYourTurn ? 'your-turn' : ''}`

  return (
    <Link href={`/league/${league.id}`} className={cardClass}>
      <div className="p-5 h-full flex flex-col">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold font-display text-foreground group-hover:text-gold transition-colors truncate">
                {league.name}
              </h3>
              <span className={`badge ${STATUS_BADGE_CLASS[league.status]} shrink-0`}>
                {getStatusLabel(league.status)}
              </span>
            </div>
            <p className="text-foreground-muted text-sm mt-1">
              {league.invite_only ? 'Private' : 'Open'} · {league.max_participants} participants max
            </p>
          </div>
          {/* Hover arrow indicator */}
          <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <svg className="w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>

        {/* Your turn indicator */}
        {isYourTurn && (
          <div className="mb-4 p-3 rounded-lg bg-success-bg border border-success">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-success font-semibold text-sm">It&apos;s your turn to draft!</span>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-6 text-sm">
          {userRank !== undefined && totalParticipants !== undefined && (
            <div>
              <span className="text-foreground-muted">Rank: </span>
              <span className="text-foreground font-semibold">{userRank}/{totalParticipants}</span>
            </div>
          )}
          <div className="text-foreground-muted">
            Created {new Date(league.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>
    </Link>
  )
}
