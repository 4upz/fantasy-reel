'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Film, Trophy, ShoppingCart, Trash2, Target } from 'lucide-react'
import { toast } from 'sonner'
import { callEdgeFunction } from '@/utils/supabase/functions'
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
}: RosterClientProps) {
  const [draftPicks, setDraftPicks] = useState(initialDraftPicks)
  const [pickups, setPickups] = useState(initialPickups)
  const [dropCount, setDropCount] = useState(initialDropCount)
  const [droppingId, setDroppingId] = useState<string | null>(null)

  const canDrop = dropCount < league.drop_limit

  // Check if a movie can be dropped (not released yet)
  const canDropMovie = (movie: Movie): boolean => {
    if (!movie.release_date) return true // Unknown release date = can drop
    const today = new Date().toISOString().split('T')[0]
    return movie.release_date >= today
  }

  async function handleDrop(
    id: string,
    movieTitle: string,
    body: Record<string, string>,
    removeFrom: 'draftPicks' | 'pickups'
  ): Promise<void> {
    if (!canDrop) {
      toast.error(`You've used all ${league.drop_limit} drops`)
      return
    }

    setDroppingId(id)

    const { error } = await callEdgeFunction('drop-movie', { body })

    setDroppingId(null)

    if (error) {
      toast.error(error)
    } else {
      toast.success(`Dropped ${movieTitle}`)
      if (removeFrom === 'draftPicks') {
        setDraftPicks(prev => prev.filter(p => p.id !== id))
      } else {
        setPickups(prev => prev.filter(p => p.id !== id))
      }
      setDropCount(prev => prev + 1)
    }
  }

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
          <p className="text-foreground-muted text-sm">
            Drops: {dropCount}/{league.drop_limit} used
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
            {draftPicks.map((pick) => (
              <MovieCard
                key={pick.id}
                movie={pick.movies}
                label={`Round ${pick.round}, Pick ${pick.pick_number}`}
                onDrop={canDrop && canDropMovie(pick.movies)
                  ? () => handleDrop(pick.id, pick.movies.title, { draft_pick_id: pick.id }, 'draftPicks')
                  : undefined}
                isDropping={droppingId === pick.id}
              />
            ))}
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
            {pickups.map((pickup) => (
              <MovieCard
                key={pickup.id}
                movie={pickup.movies}
                label={`$${pickup.amount_paid}`}
                onDrop={canDrop && canDropMovie(pickup.movies)
                  ? () => handleDrop(pickup.id, pickup.movies.title, { pickup_id: pickup.id }, 'pickups')
                  : undefined}
                isDropping={droppingId === pickup.id}
              />
            ))}
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
  isDropping?: boolean
}

function MovieCard({ movie, label, onDrop, isDropping }: MovieCardProps) {
  const [showDropConfirm, setShowDropConfirm] = useState(false)

  return (
    <div className="card overflow-hidden group">
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

        {/* Drop Button */}
        {onDrop && !showDropConfirm && (
          <button
            onClick={() => setShowDropConfirm(true)}
            className="absolute top-2 right-2 p-2 bg-background/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-crimson"
          >
            <Trash2 className="w-4 h-4 text-foreground" />
          </button>
        )}

        {/* Drop Confirmation */}
        {showDropConfirm && (
          <div className="absolute inset-0 bg-background/90 flex flex-col items-center justify-center p-4">
            <p className="text-foreground text-center mb-3">Drop this movie?</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onDrop?.()
                  setShowDropConfirm(false)
                }}
                disabled={isDropping}
                className="btn btn-danger text-sm py-1 px-3"
              >
                {isDropping ? '...' : 'Drop'}
              </button>
              <button
                onClick={() => setShowDropConfirm(false)}
                className="btn btn-ghost text-sm py-1 px-3"
              >
                Cancel
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
      </div>
    </div>
  )
}
