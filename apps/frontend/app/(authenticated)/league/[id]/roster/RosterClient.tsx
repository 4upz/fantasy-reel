'use client'

import { useCallback, useMemo, useState } from 'react'
import Image from 'next/image'
import { Film, Trophy, ShoppingCart, Target, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { formatCriticScore, formatFantasyPoints } from '@/utils/scoring'
import { findDropBlocker, type DropBlocker } from './dropRules'
import DropMovieModal from './DropMovieModal'
import type { League, Movie, TeamBudget, DraftPick, Pickup, Counterpick } from '@/types'

interface RosterCounterpick extends Counterpick {
  movies: Movie
  target_team: { name: string }
}

/** Team that counterpicked a holding, joined in by the roster page. */
type CounterpickerRef = { name: string } | null

type RosterDraftPick = DraftPick & { movies: Movie; counterpicked_by: CounterpickerRef }
type RosterPickup = Pickup & { movies: Movie; counterpicked_by: CounterpickerRef }

interface RosterClientProps {
  league: League
  team: { id: string; name: string }
  draftPicks: RosterDraftPick[]
  pickups: RosterPickup[]
  budget: TeamBudget | null
  dropCount: number
  userId: string
  counterpicks: RosterCounterpick[]
  /** Movies with an open counterpick auction, which blocks a drop. */
  contestedMovieIds: string[]
}

/**
 * A movie on the roster, flattened so draft picks and pickups share one drop
 * path. The two differ only in their subtitle and which id drop-movie wants.
 */
interface Holding {
  id: string
  source: 'draftPicks' | 'pickups'
  movie: Movie
  label: string
  counterpickedByTeamId: string | null
  counterpickerName: string | null
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
  const [pending, setPending] = useState<Holding | null>(null)

  const dropsRemaining = league.drop_limit - dropCount
  const contested = useMemo(() => new Set(contestedMovieIds), [contestedMovieIds])

  const draftHoldings: Holding[] = useMemo(
    () =>
      draftPicks.map((pick) => ({
        id: pick.id,
        source: 'draftPicks' as const,
        movie: pick.movies,
        label: `Round ${pick.round}, Pick ${pick.pick_number}`,
        counterpickedByTeamId: pick.counterpicked_by_team_id,
        counterpickerName: pick.counterpicked_by?.name ?? null,
      })),
    [draftPicks]
  )

  const pickupHoldings: Holding[] = useMemo(
    () =>
      pickups.map((pickup) => ({
        id: pickup.id,
        source: 'pickups' as const,
        movie: pickup.movies,
        label: `$${pickup.amount_paid}`,
        counterpickedByTeamId: pickup.counterpicked_by_team_id,
        counterpickerName: pickup.counterpicked_by?.name ?? null,
      })),
    [pickups]
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
      holding.source === 'draftPicks'
        ? { draft_pick_id: holding.id }
        : { pickup_id: holding.id }

    const { error } = await callEdgeFunction('drop-movie', { body })

    // Thrown so useAsyncAction surfaces it in the modal, which stays open. A
    // toast alone would vanish behind the dialog the player is still looking at.
    if (error) throw new Error(error)

    toast.success(`Dropped ${holding.movie.title}`)
    if (holding.source === 'draftPicks') {
      setDraftPicks((prev) => prev.filter((p) => p.id !== holding.id))
    } else {
      setPickups((prev) => prev.filter((p) => p.id !== holding.id))
    }
    setDropCount((prev) => prev + 1)
    setPending(null)
  }, [])

  const { execute: confirmDrop, isLoading: isDropping, error: dropError, reset } =
    useAsyncAction(dropMovie)

  const closeModal = useCallback(() => {
    if (isDropping) return
    reset()
    setPending(null)
  }, [isDropping, reset])

  const totalMovies = draftPicks.length + pickups.length
  const pendingBlocker = pending ? blockerFor(pending) : null

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

      {/* Draft Picks Section */}
      <RosterSection
        icon={<Trophy className="w-5 h-5 text-gold" />}
        title="Draft Picks"
        holdings={draftHoldings}
        emptyText="No draft picks yet."
        blockerFor={blockerFor}
        onDropClick={setPending}
      />

      {/* Pickups Section */}
      <RosterSection
        icon={<ShoppingCart className="w-5 h-5 text-gold" />}
        title="Pickups"
        holdings={pickupHoldings}
        emptyText="No pickups yet. Win bids to add movies!"
        blockerFor={blockerFor}
        onDropClick={setPending}
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

      {pending && (
        <DropMovieModal
          movie={pending.movie}
          label={pending.label}
          blocker={pendingBlocker}
          counterpickerName={pending.counterpickerName}
          league={league}
          dropCount={dropCount}
          slotsFilled={totalMovies}
          isDropping={isDropping}
          error={dropError}
          onClose={closeModal}
          onConfirm={() => {
            // useAsyncAction rethrows so it can expose `error`; the modal renders
            // it, so nothing is lost by swallowing the rejection here.
            void confirmDrop(pending).catch(() => {})
          }}
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
  onDropClick,
}: {
  icon: React.ReactNode
  title: string
  holdings: Holding[]
  emptyText: string
  blockerFor: (holding: Holding) => DropBlocker | null
  onDropClick: (holding: Holding) => void
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
              onDropClick={() => onDropClick(holding)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Poster({ movie }: { movie: Movie }) {
  if (!movie.poster_url) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Film className="w-12 h-12 text-foreground-muted" aria-hidden="true" />
      </div>
    )
  }

  return (
    <Image
      src={`https://image.tmdb.org/t/p/w342${movie.poster_url}`}
      alt={movie.title}
      fill
      className="object-cover"
    />
  )
}

function MovieCard({
  holding,
  isLocked,
  onDropClick,
}: {
  holding: Holding
  isLocked: boolean
  onDropClick: () => void
}) {
  const { movie, label } = holding

  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="relative aspect-[2/3] bg-elevated">
        <Poster movie={movie} />
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

        {/* Keeps the control on a common baseline across a row of cards whose
            score lines differ in height. */}
        <div className="flex-1" />

        {/* A named control below the art, not an icon over it. Always rendered,
            locked or not: a movie you cannot drop still owes you the reason,
            which the modal gives on click. */}
        <button
          type="button"
          onClick={onDropClick}
          data-testid="drop-movie-button"
          data-locked={isLocked ? 'true' : 'false'}
          aria-label={
            isLocked ? `Why ${movie.title} cannot be dropped` : `Drop ${movie.title}`
          }
          className={`mt-3 flex h-11 w-full flex-none items-center justify-center gap-1.5 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson sm:h-9 ${
            isLocked
              ? 'border-border bg-transparent text-foreground-muted hover:border-border-hover hover:text-foreground-secondary'
              : 'border-crimson/40 bg-transparent text-crimson hover:bg-crimson hover:text-white'
          }`}
        >
          {isLocked && <Lock className="h-3 w-3" aria-hidden="true" />}
          Drop
        </button>
      </div>
    </div>
  )
}
