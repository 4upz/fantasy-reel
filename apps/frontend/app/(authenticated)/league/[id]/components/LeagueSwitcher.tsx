'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import type { League } from '@/types'

const CACHE_TTL_MS = 60_000

interface LeagueSwitcherProps {
  currentLeagueId: string
  currentLeagueName: string
}

type LeagueSummary = Pick<League, 'id' | 'name' | 'status'>

export default function LeagueSwitcher({ currentLeagueId, currentLeagueName }: LeagueSwitcherProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchedAtRef = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const router = useRouter()

  const fetchLeagues = useCallback(async () => {
    const now = Date.now()
    if (now - fetchedAtRef.current < CACHE_TTL_MS) return

    setIsLoading(true)
    setError(null)
    const supabase = createClient()

    const { data, error: fetchError } = await supabase
      .from('leagues')
      .select('id, name, status')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError('Could not load leagues')
      setIsLoading(false)
      return
    }

    setLeagues(data as LeagueSummary[])
    fetchedAtRef.current = now
    setIsLoading(false)
  }, [])

  // Fetch leagues when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchLeagues()
    }
  }, [isOpen, fetchLeagues])

  // Handle click outside and escape key to close
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  function getLeagueUrl(leagueId: string): string {
    const segments = pathname.split('/')
    const tabSegment = segments.length > 3 ? segments.slice(3).join('/') : 'dashboard'
    return `/league/${leagueId}/${tabSegment}`
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="flex w-full items-center gap-1.5 group text-left"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <h1 className="min-w-0 truncate text-lg font-display font-semibold text-foreground group-hover:text-gold transition-colors">
          {currentLeagueName}
        </h1>
        <ChevronDown
          className={`w-4 h-4 flex-none text-foreground-muted group-hover:text-gold transition-all duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-72 sm:w-80 glass card animate-fade-in z-50">
          <div className="px-4 py-2.5 border-b border-border">
            <p className="text-sm font-semibold text-foreground-secondary">Your Leagues</p>
          </div>

          <div className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
            {isLoading ? (
              [1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-elevated shrink-0 animate-pulse" />
                  <div className="flex-1 h-4 bg-elevated rounded animate-pulse" />
                  <div className="w-14 h-5 bg-elevated rounded-full animate-pulse" />
                </div>
              ))
            ) : error ? (
              <p className="px-4 py-3 text-sm text-error">{error}</p>
            ) : (
              leagues?.map(league => {
                const isCurrent = league.id === currentLeagueId
                return (
                  <button
                    key={league.id}
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => {
                      if (!isCurrent) {
                        router.push(getLeagueUrl(league.id))
                      }
                      setIsOpen(false)
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isCurrent
                        ? 'bg-surface-hover'
                        : 'hover:bg-surface-hover'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isCurrent ? 'bg-gold' : 'bg-transparent'
                      }`}
                    />
                    <span
                      className={`flex-1 text-sm font-medium truncate ${
                        isCurrent ? 'text-gold' : 'text-foreground'
                      }`}
                    >
                      {league.name}
                    </span>
                    <span className={`badge text-xs ${STATUS_BADGE_CLASS[league.status]}`}>
                      {getStatusLabel(league.status)}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-border px-4 py-2.5">
            <Link
              href="/dashboard"
              onClick={() => setIsOpen(false)}
              className="text-sm text-foreground-secondary hover:text-gold transition-colors"
            >
              View All Leagues
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
