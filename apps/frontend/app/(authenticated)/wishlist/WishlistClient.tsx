'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Settings, X, Heart, Film, ChevronDown, Check, Users } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { getTmdbPosterUrl } from '@/app/(authenticated)/league/[id]/components/utils'
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
  const [sortBy, setSortBy] = useState<SortOption>('added_at')
  const [removingId, setRemovingId] = useState<string | null>(null)

  // League context
  const [leagues, setLeagues] = useState<LeagueOption[]>([])
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null)
  const [leagueDropdownOpen, setLeagueDropdownOpen] = useState(false)
  const [draftMap, setDraftMap] = useState<Map<number, DraftInfo>>(new Map())
  const [userTeamId, setUserTeamId] = useState<string | null>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabOption>('my')

  // League-mate wishlists
  const [leagueMates, setLeagueMates] = useState<LeagueMate[]>([])
  const [leagueMatesLoading, setLeagueMatesLoading] = useState(false)
  const [selectedMateId, setSelectedMateId] = useState<string | null>(null)
  const [mateMovies, setMateMovies] = useState<WishlistedMovie[]>([])
  const [mateMoviesLoading, setMateMoviesLoading] = useState(false)

  // Settings popover
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [wishlistPublic, setWishlistPublic] = useState(false)
  const [updatingPublic, setUpdatingPublic] = useState(false)

  // Refs for click-outside
  const settingsRef = useRef<HTMLDivElement>(null)
  const leagueRef = useRef<HTMLDivElement>(null)

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
      } else {
        setMovies(data ?? [])
      }
      setLoading(false)
    }

    fetchWishlist()
  }, [supabase, userId])

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

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
      if (leagueRef.current && !leagueRef.current.contains(e.target as Node)) {
        setLeagueDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
  }, [supabase, activeTab, selectedLeagueId, userId])

  // Fetch a selected league-mate's wishlist movies
  useEffect(() => {
    if (!selectedMateId) {
      setMateMovies([])
      return
    }

    let cancelled = false

    async function fetchMateWishlist() {
      setMateMoviesLoading(true)

      const { data, error } = await supabase
        .from('wishlisted_movies')
        .select('*')
        .eq('user_id', selectedMateId!)
        .order('added_at', { ascending: false })

      if (cancelled) return

      if (error) {
        console.error('Failed to fetch league-mate wishlist:', error.message)
      } else {
        setMateMovies(data ?? [])
      }
      setMateMoviesLoading(false)
    }

    fetchMateWishlist()
    return () => { cancelled = true }
  }, [supabase, selectedMateId])

  // Set of user's own wishlisted tmdb_ids for overlap detection
  const myWishlistedIds = useMemo(
    () => new Set(movies.map((m) => m.tmdb_id)),
    [movies]
  )

  const handleLeagueSelect = useCallback(
    (leagueId: string | null) => {
      setSelectedLeagueId(leagueId)
      setLeagueDropdownOpen(false)
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
    async (movie: WishlistedMovie) => {
      setRemovingId(movie.id)

      // Optimistic removal after animation
      await new Promise((resolve) => setTimeout(resolve, 250))
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
      }

      setRemovingId(null)
    },
    [supabase]
  )

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

  const selectedLeague = leagues.find((l) => l.id === selectedLeagueId)

  // ------- Render -------

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="h-9 w-48 bg-elevated rounded-lg animate-pulse" />
        </div>
        <div className={MOVIE_GRID_CLASSES}>
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
        <h1 className="font-display text-3xl font-bold text-foreground">
          Wishlist
          <span className="ml-2 text-foreground-muted font-normal text-xl">
            ({movies.length})
          </span>
        </h1>

        <div className="flex items-center gap-3">
          {/* League context dropdown */}
          {leagues.length > 0 && (
            <div className="relative" ref={leagueRef}>
              <button
                onClick={() => setLeagueDropdownOpen(!leagueDropdownOpen)}
                className="btn btn-ghost text-sm gap-2 border border-border hover:border-border-hover"
              >
                <span className="truncate max-w-[160px]">
                  {selectedLeague ? selectedLeague.name : 'All Leagues'}
                </span>
                <ChevronDown className="w-4 h-4 flex-shrink-0" />
              </button>

              {leagueDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-elevated border border-border rounded-lg shadow-heavy z-30 animate-fade-in overflow-hidden">
                  <button
                    onClick={() => handleLeagueSelect(null)}
                    className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-surface-hover transition-colors flex items-center justify-between"
                  >
                    All Leagues
                    {!selectedLeagueId && <Check className="w-4 h-4 text-gold" />}
                  </button>
                  <div className="h-px bg-border" />
                  {leagues.map((league) => (
                    <button
                      key={league.id}
                      onClick={() => handleLeagueSelect(league.id)}
                      className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-surface-hover transition-colors flex items-center justify-between"
                    >
                      <span className="truncate">{league.name}</span>
                      {selectedLeagueId === league.id && (
                        <Check className="w-4 h-4 text-gold flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sort dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="input text-sm py-1.5 px-3 w-auto"
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
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="btn btn-ghost p-2"
              aria-label="Wishlist settings"
            >
              <Settings className="w-5 h-5" />
            </button>

            {settingsOpen && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-elevated border border-border rounded-lg shadow-heavy z-30 animate-fade-in p-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-foreground">
                    Share with league-mates
                  </span>
                  <button
                    onClick={() => handleTogglePublic(!wishlistPublic)}
                    disabled={updatingPublic}
                    className={`relative w-10 h-6 rounded-full transition-colors ${
                      wishlistPublic ? 'bg-gold' : 'bg-elevated border border-border'
                    }`}
                    role="switch"
                    aria-checked={wishlistPublic}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-foreground transition-transform ${
                        wishlistPublic ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                </label>
                <p className="text-xs text-foreground-muted mt-2">
                  When enabled, other players in your leagues can see your wishlist.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar -- only show when a league is selected */}
      {selectedLeagueId && (
        <div className="flex gap-1 bg-elevated rounded-lg p-1 mb-6 w-fit">
          <button
            onClick={() => setActiveTab('my')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'my'
                ? 'bg-surface text-foreground shadow-soft'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            My Wishlist
          </button>
          <button
            onClick={() => setActiveTab('league')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'league'
                ? 'bg-surface text-foreground shadow-soft'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            League Wishlists
          </button>
        </div>
      )}

      {/* My Wishlist tab content */}
      {activeTab === 'my' && (
        <>
          {movies.length === 0 && (
            <div className="text-center py-20 animate-fade-in">
              <div className="flex justify-center gap-3 mb-5">
                <Heart className="w-12 h-12 text-foreground-muted" />
                <Film className="w-12 h-12 text-foreground-muted" />
              </div>
              <h2 className="font-display text-xl font-semibold text-foreground mb-2">
                Your wishlist is empty
              </h2>
              <p className="text-foreground-secondary max-w-md mx-auto mb-6">
                Browse upcoming movies and heart the ones you want to track.
              </p>
              <Link href="/movies" className="btn btn-primary px-6 py-2.5">
                Explore Movies
              </Link>
            </div>
          )}

          {sortedMovies.length > 0 && (
            <div className={MOVIE_GRID_CLASSES}>
              {sortedMovies.map((movie, index) => {
                const isRemoving = removingId === movie.id

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
                      onClick={() => handleRemove(movie)}
                      className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-background/70 backdrop-blur-sm border border-border text-foreground-muted hover:text-crimson hover:border-crimson/50 transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      aria-label={`Remove ${movie.title} from wishlist`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </WishlistMovieCard>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* League Wishlists tab content */}
      {activeTab === 'league' && selectedLeagueId && (
        <LeagueMateWishlists
          leagueMates={leagueMates}
          leagueMatesLoading={leagueMatesLoading}
          selectedMateId={selectedMateId}
          onSelectMate={setSelectedMateId}
          mateMovies={mateMovies}
          mateMoviesLoading={mateMoviesLoading}
          myWishlistedIds={myWishlistedIds}
          getDraftStatus={getDraftStatus}
        />
      )}
    </div>
  )
}

// ---------- Shared sub-components ----------

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
    <div
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
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gold/20 text-gold border border-gold/30 backdrop-blur-sm">
            <Heart className="w-3 h-3 fill-current" />
            Both
          </span>
        </div>
      )}

      {/* Poster */}
      <div className="relative aspect-[2/3] bg-elevated overflow-hidden">
        {movie.poster_url ? (
          <Image
            src={getTmdbPosterUrl(movie.poster_url, 'w342') ?? movie.poster_url}
            alt={movie.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-foreground-muted">
            <Film className="w-12 h-12 mb-2" />
            <span className="text-xs">No poster</span>
          </div>
        )}

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
          className="font-display font-semibold text-sm text-foreground truncate group-hover:text-gold transition-colors"
          title={movie.title}
        >
          {movie.title}
        </h3>
        <p className="text-xs text-foreground-muted mt-1">
          Added {formatCompactDate(movie.added_at)}
        </p>
      </div>
    </div>
  )
}

function DraftStatusBadge({ status, label }: { status: DraftStatus; label: string }): React.ReactElement {
  const colorClasses: Record<DraftStatus, string> = {
    available: 'bg-success-bg text-success border-success',
    yours: 'bg-gold-muted text-gold border-gold',
    drafted: 'bg-elevated text-foreground-muted border-border',
  }

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${colorClasses[status]}`}
    >
      {label}
    </span>
  )
}

// ---------- League-mate wishlists ----------

function LeagueMateWishlists({
  leagueMates,
  leagueMatesLoading,
  selectedMateId,
  onSelectMate,
  mateMovies,
  mateMoviesLoading,
  myWishlistedIds,
  getDraftStatus,
}: {
  leagueMates: LeagueMate[]
  leagueMatesLoading: boolean
  selectedMateId: string | null
  onSelectMate: (id: string | null) => void
  mateMovies: WishlistedMovie[]
  mateMoviesLoading: boolean
  myWishlistedIds: Set<number>
  getDraftStatus: (tmdbId: number) => { status: DraftStatus; label: string } | null
}): React.ReactElement {
  const selectedMate = leagueMates.find((m) => m.userId === selectedMateId)

  if (leagueMatesLoading) {
    return (
      <div className="animate-fade-in space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4 rounded-lg bg-surface border border-border">
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

  if (leagueMates.length === 0) {
    return (
      <div className="text-center py-20 animate-fade-in">
        <Users className="w-12 h-12 text-foreground-muted mx-auto mb-4" />
        <h2 className="font-display text-xl font-semibold text-foreground mb-2">
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
      {/* League-mate list */}
      <div className="space-y-2 mb-8">
        {leagueMates.map((mate) => {
          const isSelected = selectedMateId === mate.userId

          return (
            <button
              key={mate.userId}
              onClick={() => onSelectMate(isSelected ? null : mate.userId)}
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
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium truncate block ${
                  isSelected ? 'text-gold' : 'text-foreground'
                }`}>
                  {mate.displayName}
                </span>
                <span className="text-xs text-foreground-muted">
                  {mate.wishlistCount} {mate.wishlistCount === 1 ? 'movie' : 'movies'}
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-foreground-muted transition-transform flex-shrink-0 ${
                  isSelected ? 'rotate-180' : ''
                }`}
              />
            </button>
          )
        })}
      </div>

      {/* Selected league-mate's wishlist */}
      {selectedMateId && selectedMate && (
        <div className="animate-fade-in">
          <h3 className="font-display text-lg font-semibold text-foreground mb-4">
            {selectedMate.displayName}&apos;s Wishlist
          </h3>

          {mateMoviesLoading ? (
            <div className={MOVIE_GRID_CLASSES}>
              {Array.from({ length: 6 }).map((_, i) => (
                <MovieCardSkeleton key={i} />
              ))}
            </div>
          ) : mateMovies.length === 0 ? (
            <div className="text-center py-12">
              <Film className="w-10 h-10 text-foreground-muted mx-auto mb-3" />
              <p className="text-foreground-secondary">
                {selectedMate.displayName}&apos;s wishlist is empty.
              </p>
            </div>
          ) : (
            <div className={MOVIE_GRID_CLASSES}>
              {mateMovies.map((movie, index) => (
                <WishlistMovieCard
                  key={movie.id}
                  movie={movie}
                  index={index}
                  draftStatus={getDraftStatus(movie.tmdb_id)}
                  isOverlap={myWishlistedIds.has(movie.tmdb_id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Compact relative date for wishlist cards (e.g., "today", "3d ago", "2w ago").
 * Distinct from utils/date.ts formatRelativeDate which uses full words.
 */
function formatCompactDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
