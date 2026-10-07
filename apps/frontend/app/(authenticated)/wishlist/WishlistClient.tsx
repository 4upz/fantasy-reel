'use client'

import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import MoviePoster from '@/app/components/MoviePoster'
import { Settings, X, Heart, Film, ChevronDown, Users } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { announce } from '@/utils/announce'

import Avatar from '@/app/components/Avatar'
import type { TeamHolding, WishlistedMovie } from '@/types'

type SortOption = 'added_at' | 'title'
type DraftStatus = 'available' | 'yours' | 'drafted'
type TabOption = 'my' | 'league'

interface LeagueOption {
  id: string
  name: string
  status: string
}

/** The `team_holdings` columns the drafted-status map needs. */
type HoldingRow = Pick<TeamHolding, 'tmdb_id' | 'team_id' | 'team_name'>

interface DraftInfo {
  tmdbId: number
  teamId: string
  teamName: string
}

interface LeagueMate {
  userId: string
  displayName: string
  avatarUrl: string | null
  wishlistCount: number
}

const SORT_LABELS: Record<SortOption, string> = {
  added_at: 'Date Added',
  title: 'Title A-Z',
}

const SESSION_KEY_LEAGUE = 'wishlist-selected-league'

/** The league picker's "All leagues" option value. */
const ALL_LEAGUES = ''

const MOVIE_GRID_CLASSES =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6'

/**
 * Unwrap a Supabase joined relation that may come back as an object or array.
 * Returns the first element if array, the value itself if object, or null.
 */
function unwrapRelation<T>(raw: unknown): T | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value && typeof value === 'object') return value as T
  return null
}

