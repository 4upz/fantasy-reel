'use client'

import Link from 'next/link'
import type { League } from '@/types'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'

interface Props {
  league: League
}

export default function LeagueListItem({ league }: Props): React.ReactElement {
  return (
    <Link href={`/league/${league.id}`} className="league-list-item cursor-pointer group">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-2 h-2 rounded-full bg-gold shrink-0" />
        <span className="font-semibold text-foreground group-hover:text-gold transition-colors truncate">
          {league.name}
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`badge ${STATUS_BADGE_CLASS[league.status]}`}>
          {getStatusLabel(league.status)}
        </span>
        <svg className="w-4 h-4 text-foreground-muted group-hover:text-gold transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}
