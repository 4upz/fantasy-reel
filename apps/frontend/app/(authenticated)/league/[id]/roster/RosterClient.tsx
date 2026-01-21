'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Film, Trophy, ShoppingCart, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League, Movie, TeamBudget, DraftPick, Pickup } from '@/types'

interface RosterClientProps {
  league: League
  team: { id: string; name: string }
  draftPicks: (DraftPick & { movies: Movie })[]
  pickups: (Pickup & { movies: Movie })[]
  budget: TeamBudget | null
  dropCount: number
  userId: string
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
}: RosterClientProps) {
  const [pickups, setPickups] = useState(initialPickups)
  const [dropCount, setDropCount] = useState(initialDropCount)
  const [droppingId, setDroppingId] = useState<string | null>(null)

  const canDrop = dropCount < league.drop_limit

  const handleDrop = async (pickupId: string, movieTitle: string) => {
    if (!canDrop) {
      toast.error(`You've used all ${league.drop_limit} drops`)
      return
    }

    setDroppingId(pickupId)

    const { error } = await callEdgeFunction('drop-movie', {
      body: { pickup_id: pickupId },
    })

    setDroppingId(null)

    if (error) {
      toast.error(error)
    } else {
      toast.success(`Dropped ${movieTitle}`)
      setPickups(prev => prev.filter(p => p.id !== pickupId))
      setDropCount(prev => prev + 1)
    }
  }

  const totalMovies = initialDraftPicks.length + pickups.length
  const totalSlots = league.total_slots

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/league/${league.id}`}
          className="inline-flex items-center gap-2 text-foreground-secondary hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to League
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
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
      </div>

      {/* Draft Picks Section */}
      <div className="mb-8">
        <h2 className="font-display font-semibold text-lg text-foreground flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-gold" />
          Draft Picks ({initialDraftPicks.length})
        </h2>

        {initialDraftPicks.length === 0 ? (
          <p className="text-foreground-muted">No draft picks yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {initialDraftPicks.map((pick) => (
              <MovieCard
                key={pick.id}
                movie={pick.movies}
                label={`Round ${pick.round}, Pick ${pick.pick_number}`}
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
                onDrop={canDrop ? () => handleDrop(pickup.id, pickup.movies.title) : undefined}
                isDropping={droppingId === pickup.id}
              />
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
        {movie.combined_score !== null && (
          <p className="text-gold text-sm font-semibold mt-1">
            {movie.combined_score.toFixed(1)} pts
          </p>
        )}
      </div>
    </div>
  )
}
