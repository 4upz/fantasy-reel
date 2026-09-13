'use client'

import { useCallback, useMemo, useState } from 'react'
import { Trophy, ShoppingCart, Target } from 'lucide-react'
import { toast } from 'sonner'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { formatFantasyPoints } from '@/utils/scoring'
import { findDropBlocker, type DropBlocker } from './dropRules'
import LeagueMovieModal from '../components/LeagueMovieModal'
import { RosterHeader, RosterMovieCard, RosterPoster } from './RosterPresentation'
import { holdingMovie } from '@/utils/holdings'
import type { Holding, RosterHolding } from './types'
import type { League, Movie, TeamBudget, Counterpick } from '@/types'

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
      <RosterHeader
        teamName={team.name}
        slotsFilled={totalMovies}
        totalSlots={league.total_slots}
        remainingBudget={budget?.remaining_budget ?? null}
        dropCount={dropCount}
        dropLimit={league.drop_limit}
      />

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
        <h2 className="type-section text-foreground flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-crimson" />
          Counterpicks ({counterpicks.length})
        </h2>

        {counterpicks.length === 0 ? (
          <p className="text-foreground-secondary">No counterpicks claimed yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {counterpicks.map((cp) => (
              <div key={cp.id} className="card overflow-hidden">
                <div className="relative aspect-[2/3] bg-elevated">
                  <RosterPoster movie={cp.movies} />
                  <div className="type-meta absolute top-2 left-2 px-2 py-0.5 bg-crimson/80 backdrop-blur-sm rounded text-white flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    Counterpick
                  </div>
                </div>

                <div className="p-3">
                  <h3 className="type-label text-foreground truncate">
                    {cp.movies.title}
                  </h3>
                  <p className="type-meta text-foreground-secondary">
                    vs. {cp.target_team.name} ({cp.phase})
                  </p>
                  {cp.fantasy_points !== null && (
                    <p
                      className={`type-number mt-1 ${cp.fantasy_points >= 0 ? 'text-success' : 'text-crimson'}`}
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
      <h2 className="type-section text-foreground flex items-center gap-2 mb-4">
        {icon}
        {title} ({holdings.length})
      </h2>

      {holdings.length === 0 ? (
        <p className="text-foreground-secondary">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {holdings.map((holding) => (
            <RosterMovieCard
              key={holding.id}
              movie={holding.movie}
              label={holding.label}
              isLocked={blockerFor(holding) !== null}
              onSelect={() => onSelect(holding)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
