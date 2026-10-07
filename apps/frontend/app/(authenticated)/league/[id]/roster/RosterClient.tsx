'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trophy, ShoppingCart, Target } from 'lucide-react'
import { toast } from 'sonner'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import FantasyPoints from '@/app/components/FantasyPoints'
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
  const sectionHeadings = useRef<Record<Holding['source'], HTMLHeadingElement | null>>({ draft: null, pickup: null })
  /** Set by a successful drop, and acted on once its dialog has closed. */
  const [droppedHolding, setDroppedHolding] = useState<Holding | null>(null)

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

    setHoldings((prev) => prev.filter((row) => row.holding_id !== holding.id))
    setDropCount((prev) => prev + 1)
    setSelected(null)
    setDroppedHolding(holding)
  }, [])

  // The dropped card was the dialog's opener, so focus has nowhere to return
  // to. Once the dialog is gone, land on the section the movie left, and only
  // then raise the toast: one shown while the dialog was open would be hidden
  // from screen readers along with the rest of the page.
  useEffect(() => {
    if (!droppedHolding || selected) return
    sectionHeadings.current[droppedHolding.source]?.focus()
    toast.success(`Dropped ${droppedHolding.movie.title}`)
    setDroppedHolding(null)
  }, [droppedHolding, selected])

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
        headingRef={(node) => { sectionHeadings.current.draft = node }}
        icon={<Trophy className="w-5 h-5 text-gold" aria-hidden="true" />}
        title="Draft Picks"
        holdings={draftHoldings}
        emptyText="No draft picks yet."
        blockerFor={blockerFor}
        onSelect={setSelected}
      />

      <RosterSection
        headingRef={(node) => { sectionHeadings.current.pickup = node }}
        icon={<ShoppingCart className="w-5 h-5 text-gold" aria-hidden="true" />}
        title="Pickups"
        holdings={pickupHoldings}
        emptyText="No pickups yet. Win bids to add movies!"
        blockerFor={blockerFor}
        onSelect={setSelected}
      />

      {/* Counterpicks Section */}
      <div>
        <h2 className="type-section text-foreground flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-crimson-text" aria-hidden="true" />
          Counterpicks ({counterpicks.length})
        </h2>

        {counterpicks.length === 0 ? (
          <p className="text-foreground-secondary">No counterpicks claimed yet.</p>
        ) : (
          <ul role="list" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {counterpicks.map((cp) => (
              <li key={cp.id} className="card overflow-hidden">
                <div className="relative aspect-[2/3] bg-elevated">
                  <RosterPoster movie={cp.movies} />
                  {/* Every card in this section is a counterpick, as its heading says. */}
                  <div className="type-meta absolute top-2 left-2 px-2 py-0.5 bg-crimson/80 backdrop-blur-sm rounded text-white flex items-center gap-1" aria-hidden="true">
                    <Target className="w-3 h-3" />
                    Counterpick
                  </div>
                </div>

                <div className="p-3">
                  <h3 className="type-label text-foreground break-words">
                    {cp.movies.title}
                  </h3>
                  <p className="type-meta text-foreground-secondary">
                    vs. {cp.target_team.name}, claimed {cp.phase === 'draft' ? 'in the draft' : 'in bidding'}
                  </p>
                  {cp.fantasy_points !== null && (
                    <p className="type-number mt-1">
                      {/* The inverted score waits on the release of the movie it targets. */}
                      <FantasyPoints points={cp.fantasy_points} releaseDate={cp.movies.release_date} />
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
  headingRef,
  icon,
  title,
  holdings,
  emptyText,
  blockerFor,
  onSelect,
}: {
  /** Focus lands here after a drop removes a card from this section. */
  headingRef: React.Ref<HTMLHeadingElement>
  icon: React.ReactNode
  title: string
  holdings: Holding[]
  emptyText: string
  blockerFor: (holding: Holding) => DropBlocker | null
  onSelect: (holding: Holding) => void
}) {
  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="type-section text-foreground flex items-center gap-2 mb-4 focus:outline-none"
      >
        {icon}
        {title} ({holdings.length})
      </h2>

      {holdings.length === 0 ? (
        <p className="text-foreground-secondary">{emptyText}</p>
      ) : (
        <ul role="list" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {holdings.map((holding) => (
            <li key={holding.id} className="grid">
              <RosterMovieCard
                movie={holding.movie}
                label={holding.label}
                isLocked={blockerFor(holding) !== null}
                onSelect={() => onSelect(holding)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
