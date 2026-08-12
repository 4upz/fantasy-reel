'use client'

import { useCallback, useMemo, useState } from 'react'
import Image from 'next/image'
import { Film, Trophy, ShoppingCart, Trash2, Target, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { formatCriticScore, formatFantasyPoints } from '@/utils/scoring'
import type { League, Movie, TeamBudget, DraftPick, Pickup, Counterpick } from '@/types'

interface RosterCounterpick extends Counterpick {
  movies: Movie
  target_team: { name: string }
}

interface RosterClientProps {
  league: League
  team: { id: string; name: string }
  draftPicks: (DraftPick & { movies: Movie })[]
  pickups: (Pickup & { movies: Movie })[]
  budget: TeamBudget | null
  dropCount: number
  userId: string
  counterpicks: RosterCounterpick[]
  /** Movies with an open counterpick auction, which blocks a drop. */
  contestedMovieIds: string[]
}

/**
 * Why a held movie cannot be dropped right now. Mirrors the checks drop-movie
 * runs, so the roster explains the refusal instead of leaving the player to
 * discover it by tapping.
 */
type DropBlocker = 'released' | 'counterpicked' | 'contested' | 'no_drops_left'

/**
 * Only the surprising blockers get a line on the card. "Released" is self
 * evident from the score beside it, and an exhausted drop allowance belongs in
 * the header once rather than on every card.
 */
const BLOCKER_NOTICE: Partial<Record<DropBlocker, string>> = {
  counterpicked: 'Counterpicked — locked',
  contested: 'Counterpick bid open — locked',
}

export default function RosterClient({
  league,
  team,
  draftPicks: initialDraftPicks,
  pickups: initialPickups,
  budget,
  dropCount: initialDropCount,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userId,
  counterpicks,
  contestedMovieIds,
}: RosterClientProps) {
  const [draftPicks, setDraftPicks] = useState(initialDraftPicks)
  const [pickups, setPickups] = useState(initialPickups)
  const [dropCount, setDropCount] = useState(initialDropCount)
  const [droppingId, setDroppingId] = useState<string | null>(null)

  const canDrop = dropCount < league.drop_limit
  const contested = useMemo(() => new Set(contestedMovieIds), [contestedMovieIds])

  const blockerFor = useCallback(
    (movie: Movie, counterpickedByTeamId: string | null): DropBlocker | null => {
      // Same order drop-movie applies, so the card never promises a drop the
      // Edge Function would refuse.
      const today = new Date().toISOString().split('T')[0]
      if (movie.release_date && movie.release_date < today) return 'released'

      if (league.counterpicks_block_drops) {
        if (counterpickedByTeamId) return 'counterpicked'
        if (contested.has(movie.id)) return 'contested'
      }

      if (!canDrop) return 'no_drops_left'
      return null
    },
    [league.counterpicks_block_drops, contested, canDrop]
  )

  const dropMovie = useCallback(
    async (
      id: string,
      movieTitle: string,
      body: Record<string, string>,
      removeFrom: 'draftPicks' | 'pickups'
    ): Promise<void> => {
      setDroppingId(id)

      try {
        const { error } = await callEdgeFunction('drop-movie', { body })

        if (error) {
          toast.error(error)
          return
        }

        toast.success(`Dropped ${movieTitle}`)
        if (removeFrom === 'draftPicks') {
          setDraftPicks(prev => prev.filter(p => p.id !== id))
        } else {
          setPickups(prev => prev.filter(p => p.id !== id))
        }
        setDropCount(prev => prev + 1)
      } finally {
        setDroppingId(null)
      }
    },
    []
  )

  const { execute: handleDrop } = useAsyncAction(dropMovie)

  const totalMovies = draftPicks.length + pickups.length
  const totalSlots = league.total_slots

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground" data-testid="roster-team-name">
            {team.name}&apos;s Roster
          </h1>
          <p className="text-foreground-secondary">
            {totalMovies}/{totalSlots} slots filled
          </p>
        </div>

        <div className="text-right">
          <p className="text-foreground-muted text-sm">Budget Remaining</p>
          <p className="font-display text-2xl font-semibold text-gold">
            ${budget?.remaining_budget ?? 100}
          </p>
          <p className={`text-sm ${canDrop ? 'text-foreground-muted' : 'text-crimson'}`}>
            {canDrop
              ? `Drops: ${dropCount}/${league.drop_limit} used`
              : `No drops left (${dropCount}/${league.drop_limit} used)`}
          </p>
        </div>
      </div>

      {/* Draft Picks Section */}
      <div>
        <h2 className="font-display font-semibold text-lg text-foreground flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-gold" />
          Draft Picks ({draftPicks.length})
        </h2>

        {draftPicks.length === 0 ? (
          <p className="text-foreground-muted">No draft picks yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {draftPicks.map((pick) => {
              const blocker = blockerFor(pick.movies, pick.counterpicked_by_team_id)
              return (
                <MovieCard
                  key={pick.id}
                  movie={pick.movies}
                  label={`Round ${pick.round}, Pick ${pick.pick_number}`}
                  onDrop={blocker
                    ? undefined
                    : () => handleDrop(pick.id, pick.movies.title, { draft_pick_id: pick.id }, 'draftPicks')}
                  blockerNotice={blocker ? BLOCKER_NOTICE[blocker] : undefined}
                  isDropping={droppingId === pick.id}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Pickups Section */}
      <div>
        <h2 className="font-display font-semibold text-lg text-foreground flex items-center gap-2 mb-4">
          <ShoppingCart className="w-5 h-5 text-gold" />
          Pickups ({pickups.length})
        </h2>

        {pickups.length === 0 ? (
          <p className="text-foreground-muted">No pickups yet. Win bids to add movies!</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {pickups.map((pickup) => {
              const blocker = blockerFor(pickup.movies, pickup.counterpicked_by_team_id)
              return (
                <MovieCard
                  key={pickup.id}
                  movie={pickup.movies}
                  label={`$${pickup.amount_paid}`}
                  onDrop={blocker
                    ? undefined
                    : () => handleDrop(pickup.id, pickup.movies.title, { pickup_id: pickup.id }, 'pickups')}
                  blockerNotice={blocker ? BLOCKER_NOTICE[blocker] : undefined}
                  isDropping={droppingId === pickup.id}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Counterpicks Section */}
      <div>
        <h2 className="font-display font-semibold text-lg text-foreground flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-crimson" />
          Counterpicks ({counterpicks.length})
        </h2>

        {counterpicks.length === 0 ? (
          <p className="text-foreground-muted">No counterpicks claimed yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {counterpicks.map((cp) => (
              <div key={cp.id} className="card overflow-hidden">
                {/* Poster */}
                <div className="relative aspect-[2/3] bg-elevated">
                  {cp.movies.poster_url ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w342${cp.movies.poster_url}`}
                      alt={cp.movies.title}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-12 h-12 text-foreground-muted" />
                    </div>
                  )}
                  {/* Counterpick badge */}
                  <div className="absolute top-2 left-2 px-2 py-0.5 bg-crimson/80 backdrop-blur-sm rounded text-xs font-medium text-white flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    Counterpick
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <h3 className="font-semibold text-foreground text-sm truncate">{cp.movies.title}</h3>
                  <p className="text-foreground-muted text-xs">
                    vs. {cp.target_team.name} ({cp.phase})
                  </p>
                  {cp.fantasy_points !== null && (
                    <p className={`text-sm font-semibold mt-1 ${cp.fantasy_points >= 0 ? 'text-success' : 'text-crimson'}`}>
                      {formatFantasyPoints(cp.fantasy_points)} pts
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface MovieCardProps {
  movie: Movie
  label: string
  onDrop?: () => void
  /** Shown when the movie is held but locked, in place of the drop control. */
  blockerNotice?: string
  isDropping?: boolean
}

function MovieCard({ movie, label, onDrop, blockerNotice, isDropping }: MovieCardProps) {
  const [showDropConfirm, setShowDropConfirm] = useState(false)

  return (
    <div className="card overflow-hidden">
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-elevated">
        {movie.poster_url ? (
          <Image
            src={`https://image.tmdb.org/t/p/w342${movie.poster_url}`}
            alt={movie.title}
            fill
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-12 h-12 text-foreground-muted" />
          </div>
        )}

        {/* Drop control. Always visible: a hover-only reveal is unreachable on
            touch, which is how a team can sit on a movie it meant to drop. */}
        {onDrop && !showDropConfirm && (
          <button
            type="button"
            onClick={() => setShowDropConfirm(true)}
            aria-label={`Drop ${movie.title}`}
            data-testid="drop-movie-button"
            className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/70 text-foreground-secondary backdrop-blur-sm transition-colors hover:border-crimson/60 hover:text-crimson focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson sm:h-9 sm:w-9"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {/* Drop Confirmation */}
        {showDropConfirm && (
          <div
            role="group"
            aria-label={`Confirm dropping ${movie.title}`}
            className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 p-4"
          >
            <p className="mb-1 text-center font-semibold text-foreground">Drop {movie.title}?</p>
            <p className="mb-3 text-center text-xs text-foreground-muted">Uses one of your drops.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onDrop?.()
                  setShowDropConfirm(false)
                }}
                disabled={isDropping}
                className="btn btn-danger px-3 py-1 text-sm"
              >
                {isDropping ? 'Dropping…' : 'Drop'}
              </button>
              <button
                type="button"
                onClick={() => setShowDropConfirm(false)}
                className="btn btn-ghost px-3 py-1 text-sm"
              >
                Keep
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-semibold text-foreground text-sm truncate">{movie.title}</h3>
        <p className="text-foreground-muted text-xs">{label}</p>
        {movie.fantasy_points !== null ? (
          <p className="text-sm font-semibold mt-1 flex items-baseline gap-1.5">
            <span className={movie.fantasy_points >= 0 ? 'text-success' : 'text-crimson'}>
              {formatFantasyPoints(movie.fantasy_points)} pts
            </span>
            {movie.combined_score !== null && (
              <span className="text-foreground-muted text-xs font-normal">
                {formatCriticScore(movie.combined_score)}
              </span>
            )}
          </p>
        ) : (
          <p className="text-foreground-muted text-xs mt-1">Pending</p>
        )}
        {blockerNotice && (
          <p className="mt-1 flex items-center gap-1 text-xs text-foreground-muted">
            <Lock className="h-3 w-3 flex-none" aria-hidden="true" />
            {blockerNotice}
          </p>
        )}
      </div>
    </div>
  )
}
