'use client'

import Link from 'next/link'
import type { League } from '@/types'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'

interface Props {
  league: League
}

export default function LeagueListItem({ league }: Props): React.ReactElement {
  return (
    <Link href={`/league/${league.id}`} className="card card-interactive group block">
      <div className="p-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-display font-semibold text-foreground group-hover:text-gold transition-colors truncate">
              {league.name}
            </h3>
            <span className={`badge ${STATUS_BADGE_CLASS[league.status]} shrink-0`}>
              {getStatusLabel(league.status)}
            </span>
          </div>
          <p className="text-foreground-muted text-sm">
            {league.invite_only ? 'Private' : 'Open'} · {league.max_participants} participants · Created{' '}
            {new Date(league.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>
        <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <svg className="w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  )
}
