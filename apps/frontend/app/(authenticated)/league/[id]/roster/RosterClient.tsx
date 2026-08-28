'use client'

import { useCallback, useMemo, useState } from 'react'
import Image from 'next/image'
import { Film, Trophy, ShoppingCart, Target, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { formatCriticScore, formatFantasyPoints } from '@/utils/scoring'
import { findDropBlocker, type DropBlocker } from './dropRules'
import LeagueMovieModal from '../components/LeagueMovieModal'
import { getTmdbPosterUrl } from '../components/utils'
import { holdingMovie } from '@/utils/holdings'
import type { Holding, RosterHolding } from './types'
import type { HoldingMovie, League, Movie, TeamBudget, Counterpick } from '@/types'

interface RosterCounterpick extends Counterpick {
  movies: Movie
  target_team: { name: string }
}

interface RosterClientProps {
  league: League
  team: { id: string; name: string }
  /** The whole roster in one list - draft picks and pickups, already active. */
  holdings: RosterHolding[]
  budget: TeamBudget | null
  dropCount: number
  userId: string
  counterpicks: RosterCounterpick[]
  /** Movies with an open counterpick auction, which blocks a drop. */
  contestedMovieIds: string[]
}

/** One roster card's worth of a holding: how it was acquired decides the label. */
function toHolding(row: RosterHolding): Holding {
  return {
    id: row.holding_id,
    source: row.source,
    movie: holdingMovie(row),
    label:
      row.source === 'draft' ? `Round ${row.round}, Pick ${row.pick_number}` : `$${row.amount_paid}`,
    counterpickedByTeamId: row.counterpicked_by_team_id,
    counterpickerName: row.counterpicked_by_name,
  }
}

export default function RosterClient({
  league,
  team,
  holdings: initialHoldings,
  budget,
  dropCount: initialDropCount,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userId,
  counterpicks,
  contestedMovieIds,
}: RosterClientProps) {
  const [holdings, setHoldings] = useState(initialHoldings)
  const [dropCount, setDropCount] = useState(initialDropCount)
  const [selected, setSelected] = useState<Holding | null>(null)

  const dropsRemaining = league.drop_limit - dropCount
  const contested = useMemo(() => new Set(contestedMovieIds), [contestedMovieIds])

  const draftHoldings: Holding[] = useMemo(
    () => holdings.filter((row) => row.source === 'draft').map(toHolding),
    [holdings]
  )

  const pickupHoldings: Holding[] = useMemo(
    () => holdings.filter((row) => row.source === 'pickup').map(toHolding),
    [holdings]
  )

  const blockerFor = useCallback(
    (holding: Holding): DropBlocker | null =>
      findDropBlocker(holding.movie, holding.counterpickedByTeamId, {
        leagueStatus: league.status,
        counterpicksBlockDrops: league.counterpicks_block_drops,
        contestedMovieIds: contested,
        dropsRemaining,
      }),
    [league.status, league.counterpicks_block_drops, contested, dropsRemaining]
  )

  const dropMovie = useCallback(async (holding: Holding): Promise<void> => {
    const body =
      holding.source === 'draft' ? { draft_pick_id: holding.id } : { pickup_id: holding.id }

    const { error } = await callEdgeFunction('drop-movie', { body })

    // Thrown so useAsyncAction surfaces it in the dialog, which stays open. A
    // toast alone would vanish behind the panel the player is still looking at.
    if (error) throw new Error(error)

    toast.success(`Dropped ${holding.movie.title}`)
    setHoldings((prev) => prev.filter((row) => row.holding_id !== holding.id))
    setDropCount((prev) => prev + 1)
    setSelected(null)
  }, [])

  const { execute: confirmDrop, isLoading: isDropping, error: dropError, reset } =
    useAsyncAction(dropMovie)

  const closeModal = useCallback(() => {
    if (isDropping) return
    reset()
    setSelected(null)
  }, [isDropping, reset])

  const totalMovies = holdings.length

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="font-display text-2xl font-bold text-foreground"
            data-testid="roster-team-name"
          >
            {team.name}&apos;s Roster
          </h1>
          <p className="text-foreground-secondary">
            {totalMovies}/{league.total_slots} slots filled
          </p>
        </div>

        <div className="text-right">
          <p className="text-foreground-muted text-sm">Budget Remaining</p>
          <p className="font-display text-2xl font-semibold text-gold">
            ${budget?.remaining_budget ?? 100}
          </p>
          <p
            className={`text-sm ${dropsRemaining > 0 ? 'text-foreground-muted' : 'text-crimson'}`}
            data-testid="drops-summary"
          >
            {dropsRemaining > 0
              ? `Drops: ${dropCount}/${league.drop_limit} used`
              : `No drops left (${dropCount}/${league.drop_limit} used)`}
          </p>
        </div>
      </div>

      <RosterSection
        icon={<Trophy className="w-5 h-5 text-gold" />}
        title="Draft Picks"
        holdings={draftHoldings}
        emptyText="No draft picks yet."
        blockerFor={blockerFor}
        onSelect={setSelected}
      />

      <RosterSection
        icon={<ShoppingCart className="w-5 h-5 text-gold" />}
        title="Pickups"
        holdings={pickupHoldings}
        emptyText="No pickups yet. Win bids to add movies!"
        blockerFor={blockerFor}
        onSelect={setSelected}
      />

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
                <div className="relative aspect-[2/3] bg-elevated">
                  <Poster movie={cp.movies} />
                  <div className="absolute top-2 left-2 px-2 py-0.5 bg-crimson/80 backdrop-blur-sm rounded text-xs font-medium text-white flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    Counterpick
                  </div>
                </div>

                <div className="p-3">
                  <h3 className="font-semibold text-foreground text-sm truncate">
                    {cp.movies.title}
                  </h3>
                  <p className="text-foreground-muted text-xs">
                    vs. {cp.target_team.name} ({cp.phase})
                  </p>
                  {cp.fantasy_points !== null && (
                    <p
                      className={`text-sm font-semibold mt-1 ${cp.fantasy_points >= 0 ? 'text-success' : 'text-crimson'}`}
                    >
                      {formatFantasyPoints(cp.fantasy_points)} pts
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <LeagueMovieModal
          movie={selected.movie}
          contextHeading="On your roster"
          contextLabel={selected.label}
          drop={{
            blocker: blockerFor(selected),
            league,
            dropCount,
            slotsFilled: totalMovies,
            counterpickerName: selected.counterpickerName,
            isDropping,
            error: dropError,
            onConfirm: () => {
              // useAsyncAction rethrows so it can expose `error`; the dialog
              // renders it, so nothing is lost by swallowing the rejection.
              void confirmDrop(selected).catch(() => {})
            },
          }}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

function RosterSection({
  icon,
  title,
  holdings,
  emptyText,
  blockerFor,
  onSelect,
}: {
  icon: React.ReactNode
  title: string
  holdings: Holding[]
  emptyText: string
  blockerFor: (holding: Holding) => DropBlocker | null
  onSelect: (holding: Holding) => void
}) {
  return (
    <div>
      <h2 className="font-display font-semibold text-lg text-foreground flex items-center gap-2 mb-4">
        {icon}
        {title} ({holdings.length})
      </h2>

      {holdings.length === 0 ? (
        <p className="text-foreground-muted">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {holdings.map((holding) => (
            <MovieCard
              key={holding.id}
              holding={holding}
              isLocked={blockerFor(holding) !== null}
              onSelect={() => onSelect(holding)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Poster({ movie }: { movie: HoldingMovie }) {
  if (!movie.poster_url) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Film className="w-12 h-12 text-foreground-muted" aria-hidden="true" />
      </div>
    )
  }

  return (
    <Image
      src={getTmdbPosterUrl(movie.poster_url, 'w342')!}
      alt={movie.title}
      fill
      // Matches the 2 / 3 / 4 column grid below, so the browser stops fetching
      // a full-width image for a quarter-width slot.
      sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
      className="object-cover"
    />
  )
}

/**
 * The whole card is the control: tapping a movie opens its details, where the
 * roster's actions live.
 *
 * A locked movie still carries a visible badge. Hiding that would undo the fix
 * this flow exists for - a player has to be able to see which movies are stuck
 * without opening each one to find out.
 */
function MovieCard({
  holding,
  isLocked,
  onSelect,
}: {
  holding: Holding
  isLocked: boolean
  onSelect: () => void
}) {
  const { movie, label } = holding

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="roster-movie-card"
      data-locked={isLocked ? 'true' : 'false'}
      aria-label={`View ${movie.title}${isLocked ? ' (locked)' : ''}`}
      className="card card-interactive flex cursor-pointer flex-col overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      <div className="relative aspect-[2/3] bg-elevated">
        <Poster movie={movie} />

        {isLocked && (
          <span
            data-testid="roster-lock-badge"
            className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-[11px] font-medium text-foreground-secondary backdrop-blur-sm"
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            Locked
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="truncate text-sm font-semibold text-foreground">{movie.title}</h3>
        <p className="text-xs text-foreground-muted">{label}</p>
        {movie.fantasy_points !== null ? (
          <p className="mt-1 flex items-baseline gap-1.5 text-sm font-semibold">
            <span className={movie.fantasy_points >= 0 ? 'text-success' : 'text-crimson'}>
              {formatFantasyPoints(movie.fantasy_points)} pts
            </span>
            {movie.combined_score !== null && (
              <span className="text-xs font-normal text-foreground-muted">
                {formatCriticScore(movie.combined_score)}
              </span>
            )}
          </p>
        ) : (
          <p className="mt-1 text-xs text-foreground-muted">Pending</p>
        )}
      </div>
    </button>
  )
}
