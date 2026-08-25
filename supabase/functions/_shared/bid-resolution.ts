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

export interface ResolvableBid {
  id: string
  team_id: string
  amount: number
  /** Team-chosen rank among its own pending bids; 1 is the one it wants most. */
  priority: number
  created_at: string
  /**
   * Holding this bid releases if it wins, funding the award without a free
   * slot. Absent or null when the bid carries no conditional drop.
   *
   * Optional because conditional drops are a pickup-only feature: counterpick
   * rows are handed to the resolver as-is and simply never carry one, so making
   * it required would force a meaningless field onto every counterpick call
   * site.
   */
  conditionalDropHoldingId?: string | null
}

export interface BidContest {
  /** Opaque identifier for the movie being contested, e.g. `${league_id}:${movie_id}`. */
  key: string
  /** Every bid with status 'active' on this movie. */
  activeBids: ResolvableBid[]
}

/**
 * What a team can still absorb this run.
 *
 * `freeSlots` means "room for one more movie of this kind", and the two bid
 * types measure it against different pools: pooled roster room for pickups,
 * remaining `bidding_counterpick_slots` for counterpicks. They never collide,
 * because the two are resolved in separate calls with their own capacity map.
 */
export interface TeamCapacity {
  freeSlots: number
  remainingBudget: number
  remainingDrops: number
  /**
   * Holdings still available to be conditionally dropped. A target missing from
   * this set has become undroppable (released, traded away, counterpick-blocked)
   * or was already spent by a higher-priority bid from the same team.
   */
  droppableHoldingIds: ReadonlySet<string>
}

/** Capacity where slots are the only binding dimension -- counterpicks, and tests. */
export function slotsOnlyCapacity(freeSlots: number): TeamCapacity {
  return {
    freeSlots,
    remainingBudget: Number.MAX_SAFE_INTEGER,
    remainingDrops: 0,
    droppableHoldingIds: new Set<string>(),
  }
}

/**
 * Why a bid did not win.
 * - `outbid`: a stronger bid took the movie.
 * - `no_slots`: the bid led its contest but the team had no room -- no free
 *   slot, and no conditional drop it could still cash.
 * - `insufficient_budget`: the bid led its contest but the team's remaining
 *   budget was already committed to higher-priority bids.
 */
export type BidLossReason = 'outbid' | 'no_slots' | 'insufficient_budget'

export interface BidResolution {
  /** Contest key -> winning bid. Keys absent here went unawarded. */
  winners: Map<string, ResolvableBid>
  /** Bid id -> why it lost. Contains every active bid that is not a winner. */
  lossReasons: Map<string, BidLossReason>
  /**
   * Winning bid id -> holding it must drop. Only bids whose award was actually
   * funded by a conditional drop appear; one that won on a free slot does not,
   * because its drop must not fire.
   */
  executedDrops: Map<string, string>
}

/** Mutable working copy of a TeamCapacity, spent down as awards are made. */
interface WorkingCapacity {
  freeSlots: number
  remainingBudget: number
  remainingDrops: number
  droppableHoldingIds: Set<string>
}

/** The conditional drop this bid can actually cash right now, or null. */
function usableDrop(bid: ResolvableBid, capacity: WorkingCapacity): string | null {
  const holdingId = bid.conditionalDropHoldingId
  if (!holdingId) return null
  if (capacity.remainingDrops <= 0) return null
  return capacity.droppableHoldingIds.has(holdingId) ? holdingId : null
}

/**
 * Whether `capacity` can absorb `bid`. Budget always binds. Room comes either
 * from a free slot or from a conditional drop that is still cashable -- a
 * drop-funded award is slot-neutral, since the movie arriving and the movie
 * leaving cancel out.
 */
function canAfford(bid: ResolvableBid, capacity: WorkingCapacity | undefined): boolean {
  if (!capacity) return false
  if (capacity.remainingBudget < bid.amount) return false
  return capacity.freeSlots > 0 || usableDrop(bid, capacity) !== null
}

/**
 * Spend `bid` against `capacity`.
 *
 * A free slot is preferred over a conditional drop: the drop is the fallback
 * that buys room when there is none, and spending it while a slot sits open
 * would burn drop allowance the team did not need to spend.
 *
 * @returns the holding dropped to fund this award, or null if a slot funded it.
 */
