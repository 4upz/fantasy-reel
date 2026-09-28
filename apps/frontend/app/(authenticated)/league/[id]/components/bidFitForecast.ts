export type BidFunding = 'slot' | 'drop' | null

interface ForecastCapacity {
  freeSlots: number
  remainingDrops: number
  droppableHoldingIds: ReadonlySet<string>
}

interface DropHolding {
  holding_id: string
  movie_id: string
  release_date: string | null
  counterpicked_by_team_id: string | null
}

/** Current conditional-drop eligibility, matching the resolver's droppableHoldingIds. */
export function getDroppableBidHoldingIds(
  holdings: readonly DropHolding[],
  options: {
    today: string
    counterpicksBlockDrops: boolean
    contestedMovieIds: ReadonlySet<string>
  },
): Set<string> {
  return new Set(holdings.filter((holding) => {
    if (holding.release_date && holding.release_date < options.today) return false
    if (options.counterpicksBlockDrops) {
      if (holding.counterpicked_by_team_id) return false
      if (options.contestedMovieIds.has(holding.movie_id)) return false
    }
    return true
  }).map((holding) => holding.holding_id))
}

/**
 * Which of a team's pending pickup bids would find roster room if every one of
 * them won, walking them in priority order.
 *
 * Mirrors `consume()` in supabase/functions/_shared/bid-resolution.ts, so the
 * cut line shows what processing will actually do:
 * - A free slot is spent first, even by a bid carrying a conditional drop. The
 *   drop is the fallback that buys room when no slot is left.
 * - With no slot left, a bid needs an eligible conditional drop and remaining
 *   drop allowance. Each holding can be dropped once.
 *
 * A forecast, not a promise: budget, competing bids, and changes to a target's
 * eligibility before processing are settled server-side.
 *
 * @param dropTargets Each bid's conditional drop holding id, or null, in
 *   priority order.
 * @returns How each bid would get room, or null if it cannot currently fit.
 */
export function forecastBidFits(
  dropTargets: readonly (string | null)[],
  { freeSlots, remainingDrops, droppableHoldingIds }: ForecastCapacity,
): BidFunding[] {
  let slotsLeft = freeSlots
  let dropsLeft = remainingDrops
  const droppable = new Set(droppableHoldingIds)

  return dropTargets.map((target) => {
    if (slotsLeft > 0) {
      slotsLeft -= 1
      return 'slot'
    }
    if (target !== null && dropsLeft > 0 && droppable.has(target)) {
      dropsLeft -= 1
      droppable.delete(target)
      return 'drop'
    }
    return null
  })
}
