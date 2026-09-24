/**
 * Which of a team's pending pickup bids would find roster room if every one of
 * them won, walking them in priority order.
 *
 * Mirrors `consume()` in supabase/functions/_shared/bid-resolution.ts, so the
 * cut line shows what processing will actually do:
 * - A free slot is spent first, even by a bid carrying a conditional drop. The
 *   drop is the fallback that buys room when no slot is left.
 * - With no slot left, a bid fits only by cashing its conditional drop, and a
 *   holding can be dropped once. A second bid naming the same holding finds it
 *   already gone, so it does not fit.
 *
 * A forecast, not a promise: budget, the league's drop allowance, and whether
 * a target is still droppable at processing time are settled server-side.
 *
 * @param dropTargets Each bid's conditional drop holding id, or null, in
 *   priority order.
 * @param freeSlots Roster slots the team has open.
 */
export function forecastBidFits(dropTargets: Array<string | null>, freeSlots: number): boolean[] {
  let slotsLeft = freeSlots
  const dropped = new Set<string>()

  return dropTargets.map((target) => {
    if (slotsLeft > 0) {
      slotsLeft -= 1
      return true
    }
    if (target !== null && !dropped.has(target)) {
      dropped.add(target)
      return true
    }
    return false
  })
}