function consume(bid: ResolvableBid, capacity: WorkingCapacity): string | null {
  capacity.remainingBudget -= bid.amount

  if (capacity.freeSlots > 0) {
    capacity.freeSlots -= 1
    return null
  }

  // canAfford already established this is non-null when no slot is free.
  const holdingId = usableDrop(bid, capacity)!
  capacity.remainingDrops -= 1
  // Retiring the holding is what stops a team's second bid from cashing the
  // same drop target twice.
  capacity.droppableHoldingIds.delete(holdingId)
  return holdingId
}

/**
 * Order two bids strongest-first: highest amount, then earliest placed. Bid id
 * breaks the remaining tie only so repeated runs agree with each other.
 */
export function compareBidStrength(
  a: ResolvableBid,
  b: ResolvableBid,
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
export function normalizeBidPriorities(contests: BidContest[]): Map<string, number> {
  const bidsByTeam = new Map<string, ResolvableBid[]>()
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

/** The bid a team would take a contest with, if it can still afford it. */
interface Contender {
  key: string
  bid: ResolvableBid
}

/**
 * Pick a winner for every contest without letting any team exceed its capacity.
 *
 * @param contests Movies with at least one active bid and no open counter window.
 * @param capacityByTeam What each team can still absorb. Teams absent from the
 *   map are treated as having none -- callers fail closed, so an unreadable
 *   team withholds awards for one run rather than being handed a fresh
 *   allowance on top of what it already holds.
 */
export function resolveBidWinners(
  contests: BidContest[],
  capacityByTeam: ReadonlyMap<string, TeamCapacity>,
): BidResolution {
  const normalizedPriorities = normalizeBidPriorities(contests)
  const priorityOf = (bid: ResolvableBid) =>
    normalizedPriorities.get(bid.id) ?? bid.priority

  // Working copies, so the caller's capacities are not mutated.
  const capacities = new Map<string, WorkingCapacity>(
    [...capacityByTeam].map(([teamId, c]) => [teamId, {
      freeSlots: c.freeSlots,
      remainingBudget: c.remainingBudget,
      remainingDrops: c.remainingDrops,
      droppableHoldingIds: new Set(c.droppableHoldingIds),
    }]),
  )

  const winners = new Map<string, ResolvableBid>()
  const executedDrops = new Map<string, string>()

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
      const bid = rankedBids.get(key)!.find((b) => canAfford(b, capacities.get(b.team_id)))
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
      const dropped = consume(bid, capacities.get(bid.team_id)!)
      if (dropped) executedDrops.set(bid.id, dropped)
    }
  }

  const lossReasons = new Map<string, BidLossReason>()
  for (const contest of contests) {
    const winner = winners.get(contest.key)
    for (const bid of contest.activeBids) {
      if (winner && bid.id === winner.id) continue

      // Beating the winner (or winning a contest nobody took) means strength was
      // never the problem -- some capacity dimension stopped this bid.
      const wouldHaveWon = !winner || compareBidStrength(bid, winner) < 0
      if (!wouldHaveWon) {
        lossReasons.set(bid.id, 'outbid')
        continue
      }

      // Say which constraint actually bound, so the bidder is told something
      // they can act on rather than a generic refusal.
      const capacity = capacities.get(bid.team_id)
      lossReasons.set(
        bid.id,
        capacity && capacity.remainingBudget < bid.amount ? 'insufficient_budget' : 'no_slots',
      )
    }
  }

  return { winners, lossReasons, executedDrops }
}

/**
 * ---------------------------------------------------------------------------
 * Conditional drop eligibility
 * ---------------------------------------------------------------------------
 *
 * A pickup bid may name a holding released only if the bid wins. Bids sit
 * pending for up to a week (see get_next_processing_deadline), so what was
 * droppable at bid time may not be at processing time -- the movie can get
 * counterpicked. These are the same rules drop-movie enforces; keeping them
 * here, pure, means the decision is testable and the two paths cannot silently
 * disagree about what "droppable" means.
 *
 * A movie opening in the meantime is deliberately *not* one of those changes: a
 * released movie is droppable, so a target that releases while the bid waits
 * still pays for it.
 *
 * A target failing these checks does not void the bid. It degrades to a bid
 * with no conditional drop, which can still win on a free slot -- the team
 * wanted the movie, and the drop was only the means of paying for it.
 */

