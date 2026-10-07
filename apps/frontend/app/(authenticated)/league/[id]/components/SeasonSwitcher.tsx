'use client'

import { useId, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Trophy } from 'lucide-react'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import { SEASON_PILL_CLASS, SEASON_YEAR_CLASS } from '@/utils/seasons'
import type { SeasonSummary } from '@/types'
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss'

interface Props {
  currentLeagueId: string
  /** The season being viewed. Shown even when there is nothing to switch to. */
  seasonYear: number
  /** Every season of this series the viewer can see, newest first. */
  seasons: SeasonSummary[]
  /** League ids of seasons this viewer won, for the trophy mark. */
  wonSeasonIds?: string[]
}

/**
 * The season label, which becomes a menu once a series has more than one
 * season.
 *
 * It sits beside the league switcher rather than inside it, because the two
 * answer different questions: the league switcher answers *which league*, this
 * answers *which year of this league*. Nesting seasons under leagues would make
 * that list O(leagues x seasons) and force everyone with three leagues to scan
 * past years they did not ask for.
 *
 * Until a second season exists it is static text - today's users see no new
 * control at all.
 */
export default function SeasonSwitcher({
  currentLeagueId,
  seasonYear,
  seasons,
  wonSeasonIds = [],
}: Props): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const listLabelId = useId()
  const pathname = usePathname()

  // A disclosure of links: closes on a click or Tab outside it, and on Escape,
  // which returns focus to the season button.
  const closeMenu = useCallback(() => setIsOpen(false), [])
  usePopoverDismiss(isOpen, closeMenu, menuRef, triggerRef)

  if (seasons.length < 2) {
    return (
      <span className={`${SEASON_PILL_CLASS} flex-none`} data-testid="season-pill">
        <span className="sr-only">Season </span>
        {seasonYear}
      </span>
    )
  }

  /** Switching seasons keeps you on the page you were reading. */
  function seasonUrl(leagueId: string): string {
    const segments = pathname.split('/')
    const tabSegment = segments.length > 3 ? segments.slice(3).join('/') : 'dashboard'
    return `/league/${leagueId}/${tabSegment}`
  }

  return (
    <div className="relative flex-none" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={`Season ${seasonYear}, switch season`}
        className={`${SEASON_PILL_CLASS} flex cursor-pointer items-center gap-1 transition-colors hover:text-gold`}
        data-testid="season-pill"
      >
        {seasonYear}
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div id={menuId} className="glass card animate-fade-in absolute left-0 z-50 mt-2 w-56" data-testid="season-switcher-menu">
          <div className="border-b border-border px-4 py-2">
            <p id={listLabelId} className="text-sm font-semibold text-foreground-secondary">Seasons</p>
          </div>

          <ul className="max-h-[50vh] overflow-y-auto py-1" role="list" aria-labelledby={listLabelId}>
            {seasons.map((season) => {
              const isCurrent = season.id === currentLeagueId
              return (
                <li key={season.id}>
                  <Link
                    href={seasonUrl(season.id)}
                    aria-current={isCurrent ? 'page' : undefined}
                    onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
                      if (isCurrent) event.preventDefault()
                      setIsOpen(false)
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-surface-hover"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${isCurrent ? 'bg-gold' : 'bg-transparent'}`}
                    />
                    <span
                      className={`flex-1 text-sm ${SEASON_YEAR_CLASS} ${isCurrent ? 'text-gold' : 'text-foreground'}`}
                    >
                      {season.season_year}
                    </span>
                    {wonSeasonIds.includes(season.id) && (
                      <>
                        <Trophy className="h-3.5 w-3.5 flex-none text-gold" aria-hidden="true" />
                        <span className="sr-only">You won this season</span>
                      </>
                    )}
                    <span className={`badge text-xs ${STATUS_BADGE_CLASS[season.status]}`}>
                      {getStatusLabel(season.status)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>

          <div className="border-t border-border px-4 py-2.5">
            <Link
              href={`/league/${currentLeagueId}/history`}
              onClick={() => setIsOpen(false)}
              className="text-sm text-foreground-secondary transition-colors hover:text-gold"
            >
              All seasons <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
