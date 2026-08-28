'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Trophy } from 'lucide-react'
import type { League } from '@/types'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import { SEASON_PILL_CLASS, championName, currentSeasonOf, resolveChampions } from '@/utils/seasons'

interface Props {
  /** Every season of one league the viewer is in, newest first. */
  seasons: League[]
}

/**
 * Who won a past season, by name. The season's frozen `final_standings` carries
 * the owner's display name and the team name together, so a champion chip costs
 * no lookup - and still names a champion who has since left the league.
 */
function championsOf(season: League): string[] {
  return resolveChampions(season.winner_team_ids, season.final_standings ?? []).map(
    (champion) => champion.ownerName ?? championName(champion)
  )
}

/**
 * One card per league, showing the season you would actually open.
 *
 * The card *is* the current season - identical anatomy to the single-season
 * card it replaced - so the common case looks unchanged and only a league with
 * history grows the extra row.
 */
export default function SeriesListItem({ seasons }: Props): React.ReactElement | null {
  const [isExpanded, setIsExpanded] = useState(false)

  const current = currentSeasonOf(seasons)
  if (!current) return null

  const past = seasons.filter((season) => season.id !== current.id)

  return (
    <div className="card card-interactive">
      {/* The link wraps only the top block: the expander below is a real button,
          and nesting one inside a link breaks keyboard navigation. */}
      <Link href={`/league/${current.id}`} className="group block p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2.5">
              <h3 className="truncate font-display font-semibold text-foreground transition-colors group-hover:text-gold">
                {current.name}
              </h3>
              <span className={`badge shrink-0 ${STATUS_BADGE_CLASS[current.status]}`}>
                {getStatusLabel(current.status)}
              </span>
              {/* A status token and a year are two facts, so they stay two
                  elements rather than merging into one badge. */}
              <span className={`${SEASON_PILL_CLASS} shrink-0`}>{current.season_year}</span>
            </div>
            <p className="text-sm text-foreground-muted">
              {current.invite_only ? 'Private' : 'Open'} · {current.max_participants} participants ·
              Created{' '}
              {new Date(current.created_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover opacity-0 transition-opacity group-hover:opacity-100">
            <svg className="h-4 w-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </Link>

      {past.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setIsExpanded((open) => !open)}
            aria-expanded={isExpanded}
            className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
          >
            <ChevronDown
              className={`h-4 w-4 flex-none text-foreground-muted transition-transform duration-300 ${
                isExpanded ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
            <span className="text-sm text-foreground-secondary">
              {past.length} past {past.length === 1 ? 'season' : 'seasons'}
            </span>
          </button>

          {isExpanded && (
            <ul className="animate-fade-in px-4 pb-3">
              {past.map((season) => {
                const champions = championsOf(season)
                return (
                  <li key={season.id}>
                    <Link
                      href={`/league/${season.id}/standings`}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover"
                    >
                      <span className={`badge shrink-0 ${STATUS_BADGE_CLASS[season.status]}`}>
                        {season.season_year} · {getStatusLabel(season.status)}
                      </span>
                      {champions.length > 0 && (
                        <span className="flex min-w-0 items-center gap-1 rounded-full bg-gold-muted px-2 py-px text-[11px] text-gold">
                          <Trophy className="h-3 w-3 flex-none" aria-hidden="true" />
                          <span className="truncate">{champions.join(' · ')}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