export interface DroppableCandidate {
  holdingId: string
  counterpickedByTeamId: string | null
  hasPendingCounterpickBid: boolean
}

export function droppableHoldingIds(
  candidates: DroppableCandidate[],
  options: { counterpicksBlockDrops: boolean },
): Set<string> {
  const droppable = new Set<string>()

  for (const candidate of candidates) {
    if (options.counterpicksBlockDrops) {
      if (candidate.counterpickedByTeamId) continue
      // A pending counterpick auction would be stranded by the drop.
      if (candidate.hasPendingCounterpickBid) continue
    }

    droppable.add(candidate.holdingId)
  }

  return droppable
}

/**
 * ---------------------------------------------------------------------------
 * Target revalidation (dropped / traded holdings)
 * ---------------------------------------------------------------------------
 *
 * A counterpick bid targets a specific holding row -- a draft_picks or pickups
 * record, referenced by exactly one of `draft_pick_id` / `pickup_id` -- not
 * just a movie in the abstract. Bids can sit pending for up to a week (see
 * get_next_processing_deadline), and in that time the holder can drop the
 * movie (`dropped_at` gets set) or trade it away, which changes the row's
 * `team_id`. A trade can even hand the movie to the bidder itself, which would
 * violate `counterpicks`' `counterpicker_team_id != target_team_id` CHECK if
 * the bid were awarded as-is.
 *
 * This is the same staleness process-bids already guards against for a
 * released movie (see `voidReleasedBidContests`): what a bid was
 * placed against is not what processing must trust, so the holding row is
 * re-read at settlement time. Kept free of Supabase calls, like the rest of
 * this module, so the decision can be tested directly; the caller supplies the
 * holding row it read (or says the read failed).
 */

export interface RetargetableCounterpickBid {
  id: string
  team_id: string
  target_team_id: string
}

/** The current state of the row a counterpick bid targets (a draft_picks or pickups row). */
export interface CounterpickTargetRow {
  team_id: string
  dropped_at: string | null
}

/**
 * Why a bid's target was voided.
 * - `movie_dropped`: the holder dropped the movie while the bid was pending.
 * - `target_owned`: the movie was traded to the bidder's own team -- counterpicking
 *   yourself is never valid.
 * - `target_missing`: the holding row could not be found at all (not a read
 *   failure -- see `resolveTargetRevalidation`).
 */
export type TargetVoidReason = 'movie_dropped' | 'target_owned' | 'target_missing'

export type TargetRevalidation =
  | { outcome: 'keep'; targetTeamId: string }
  | { outcome: 'void'; reason: TargetVoidReason }

/**
 * Decide whether a bid's target holding is still valid and, if so, who
 * currently holds it -- which may differ from the bid's stored
 * `target_team_id` after a trade.
 *
 * `targetRow` is `undefined` in two situations that must be told apart via
 * `sourceReadFailed`:
 *  - the row genuinely no longer exists -- a real void condition
 *    (`target_missing`);
 *  - the read of it failed for infrastructure reasons, in which case the bid
 *    is left untouched (`keep`, at its previously stored target) rather than
 *    voided on the strength of a failed read. This mirrors the fail-open
 *    posture `voidReleasedBidContests` takes for a movie it could not
 *    read: an outage must not cost a bidder a live bid.
 *
 * Checked in the order the guardrail spec lists them: dropped, then
 * self-owned, then missing. A row can in principle be both dropped and now
 * self-owned (dropping does not change `team_id`); dropped wins, since "the
 * movie is gone" subsumes "and it happens to sit with you" as the more
 * fundamental reason the bid cannot be honored.
 */
export function resolveTargetRevalidation(
  bid: RetargetableCounterpickBid,
  targetRow: CounterpickTargetRow | undefined,
  sourceReadFailed: boolean,
): TargetRevalidation {
  if (sourceReadFailed) return { outcome: 'keep', targetTeamId: bid.target_team_id }
  if (!targetRow) return { outcome: 'void', reason: 'target_missing' }
  if (targetRow.dropped_at) return { outcome: 'void', reason: 'movie_dropped' }
  if (targetRow.team_id === bid.team_id) return { outcome: 'void', reason: 'target_owned' }
  return { outcome: 'keep', targetTeamId: targetRow.team_id }
}
