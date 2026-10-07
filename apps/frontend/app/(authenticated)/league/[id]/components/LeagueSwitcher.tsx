'use client'

import { useState, useRef, useEffect, useCallback, useId } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import { currentSeasonOf, groupLeaguesIntoSeries } from '@/utils/seasons'
import type { League } from '@/types'
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss'

const CACHE_TTL_MS = 60_000

interface LeagueSwitcherProps {
  currentLeagueId: string
  currentLeagueName: string
}

type LeagueSummary = Pick<League, 'id' | 'name' | 'status' | 'series_id' | 'season_year'>

/**
 * The league page's <h1>, which opens a list of the viewer's other leagues.
 *
 * A disclosure of links rather than a listbox: every entry navigates, so each
 * is a plain link in Tab order, and the current one is marked aria-current.
 */
export default function LeagueSwitcher({ currentLeagueId, currentLeagueName }: LeagueSwitcherProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchedAtRef = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const listLabelId = useId()
  const pathname = usePathname()

  const fetchLeagues = useCallback(async () => {
    const now = Date.now()
    if (now - fetchedAtRef.current < CACHE_TTL_MS) return

    setIsLoading(true)
    setError(null)
    const supabase = createClient()

    const { data, error: fetchError } = await supabase
      .from('leagues')
      .select('id, name, status, series_id, season_year')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError('Could not load leagues')
      setIsLoading(false)
      return
    }

    setLeagues(groupLeaguesIntoSeries((data ?? []) as LeagueSummary[]).map((seasons) =>
      seasons.find((season) => season.id === currentLeagueId) ?? currentSeasonOf(seasons)!
    ))
    fetchedAtRef.current = now
    setIsLoading(false)
  }, [currentLeagueId])

  // Fetch leagues when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchLeagues()
    }
  }, [isOpen, fetchLeagues])

  // Close on a click or a Tab that leaves the menu, and on Escape, which puts
  // focus back on the league name so it is not lost with the closing list.
  const closeMenu = useCallback(() => setIsOpen(false), [])
  usePopoverDismiss(isOpen, closeMenu, menuRef, triggerRef)

  function getLeagueUrl(leagueId: string): string {
    const segments = pathname.split('/')
    const tabSegment = segments.length > 3 ? segments.slice(3).join('/') : 'dashboard'
    return `/league/${leagueId}/${tabSegment}`
  }

  return (
    <div className="relative" ref={menuRef}>
      <h1 className="type-card min-w-0 text-foreground">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen(prev => !prev)}
          className="flex w-full cursor-pointer items-center gap-1.5 group text-left"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
        >
          <span className="min-w-0 truncate group-hover:text-gold transition-colors">
            {currentLeagueName}
          </span>
          <span className="sr-only">, switch league</span>
          <ChevronDown
            className={`w-4 h-4 flex-none text-foreground-muted group-hover:text-gold transition-all duration-200 ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </h1>

      {isOpen && (
        <div id={menuId} className="absolute left-0 mt-2 w-72 sm:w-80 glass card animate-fade-in z-50" data-testid="league-switcher-menu">
          <div className="px-4 py-2.5 border-b border-border">
            <p id={listLabelId} className="type-row-title text-foreground-secondary">Your leagues</p>
          </div>

          <div className="max-h-[50vh] overflow-y-auto py-1">
            {isLoading ? (
              <div role="status">
                <span className="sr-only">Loading leagues</span>
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5" aria-hidden="true">
                    <div className="w-2 h-2 rounded-full bg-elevated shrink-0 animate-pulse" />
                    <div className="flex-1 h-4 bg-elevated rounded animate-pulse" />
                    <div className="w-14 h-5 bg-elevated rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <p className="type-body-sm px-4 py-3 text-error" role="alert">{error}</p>
            ) : (
              <ul role="list" aria-labelledby={listLabelId}>
                {leagues?.map(league => {
                  const isCurrent = league.id === currentLeagueId
                  return (
                    <li key={league.id}>
                      <Link
                        href={getLeagueUrl(league.id)}
                        aria-current={isCurrent ? 'page' : undefined}
                        onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
                          // Already here: just close, without reloading the tab.
                          if (isCurrent) event.preventDefault()
                          setIsOpen(false)
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isCurrent
                            ? 'bg-surface-hover'
                            : 'hover:bg-surface-hover'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isCurrent ? 'bg-gold' : 'bg-transparent'
                          }`}
                        />
                        <span
                          className={`type-label flex-1 truncate ${
                            isCurrent ? 'text-gold' : 'text-foreground'
                          }`}
                        >
                          {league.name}
                        </span>
                        <span className={`type-meta badge ${STATUS_BADGE_CLASS[league.status]}`}>
                          {getStatusLabel(league.status)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-border px-4 py-2.5">
            <Link
              href="/dashboard"
              onClick={() => setIsOpen(false)}
              className="type-control text-foreground-secondary hover:text-gold transition-colors"
            >
              View all leagues
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