export default function WishlistClient({ userId }: { userId: string }) {
  const [movies, setMovies] = useState<WishlistedMovie[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [sortBy, setSortBy] = useState<SortOption>('added_at')
  const [removingId, setRemovingId] = useState<string | null>(null)

  // League context
  const [leagues, setLeagues] = useState<LeagueOption[]>([])
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null)
  const [draftMap, setDraftMap] = useState<Map<number, DraftInfo>>(new Map())
  const [userTeamId, setUserTeamId] = useState<string | null>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabOption>('my')

  // League-mate wishlists
  const [leagueMates, setLeagueMates] = useState<LeagueMate[]>([])
  const [leagueMatesLoading, setLeagueMatesLoading] = useState(false)
  const [leagueMatesError, setLeagueMatesError] = useState(false)
  const [leagueMatesReloadKey, setLeagueMatesReloadKey] = useState(0)
  const [selectedMateId, setSelectedMateId] = useState<string | null>(null)
  const [mateMovies, setMateMovies] = useState<WishlistedMovie[]>([])
  const [mateMoviesLoading, setMateMoviesLoading] = useState(false)
  const [mateMoviesError, setMateMoviesError] = useState(false)
  const [mateMoviesReloadKey, setMateMoviesReloadKey] = useState(0)

  // Settings popover
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [wishlistPublic, setWishlistPublic] = useState(false)
  const [updatingPublic, setUpdatingPublic] = useState(false)

  // Refs for click-outside and focus management
  const settingsRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const myGridRef = useRef<HTMLUListElement>(null)
  // Removing a card unmounts its focused remove button; this names the card
  // whose remove button takes focus next ('' means the page heading).
  const focusAfterRemoveRef = useRef<string | null>(null)
  // "Try again" is replaced by the loading view; the heading holds focus.
  const focusHeadingAfterLoadRef = useRef(false)
  const leagueTabRef = useRef<HTMLButtonElement>(null)
  const settingsPanelId = useId()
  const settingsLabelId = useId()
  const settingsHelpId = useId()

  const supabase = useMemo(() => createClient(), [])

  // Fetch wishlist
  useEffect(() => {
    async function fetchWishlist() {
      const { data, error } = await supabase
        .from('wishlisted_movies')
        .select('*')
        .eq('user_id', userId)
        .order('added_at', { ascending: false })

      if (error) {
        console.error('Failed to fetch wishlist:', error.message)
        setLoadError(true)
      } else {
        setLoadError(false)
        setMovies(data ?? [])
      }
      setLoading(false)
    }

    fetchWishlist()
  }, [supabase, userId, reloadKey])

  // The loading and loaded views render different headings; keep focus on
  // whichever is showing while a retry runs.
  useEffect(() => {
    if (!focusHeadingAfterLoadRef.current) return
    headingRef.current?.focus()
    if (!loading) focusHeadingAfterLoadRef.current = false
  }, [loading])

  // Fetch leagues and profile
  useEffect(() => {
    async function fetchLeaguesAndProfile() {
      const [leagueResult, profileResult] = await Promise.all([
        supabase
          .from('league_participants')
          .select('league_id, leagues(id, name, status)')
          .eq('user_id', userId)
          .eq('status', 'active'),
        supabase
          .from('profiles')
          .select('wishlist_public')
          .eq('user_id', userId)
          .single(),
      ])

      if (leagueResult.data) {
        const leagueOptions: LeagueOption[] = []
        for (const lp of leagueResult.data) {
          const league = unwrapRelation<LeagueOption>(lp.leagues)
          if (league && 'id' in league) {
            leagueOptions.push(league)
          }
        }
        setLeagues(leagueOptions)
      }

      if (profileResult.data) {
        setWishlistPublic(profileResult.data.wishlist_public ?? false)
      }

      // Restore league selection from sessionStorage
      if (typeof window !== 'undefined') {
        const saved = sessionStorage.getItem(SESSION_KEY_LEAGUE)
        if (saved) {
          setSelectedLeagueId(saved)
        }
      }
    }

    fetchLeaguesAndProfile()
  }, [supabase, userId])

  // Fetch draft data when league is selected
  useEffect(() => {
    if (!selectedLeagueId) {
      setDraftMap(new Map())
      setUserTeamId(null)
      return
    }

    async function fetchDraftData() {
      const [holdingsResult, teamResult] = await Promise.all([
        // Everything already claimed in the league: drafted movies and auction
        // wins alike. Reading draft_picks alone left pickups looking available.
        supabase
          .from('team_holdings')
          .select('tmdb_id, team_id, team_name')
          .eq('league_id', selectedLeagueId!),
        supabase
          .from('league_participants')
          .select('teams(id)')
          .eq('league_id', selectedLeagueId!)
          .eq('user_id', userId)
          .eq('status', 'active')
          .single(),
      ])

      if (holdingsResult.data) {
        const holdings = holdingsResult.data as HoldingRow[]
        setDraftMap(
          new Map(
            holdings.map((holding) => [
              holding.tmdb_id,
              {
                tmdbId: holding.tmdb_id,
                teamId: holding.team_id,
                teamName: holding.team_name,
              },
            ])
          )
        )
      }

      if (teamResult.data?.teams) {
        const teamObj = unwrapRelation<{ id: string }>(teamResult.data.teams)
        if (teamObj?.id) {
          setUserTeamId(teamObj.id)
        }
      }
    }

    fetchDraftData()
  }, [supabase, selectedLeagueId, userId])

  // Close the settings popover on click outside, or on Escape (which also
  // returns focus to the gear that opened it)
  useEffect(() => {
    if (!settingsOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSettingsOpen(false)
        settingsButtonRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [settingsOpen])

  // Reset tab and league-mate selection when league changes
  useEffect(() => {
    setActiveTab('my')
    setSelectedMateId(null)
    setLeagueMates([])
    setMateMovies([])
  }, [selectedLeagueId])

  // Fetch league-mates with public wishlists
  useEffect(() => {
    if (activeTab !== 'league' || !selectedLeagueId) {
      return
    }

    let cancelled = false

    async function fetchLeagueMates() {
      setLeagueMatesLoading(true)
      setLeagueMatesError(false)

      const { data: participants, error } = await supabase
        .from('league_participants')
        .select('user_id, profiles!inner(display_name, avatar_url, wishlist_public)')
        .eq('league_id', selectedLeagueId!)
        .eq('status', 'active')
        .neq('user_id', userId)
        .eq('profiles.wishlist_public', true)

      if (cancelled) return

      if (error) {
        console.error('Failed to fetch league-mates:', error.message)
        setLeagueMatesError(true)
        setLeagueMatesLoading(false)
        return
      }

      if (!participants || participants.length === 0) {
        setLeagueMates([])
        setLeagueMatesLoading(false)
        return
      }

      // Fetch wishlist counts for each league-mate
      const mateUserIds = participants.map((p) => p.user_id)
      const { data: countData, error: countError } = await supabase
        .from('wishlisted_movies')
        .select('user_id')
        .in('user_id', mateUserIds)

      if (cancelled) return

      const countMap = new Map<string, number>()
      if (!countError && countData) {
        for (const row of countData) {
          countMap.set(row.user_id, (countMap.get(row.user_id) ?? 0) + 1)
        }
      }

      const mates: LeagueMate[] = participants.map((p) => {
        const profile = p.profiles as unknown as {
          display_name: string | null
          avatar_url: string | null
          wishlist_public: boolean
        }
        return {
          userId: p.user_id,
          displayName: profile.display_name ?? 'Unknown',
          avatarUrl: profile.avatar_url,
          wishlistCount: countMap.get(p.user_id) ?? 0,
        }
      })

      setLeagueMates(mates)
      setLeagueMatesLoading(false)
    }

    fetchLeagueMates()
    return () => { cancelled = true }
  }, [supabase, activeTab, selectedLeagueId, userId, leagueMatesReloadKey])

  // Fetch a selected league-mate's wishlist movies
  useEffect(() => {
    if (!selectedMateId) {
      setMateMovies([])
      return
    }

    let cancelled = false

    async function fetchMateWishlist() {
      setMateMoviesLoading(true)
      setMateMoviesError(false)

      const { data, error } = await supabase
        .from('wishlisted_movies')
        .select('*')
        .eq('user_id', selectedMateId!)
        .order('added_at', { ascending: false })

      if (cancelled) return

      if (error) {
        console.error('Failed to fetch league-mate wishlist:', error.message)
        setMateMoviesError(true)
      } else {
        setMateMovies(data ?? [])
      }
      setMateMoviesLoading(false)
    }

    fetchMateWishlist()
    return () => { cancelled = true }
  }, [supabase, selectedMateId, mateMoviesReloadKey])

  // Set of user's own wishlisted tmdb_ids for overlap detection
  const myWishlistedIds = useMemo(
    () => new Set(movies.map((m) => m.tmdb_id)),
    [movies]
  )

  const handleLeagueSelect = useCallback(
    (leagueId: string | null) => {
      setSelectedLeagueId(leagueId)
      if (typeof window !== 'undefined') {
        if (leagueId) {
          sessionStorage.setItem(SESSION_KEY_LEAGUE, leagueId)
        } else {
          sessionStorage.removeItem(SESSION_KEY_LEAGUE)
        }
      }
    },
    []
  )

  const handleRemove = useCallback(
    async (movie: WishlistedMovie, nextFocusId: string | null) => {
      setRemovingId(movie.id)

      // Optimistic removal after animation
      await new Promise((resolve) => setTimeout(resolve, 250))
      focusAfterRemoveRef.current = nextFocusId ?? ''
      setMovies((prev) => prev.filter((m) => m.id !== movie.id))

      const { error } = await supabase
        .from('wishlisted_movies')
        .delete()
        .eq('id', movie.id)

      if (error) {
        setMovies((prev) => [...prev, movie].sort((a, b) =>
          new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
        ))
        console.error('Failed to remove from wishlist:', error.message)
        toast.error(`Could not remove ${movie.title} from your wishlist`)
      } else {
        announce(`Removed ${movie.title} from your wishlist`)
      }

      setRemovingId(null)
    },
    [supabase]
  )

  // After a removal, move focus to the neighbouring card's remove button, or
  // to the heading once the list is empty, instead of dropping it on <body>.
  useEffect(() => {
    const target = focusAfterRemoveRef.current
    if (target === null) return
    focusAfterRemoveRef.current = null
    const next = target
      ? myGridRef.current?.querySelector<HTMLElement>(`[data-remove-id="${target}"]`)
      : null
    ;(next ?? headingRef.current)?.focus()
  }, [movies])

  const handleTogglePublic = useCallback(
    async (value: boolean) => {
      setUpdatingPublic(true)
      setWishlistPublic(value)

      const { error } = await supabase
        .from('profiles')
        .update({ wishlist_public: value })
        .eq('user_id', userId)

      if (error) {
        setWishlistPublic(!value)
        console.error('Failed to update wishlist visibility:', error.message)
        toast.error('Could not update wishlist sharing')
      } else {
        announce(value ? 'Wishlist shared with league-mates' : 'Wishlist no longer shared')
      }

      setUpdatingPublic(false)
    },
    [supabase, userId]
  )

  const getDraftStatus = useCallback(
    (tmdbId: number): { status: DraftStatus; label: string } | null => {
      if (!selectedLeagueId) return null

      const info = draftMap.get(tmdbId)
      if (!info) return { status: 'available', label: 'Available' }
      if (info.teamId === userTeamId) return { status: 'yours', label: 'On Your Roster' }
      return { status: 'drafted', label: `Drafted by ${info.teamName}` }
    },
    [selectedLeagueId, draftMap, userTeamId]
  )

  const sortedMovies = useMemo(() => {
    const sorted = [...movies]
    if (sortBy === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    } else {
      sorted.sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
    }
    return sorted
  }, [movies, sortBy])

  // ------- Render -------

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 ref={headingRef} tabIndex={-1} className="type-page text-foreground focus:outline-none">Wishlist</h1>
        </div>
        <p role="status" className="sr-only">Loading wishlist…</p>
        <div aria-hidden="true" className={MOVIE_GRID_CLASSES}>
          {Array.from({ length: 12 }).map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <h1 ref={headingRef} tabIndex={-1} className="type-page text-foreground focus:outline-none">
          Wishlist
          {!loadError && (
            <span className="type-number ml-2 text-foreground-secondary">
              <span aria-hidden="true">({movies.length})</span>
              <span className="sr-only">, {movies.length} {movies.length === 1 ? 'movie' : 'movies'}</span>
            </span>
          )}
        </h1>

        <div className="flex items-center gap-3">
          {/* League context: shows draft status and unlocks league wishlists */}
          {leagues.length > 0 && (
            <select
              aria-label="League"
              value={selectedLeagueId ?? ALL_LEAGUES}
              onChange={(e) => handleLeagueSelect(e.target.value || null)}
              className="input py-1.5 px-3 w-auto max-w-[200px] truncate"
            >
              <option value={ALL_LEAGUES}>All leagues</option>
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </select>
          )}

          {/* Sort dropdown */}
          <select
            aria-label="Sort wishlist"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="input py-1.5 px-3 w-auto"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          {/* Settings gear */}
          <div className="relative" ref={settingsRef}>
            <button
              ref={settingsButtonRef}
              type="button"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="btn btn-ghost p-2"
              aria-label="Wishlist settings"
              aria-expanded={settingsOpen}
              aria-controls={settingsPanelId}
            >
              <Settings className="w-5 h-5" />
            </button>

            {settingsOpen && (
              <div
                id={settingsPanelId}
                className="absolute right-0 top-full mt-1 w-64 bg-elevated border border-border rounded-lg shadow-heavy z-30 animate-fade-in p-4"
              >
                <div className="type-label flex items-center justify-between gap-3">
                  <span id={settingsLabelId} className="type-body-sm text-foreground">
                    Share with league-mates
                  </span>
                  <button
                    type="button"
                    onClick={() => handleTogglePublic(!wishlistPublic)}
                    disabled={updatingPublic}
                    className={`relative w-10 h-6 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
                      wishlistPublic ? 'bg-gold' : 'bg-elevated border border-border'
                    }`}
                    role="switch"
                    aria-checked={wishlistPublic}
                    aria-labelledby={settingsLabelId}
                    aria-describedby={settingsHelpId}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-foreground transition-transform ${
                        wishlistPublic ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                </div>
                <p id={settingsHelpId} className="type-meta text-foreground-secondary mt-2">
                  When enabled, other players in your leagues can see your wishlist.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View switch -- only shown when a league is selected */}
      {selectedLeagueId && (
        <div role="group" aria-label="Wishlist view" className="flex gap-1 bg-elevated rounded-lg p-1 mb-6 w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('my')}
            aria-pressed={activeTab === 'my'}
            className={`px-4 py-2 rounded-md type-control transition-colors ${
              activeTab === 'my'
                ? 'bg-surface text-foreground shadow-soft'
                : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            My wishlist
          </button>
          <button
            ref={leagueTabRef}
            type="button"
            onClick={() => setActiveTab('league')}
            aria-pressed={activeTab === 'league'}
            className={`px-4 py-2 rounded-md type-control transition-colors ${
              activeTab === 'league'
                ? 'bg-surface text-foreground shadow-soft'
                : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            League wishlists
          </button>
        </div>
      )}

      {/* My wishlist tab content */}
      {activeTab === 'my' && (
        <>
          {loadError && (
            <LoadErrorAlert
              message="Could not load your wishlist."
              onRetry={() => {
                focusHeadingAfterLoadRef.current = true
                setLoading(true)
                setReloadKey((key) => key + 1)
              }}
            />
          )}

          {!loadError && movies.length === 0 && (
            <div className="text-center py-20 animate-fade-in">
              <div className="flex justify-center gap-3 mb-5">
                <Heart className="w-12 h-12 text-foreground-muted" />
                <Film className="w-12 h-12 text-foreground-muted" />
              </div>
              <h2 className="type-section text-foreground mb-2">
                Your wishlist is empty
              </h2>
              <p className="text-foreground-secondary max-w-md mx-auto mb-6">
                Browse upcoming movies and heart the ones you want to track.
              </p>
              <Link href="/movies" className="btn btn-primary px-6 py-2.5">
                Explore movies
              </Link>
            </div>
          )}

          {sortedMovies.length > 0 && (
            <>
              <h2 className="sr-only">Your wishlisted movies</h2>
              <ul ref={myGridRef} role="list" className={MOVIE_GRID_CLASSES}>
                {sortedMovies.map((movie, index) => {
                  const isRemoving = removingId === movie.id
                  const neighbour = sortedMovies[index + 1] ?? sortedMovies[index - 1]

                  return (
                    <WishlistMovieCard
                      key={movie.id}
                      movie={movie}
                      index={index}
                      draftStatus={getDraftStatus(movie.tmdb_id)}
                      className={isRemoving ? 'animate-slide-out-down' : ''}
                      animationDelay={isRemoving ? '0ms' : `${index * 50}ms`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!isRemoving) handleRemove(movie, neighbour?.id ?? null)
                        }}
                        data-remove-id={movie.id}
                        className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-background/70 backdrop-blur-sm border border-border text-foreground-muted hover:text-crimson-text hover:border-crimson/50 transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        aria-label={`Remove ${movie.title} from wishlist`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </WishlistMovieCard>
                  )
                })}
              </ul>
            </>
          )}
        </>
      )}

      {/* League wishlists tab content */}
      {activeTab === 'league' && selectedLeagueId && (
        <LeagueMateWishlists
          leagueMates={leagueMates}
          leagueMatesLoading={leagueMatesLoading}
          leagueMatesError={leagueMatesError}
          onRetryLeagueMates={() => {
            // The retry button is replaced by the loading list; keep focus nearby.
            leagueTabRef.current?.focus()
            setLeagueMatesReloadKey((key) => key + 1)
          }}
          selectedMateId={selectedMateId}
          onSelectMate={setSelectedMateId}
          mateMovies={mateMovies}
          mateMoviesLoading={mateMoviesLoading}
          mateMoviesError={mateMoviesError}
          onRetryMateMovies={() => setMateMoviesReloadKey((key) => key + 1)}
          myWishlistedIds={myWishlistedIds}
          getDraftStatus={getDraftStatus}
        />
      )}
    </div>
  )
}

// ---------- Shared sub-components ----------

function LoadErrorAlert({ message, onRetry }: { message: string; onRetry: () => void }): React.ReactElement {
  return (
    <div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-3 mb-6">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="btn btn-secondary px-4 py-1.5">
        Try again
      </button>
    </div>
  )
}

function MovieCardSkeleton(): React.ReactElement {
  return (
    <div className="rounded-xl overflow-hidden bg-surface border border-border">
      <div className="aspect-[2/3] bg-elevated animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-elevated rounded animate-pulse w-3/4" />
        <div className="h-3 bg-elevated rounded animate-pulse w-1/2" />
      </div>
    </div>
  )
}

interface WishlistMovieCardProps {
  movie: WishlistedMovie
  index: number
  draftStatus: { status: DraftStatus; label: string } | null
  isOverlap?: boolean
  className?: string
  animationDelay?: string
  children?: React.ReactNode
}

function WishlistMovieCard({
  movie,
  index,
  draftStatus,
  isOverlap,
  className,
  animationDelay,
  children,
}: WishlistMovieCardProps): React.ReactElement {
  const borderClass = isOverlap
    ? 'border-gold/40 ring-1 ring-gold/20'
    : 'border-border hover:border-gold/50'

  return (
    <li
      className={`group relative rounded-xl overflow-hidden bg-surface border transition-all duration-300 hover:shadow-glow-gold hover:-translate-y-1 animate-slide-up ${borderClass} ${className ?? ''}`}
      style={{
        animationDelay: animationDelay ?? `${index * 50}ms`,
        animationFillMode: 'both',
      }}
    >
      {children}

      {/* Overlap indicator */}
      {isOverlap && (
        <div className="absolute top-2 right-2 z-10">
          <span className="type-meta flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/20 text-gold border border-gold/30 backdrop-blur-sm">
            <Heart className="w-3 h-3 fill-current" />
            <span aria-hidden="true">Both</span>
          </span>
        </div>
      )}

      {/* Poster -- the title below names the card, so the image stays silent */}
      <div className="relative aspect-[2/3] bg-elevated overflow-hidden">
        <MoviePoster
          src={movie.poster_url}
          alt=""
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          posterSize="w342"
          className="transition-transform duration-500 group-hover:scale-105"
        />

        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {draftStatus && (
          <div className="absolute bottom-2 left-2 right-2">
            <DraftStatusBadge status={draftStatus.status} label={draftStatus.label} />
          </div>
        )}
      </div>

      {/* Movie info */}
      <div className="p-3">
        <h3
          className="type-row-title text-foreground truncate group-hover:text-gold transition-colors"
          title={movie.title}
        >
          {movie.title}
        </h3>
        {isOverlap && <p className="sr-only">Also on your wishlist</p>}
        <p className="type-meta text-foreground-secondary mt-1">
          Added <AddedDate dateStr={movie.added_at} />
        </p>
      </div>
    </li>
  )
}

function DraftStatusBadge({ status, label }: { status: DraftStatus; label: string }): React.ReactElement {
  const colorClasses: Record<DraftStatus, string> = {
    available: 'bg-success-bg text-success border-success',
    yours: 'bg-gold-muted text-gold border-gold',
    drafted: 'bg-elevated text-foreground-secondary border-border',
  }

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full type-meta border ${colorClasses[status]}`}
    >
      {label}
    </span>
  )
}

// ---------- League-mate wishlists ----------

function LeagueMateWishlists({
  leagueMates,
  leagueMatesLoading,
  leagueMatesError,
  onRetryLeagueMates,
  selectedMateId,
  onSelectMate,
  mateMovies,
  mateMoviesLoading,
  mateMoviesError,
  onRetryMateMovies,
  myWishlistedIds,
  getDraftStatus,
}: {
  leagueMates: LeagueMate[]
  leagueMatesLoading: boolean
  leagueMatesError: boolean
  onRetryLeagueMates: () => void
  selectedMateId: string | null
  onSelectMate: (id: string | null) => void
  mateMovies: WishlistedMovie[]
  mateMoviesLoading: boolean
  mateMoviesError: boolean
  onRetryMateMovies: () => void
  myWishlistedIds: Set<number>
  getDraftStatus: (tmdbId: number) => { status: DraftStatus; label: string } | null
}): React.ReactElement {
  const selectedMate = leagueMates.find((m) => m.userId === selectedMateId)
  const mateWishlistId = useId()
  const mateHeadingRef = useRef<HTMLHeadingElement>(null)

  if (leagueMatesLoading) {
    return (
      <div className="animate-fade-in space-y-3">
        <p role="status" className="sr-only">Loading shared wishlists…</p>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} aria-hidden="true" className="flex items-center gap-3 p-4 rounded-lg bg-surface border border-border">
            <div className="w-9 h-9 rounded-full bg-elevated animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-elevated rounded animate-pulse w-32" />
              <div className="h-3 bg-elevated rounded animate-pulse w-20" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (leagueMatesError) {
    return <LoadErrorAlert message="Could not load your league-mates' wishlists." onRetry={onRetryLeagueMates} />
  }

  if (leagueMates.length === 0) {
    return (
      <div className="text-center py-20 animate-fade-in">
        <Users className="w-12 h-12 text-foreground-muted mx-auto mb-4" />
        <h2 className="type-section text-foreground mb-2">
          No shared wishlists yet
        </h2>
        <p className="text-foreground-secondary max-w-md mx-auto">
          No league-mates have shared their wishlists yet. When they enable sharing, you&apos;ll see their picks here.
        </p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {/* League-mate list: each row discloses that mate's wishlist below */}
      <ul role="list" aria-label="League-mates sharing a wishlist" className="space-y-2 mb-8">
        {leagueMates.map((mate) => {
          const isSelected = selectedMateId === mate.userId

          return (
            <li key={mate.userId}>
              <button
                type="button"
                onClick={() => onSelectMate(isSelected ? null : mate.userId)}
                aria-expanded={isSelected}
                aria-controls={mateWishlistId}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                  isSelected
                    ? 'bg-surface border-gold/50 shadow-glow-gold'
                    : 'bg-surface border-border hover:border-border-hover hover:bg-surface-hover'
                }`}
              >
                <Avatar
                  src={mate.avatarUrl}
                  name={mate.displayName}
                  size="sm"
                  decorative
                />
                <div className="flex-1 min-w-0">
                  <span className={`type-row-title truncate block ${
                    isSelected ? 'text-gold' : 'text-foreground'
                  }`}>
                    {mate.displayName}
                  </span>
                  <span className="type-meta text-foreground-secondary">
                    {mate.wishlistCount} {mate.wishlistCount === 1 ? 'movie' : 'movies'}
                  </span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-foreground-muted transition-transform flex-shrink-0 ${
                    isSelected ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </li>
          )
        })}
      </ul>

      {/* Selected league-mate's wishlist */}
      {selectedMateId && selectedMate && (
        <section id={mateWishlistId} aria-labelledby={`${mateWishlistId}-heading`} className="animate-fade-in">
          <h2
            ref={mateHeadingRef}
            id={`${mateWishlistId}-heading`}
            tabIndex={-1}
            className="type-panel text-foreground mb-4 focus:outline-none"
          >
            {selectedMate.displayName}&apos;s Wishlist
          </h2>

          {mateMoviesLoading ? (
            <>
              <p role="status" className="sr-only">Loading {selectedMate.displayName}&apos;s wishlist…</p>
              <div aria-hidden="true" className={MOVIE_GRID_CLASSES}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <MovieCardSkeleton key={i} />
                ))}
              </div>
            </>
          ) : mateMoviesError ? (
            <LoadErrorAlert
              message={`Could not load ${selectedMate.displayName}'s wishlist.`}
              onRetry={() => {
                mateHeadingRef.current?.focus()
                onRetryMateMovies()
              }}
            />
          ) : mateMovies.length === 0 ? (
            <div className="text-center py-12">
              <Film className="w-10 h-10 text-foreground-muted mx-auto mb-3" />
              <p className="text-foreground-secondary">
                {selectedMate.displayName}&apos;s wishlist is empty.
              </p>
            </div>
          ) : (
            <ul role="list" className={MOVIE_GRID_CLASSES}>
              {mateMovies.map((movie, index) => (
                <WishlistMovieCard
                  key={movie.id}
                  movie={movie}
                  index={index}
                  draftStatus={getDraftStatus(movie.tmdb_id)}
                  isOverlap={myWishlistedIds.has(movie.tmdb_id)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

/**
 * Compact relative date for wishlist cards ("today", "3d ago", "2w ago"), with
 * the same date in words for screen readers, which read "3d" as "3 d".
 * Distinct from utils/date.ts formatRelativeDate which uses full words.
 */
function AddedDate({ dateStr }: { dateStr: string }): React.ReactElement {
  const date = new Date(dateStr)
  const diffDays = Math.floor((new Date().getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  const weeks = Math.floor(diffDays / 7)
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`

  let compact: string
  let spoken: string
  if (diffDays === 0) {
    compact = spoken = 'today'
  } else if (diffDays === 1) {
    compact = spoken = 'yesterday'
  } else if (diffDays < 7) {
    compact = `${diffDays}d ago`
    spoken = plural(diffDays, 'day')
  } else if (diffDays < 30) {
    compact = `${weeks}w ago`
    spoken = plural(weeks, 'week')
  } else {
    compact = spoken = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <time dateTime={dateStr}>
      {compact === spoken ? compact : (
        <>
          <span aria-hidden="true">{compact}</span>
          <span className="sr-only">{spoken}</span>
        </>
      )}
    </time>
  )
}
