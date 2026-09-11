'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, Trophy } from 'lucide-react'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import { SEASON_PILL_CLASS, SEASON_YEAR_CLASS } from '@/utils/seasons'
import type { SeasonSummary } from '@/types'

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
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  if (seasons.length < 2) {
    return (
      <span className={`${SEASON_PILL_CLASS} flex-none`} data-testid="season-pill">
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
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Season ${seasonYear}. Switch season`}
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
        <div className="glass card animate-fade-in absolute left-0 z-50 mt-2 w-56">
          <div className="border-b border-border px-4 py-2">
            <p className="text-sm font-semibold text-foreground-secondary">Seasons</p>
          </div>

          <div className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
            {seasons.map((season) => {
              const isCurrent = season.id === currentLeagueId
              return (
                <button
                  key={season.id}
                  role="option"
                  aria-selected={isCurrent}
                  onClick={() => {
                    if (!isCurrent) router.push(seasonUrl(season.id))
                    setIsOpen(false)
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <span
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
                </button>
              )
            })}
          </div>

          <div className="border-t border-border px-4 py-2.5">
            <Link
              href={`/league/${currentLeagueId}/history`}
              onClick={() => setIsOpen(false)}
              className="text-sm text-foreground-secondary transition-colors hover:text-gold"
            >
              All seasons →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
