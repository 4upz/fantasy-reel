/**
 * Counterpick bid resolution (issue #24)
 *
 * A team may bid on more movies than it has `leagues.bidding_counterpick_slots`
 * for -- that is the point, it is betting on winning some of them. Resolving each
 * movie independently therefore lets a team that leads several auctions win them
 * all and blow past its slot limit.
 *
 * This resolver decides all contests together. It is modelled on Fantasy Critic's
 * ActionProcessor: each pass awards at most one movie per team -- the highest
 * priority bid it can still win -- then re-checks remaining capacity and repeats.
 * A team that is out of slots stops being a contender, so its movies fall through
 * to the runner-up rather than going unawarded.
 *
 * Kept free of Supabase calls so the ordering rules can be tested directly.
 */

export interface ResolvableCounterpickBid {
  id: string
  team_id: string
  amount: number
  /** Team-chosen rank among its own pending bids; 1 is the one it wants most. */
  priority: number
  created_at: string
}

export interface CounterpickContest {
  /** Opaque identifier for the movie being contested, e.g. `${league_id}:${movie_id}`. */
  key: string
  /** Every bid with status 'active' on this movie. */
  activeBids: ResolvableCounterpickBid[]
}

/**
 * Why a bid did not win.
 * - `outbid`: a stronger bid took the movie.
 * - `no_slots`: the bid led its contest but the team's slots were already full.
 */
export type CounterpickLossReason = 'outbid' | 'no_slots'

export interface CounterpickResolution {
  /** Contest key -> winning bid. Keys absent here went unawarded. */
  winners: Map<string, ResolvableCounterpickBid>
  /** Bid id -> why it lost. Contains every active bid that is not a winner. */
  lossReasons: Map<string, CounterpickLossReason>
}

/**
 * Order two bids strongest-first: highest amount, then earliest placed. Bid id
 * breaks the remaining tie only so repeated runs agree with each other.
 */
export function compareBidStrength(
  a: ResolvableCounterpickBid,
  b: ResolvableCounterpickBid,
): number {
  if (b.amount !== a.amount) return b.amount - a.amount

  const placedDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  if (placedDiff !== 0) return placedDiff

  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

/**
 * Renumber each team's bids to a dense 1..N ranking.
 *
 * Stored priorities drift: cancelling a bid leaves a gap, and nothing stops two
 * bids sharing a number. Rather than defend that with database constraints --
 * which would make reordering need a transaction just to avoid transient
 * collisions -- resolution normalizes first, exactly as Fantasy Critic does.
 * Bid strength breaks ties so a duplicated priority resolves predictably.
 *
 * @returns bid id -> normalized priority
 */
export function normalizeBidPriorities(contests: CounterpickContest[]): Map<string, number> {
  const bidsByTeam = new Map<string, ResolvableCounterpickBid[]>()
  for (const contest of contests) {
    for (const bid of contest.activeBids) {
      const existing = bidsByTeam.get(bid.team_id)
      if (existing) existing.push(bid)
      else bidsByTeam.set(bid.team_id, [bid])
    }
  }

  const normalized = new Map<string, number>()
  for (const bids of bidsByTeam.values()) {
    bids.sort((a, b) => a.priority - b.priority || compareBidStrength(a, b))
    bids.forEach((bid, index) => normalized.set(bid.id, index + 1))
  }
  return normalized
}

/** The bid a team would take a contest with, if a slot is free for it. */
interface Contender {
  key: string
  bid: ResolvableCounterpickBid
}

/**
 * Pick a winner for every contest without letting any team exceed its slots.
 *
 * @param contests Movies with at least one active bid and no open counter window.
 * @param remainingSlotsByTeam Slots each team can still fill. Teams absent from
 *   the map are treated as having none.
 */
export function resolveCounterpickWinners(
  contests: CounterpickContest[],
  remainingSlotsByTeam: ReadonlyMap<string, number>,
): CounterpickResolution {
  const normalizedPriorities = normalizeBidPriorities(contests)
  const priorityOf = (bid: ResolvableCounterpickBid) =>
    normalizedPriorities.get(bid.id) ?? bid.priority

  const remainingSlots = new Map(remainingSlotsByTeam)
  const winners = new Map<string, ResolvableCounterpickBid>()

  // Strongest bid first, so the leading contender for a contest is just the first
  // entry whose team still has room.
  const rankedBids = new Map(
    contests.map((contest) => [contest.key, contest.activeBids.slice().sort(compareBidStrength)]),
  )
  const unresolvedKeys = new Set(contests.map((contest) => contest.key))

  /**
   * Whether `candidate` should displace `incumbent` as its team's one advance
   * this pass: lower priority first, and on the degenerate case of one team
   * leading two contests at the same normalized priority, the stronger bid.
   */
  const outranks = (candidate: Contender, incumbent: Contender) => {
    const priorityDiff = priorityOf(candidate.bid) - priorityOf(incumbent.bid)
    if (priorityDiff !== 0) return priorityDiff < 0
    return compareBidStrength(candidate.bid, incumbent.bid) < 0
  }

  while (unresolvedKeys.size > 0) {
    // Each team advances only its highest-priority contender this pass. That is
    // what makes slots fill in the order the team chose instead of the order the
    // contests happen to be iterated in.
    const contenderByTeam = new Map<string, Contender>()
    for (const key of unresolvedKeys) {
      const bid = rankedBids.get(key)!.find((b) => (remainingSlots.get(b.team_id) ?? 0) > 0)
      if (!bid) continue

      const incumbent = contenderByTeam.get(bid.team_id)
      if (!incumbent || outranks({ key, bid }, incumbent)) {
        contenderByTeam.set(bid.team_id, { key, bid })
      }
    }
    if (contenderByTeam.size === 0) break

    for (const { key, bid } of contenderByTeam.values()) {
      winners.set(key, bid)
      unresolvedKeys.delete(key)
      remainingSlots.set(bid.team_id, (remainingSlots.get(bid.team_id) ?? 0) - 1)
    }
  }

  const lossReasons = new Map<string, CounterpickLossReason>()
  for (const contest of contests) {
    const winner = winners.get(contest.key)
    for (const bid of contest.activeBids) {
      if (winner && bid.id === winner.id) continue
      // Beating the winner (or winning a contest nobody took) means strength was
      // never the problem -- the team simply had no slot left for this one.
      const wouldHaveWon = !winner || compareBidStrength(bid, winner) < 0
      lossReasons.set(bid.id, wouldHaveWon ? 'no_slots' : 'outbid')
    }
  }

  return { winners, lossReasons }
}
