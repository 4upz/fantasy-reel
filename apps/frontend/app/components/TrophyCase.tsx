'use client'

import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { SEASON_YEAR_CLASS } from '@/utils/seasons'

export interface Title {
  /** The season won, which is what the link opens. */
  leagueId: string
  seriesName: string
  seasonYear: number
}

interface Props {
  titles: Title[]
  /** Rows shown before the list is truncated. */
  limit?: number
}

/**
 * Every season this user has won.
 *
 * It lives on the dashboard rather than a profile page because the app has no
 * profile page - `/settings` is account settings - and inventing one is scope
 * this feature does not fund. The sidebar is already the "about you" column,
 * and it is the screen people land on.
 */
export default function TrophyCase({ titles, limit = 5 }: Props): React.ReactElement {
  const visible = titles.slice(0, limit)
  const hidden = titles.length - visible.length

  return (
    <div className="sidebar-action-card" data-testid="trophy-case">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold-muted">
          <Trophy className="h-5 w-5 text-gold" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-display font-semibold text-foreground">Trophy case</span>
          {titles.length > 0 ? (
            <p className="font-display text-sm text-gold">
              {titles.length} {titles.length === 1 ? 'championship' : 'championships'}
            </p>
          ) : (
            <p className="truncate text-sm text-foreground-muted">No titles yet</p>
          )}
        </div>
      </div>

      {titles.length === 0 ? (
        // An empty case is a hook, not an error: hiding it means nobody learns
        // that titles are a thing you can win.
        <p className="text-sm text-foreground-muted">Win a season to hang the first one.</p>
      ) : (
        <ul className="space-y-1">
          {visible.map((title) => (
            <li key={title.leagueId}>
              <Link
                href={`/league/${title.leagueId}/standings`}
                className="group flex items-baseline gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-surface-hover"
              >
                <span className={`flex-none text-[11px] text-foreground-muted ${SEASON_YEAR_CLASS}`}>
                  {title.seasonYear}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground transition-colors group-hover:text-gold">
                  {title.seriesName}
                </span>
              </Link>
            </li>
          ))}
          {hidden > 0 && (
            <li className="px-1 pt-1 text-xs text-foreground-muted">+{hidden} more</li>
          )}
        </ul>
      )}
    </div>
  )
}
