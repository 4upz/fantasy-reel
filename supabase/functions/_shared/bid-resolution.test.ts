import { assertEquals } from 'jsr:@std/assert@^1.0.0'
import {
  type BidContest,
  type CounterpickTargetRow,
  type DroppableCandidate,
  droppableHoldingIds,
  normalizeBidPriorities,
  type RetargetableCounterpickBid,
  resolveBidWinners,
  resolveTargetRevalidation,
  type ResolvableBid,
  slotsOnlyCapacity,
  type TeamCapacity,
} from './bid-resolution.ts'

let placedCounter = 0

/** Bids default to increasing created_at, so "placed earlier" follows call order. */
function bid(
  id: string,
  teamId: string,
  amount: number,
  priority: number,
  createdAt?: string,
): ResolvableBid {
  placedCounter += 1
  return {
    id,
    team_id: teamId,
    amount,
    priority,
    created_at: createdAt ?? `2026-01-01T00:00:${String(placedCounter).padStart(2, '0')}Z`,
    conditionalDropHoldingId: null,
  }
}

/** A bid carrying a conditional drop on `holdingId`. */
function dropBid(
  id: string,
  teamId: string,
  amount: number,
  priority: number,
  holdingId: string,
): ResolvableBid {
  return { ...bid(id, teamId, amount, priority), conditionalDropHoldingId: holdingId }
}

/**
 * A full TeamCapacity, so each test states only the dimension it exercises.
 * Defaults are deliberately non-binding except `remainingDrops`, which starts
 * at zero because most tests are about slots and budget.
 */
function cap(partial: Partial<TeamCapacity> = {}): TeamCapacity {
  return {
    freeSlots: partial.freeSlots ?? 99,
    remainingBudget: partial.remainingBudget ?? Number.MAX_SAFE_INTEGER,
    remainingDrops: partial.remainingDrops ?? 0,
    droppableHoldingIds: partial.droppableHoldingIds ?? new Set<string>(),
  }
}

function contest(key: string, ...activeBids: ResolvableBid[]): BidContest {
  return { key, activeBids }
}

function winnerIds(contests: BidContest[], slots: Record<string, number>) {
  const resolution = resolveBidWinners(contests, new Map(Object.entries(slots).map(([team, n]) => [team, slotsOnlyCapacity(n)])))
  return Object.fromEntries(
    contests.map((c) => [c.key, resolution.winners.get(c.key)?.id ?? null]),
  )
}

Deno.test('awards the strongest bid when slots are not binding', () => {
  const contests = [contest('X', bid('a1', 'A', 5, 1), bid('b1', 'B', 3, 1))]

  assertEquals(winnerIds(contests, { A: 2, B: 2 }), { X: 'a1' })
})

Deno.test('earliest bid wins a tie on amount', () => {
  const early = bid('early', 'A', 5, 1, '2026-01-01T00:00:00Z')
  const late = bid('late', 'B', 5, 1, '2026-01-02T00:00:00Z')
  const contests = [contest('X', late, early)]

  assertEquals(winnerIds(contests, { A: 1, B: 1 }), { X: 'early' })
})

Deno.test('caps a team at its remaining slots (issue #24)', () => {
  // Team A leads both contests but holds a single slot.
  const contests = [
    contest('X', bid('a-x', 'A', 6, 1)),
    contest('Y', bid('a-y', 'A', 5, 2)),
  ]

  const resolution = resolveBidWinners(contests, new Map([['A', slotsOnlyCapacity(1)]]))

  assertEquals(resolution.winners.size, 1)
  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.winners.has('Y'), false)
})

Deno.test('team priority, not bid size, decides which slot is kept', () => {
  // A bid $9 on Y but ranked X (a $4 bid) as priority 1. X is what it keeps.
  const contests = [
    contest('X', bid('a-x', 'A', 4, 1)),
    contest('Y', bid('a-y', 'A', 9, 2)),
  ]

  assertEquals(winnerIds(contests, { A: 1 }), { X: 'a-x', Y: null })
})

Deno.test('a movie a team cannot take falls through to the runner-up', () => {
  const contests = [
    contest('X', bid('a-x', 'A', 6, 1)),
    contest('Y', bid('a-y', 'A', 5, 2), bid('b-y', 'B', 3, 1)),
  ]

  assertEquals(winnerIds(contests, { A: 1, B: 1 }), { X: 'a-x', Y: 'b-y' })
})

Deno.test('fall-through cascades and still respects the runner-up slot limit', () => {
  // A can take one; B is runner-up on both of the rest but also holds one slot.
  const contests = [
    contest('X', bid('a-x', 'A', 9, 1)),
    contest('Y', bid('a-y', 'A', 8, 2), bid('b-y', 'B', 5, 1)),
    contest('Z', bid('a-z', 'A', 7, 3), bid('b-z', 'B', 4, 2)),
  ]

  assertEquals(winnerIds(contests, { A: 1, B: 1 }), { X: 'a-x', Y: 'b-y', Z: null })
})

Deno.test('a team with several slots fills them in priority order', () => {
  const contests = [
    contest('X', bid('a-x', 'A', 3, 3)),
    contest('Y', bid('a-y', 'A', 4, 1)),
    contest('Z', bid('a-z', 'A', 5, 2)),
  ]

  assertEquals(winnerIds(contests, { A: 2 }), { X: null, Y: 'a-y', Z: 'a-z' })
})

Deno.test('a team already at its limit wins nothing', () => {
  const contests = [contest('X', bid('a-x', 'A', 9, 1), bid('b-x', 'B', 1, 1))]

  assertEquals(winnerIds(contests, { A: 0, B: 1 }), { X: 'b-x' })
})

Deno.test('teams missing from the slot map are treated as having none', () => {
  const contests = [contest('X', bid('a-x', 'A', 9, 1))]

  assertEquals(winnerIds(contests, {}), { X: null })
})

Deno.test('distinguishes being outbid from running out of slots', () => {
  const contests = [
    contest('X', bid('a-x', 'A', 6, 1)),
    contest('Y', bid('a-y', 'A', 5, 2), bid('b-y', 'B', 3, 1)),
  ]

  const resolution = resolveBidWinners(contests, new Map([['A', slotsOnlyCapacity(1)], ['B', slotsOnlyCapacity(1)]]))

  // A led Y on strength and lost it only for want of a slot.
  assertEquals(resolution.lossReasons.get('a-y'), 'no_slots')
  // Nothing outbid the winner of Y itself.
  assertEquals(resolution.lossReasons.has('b-y'), false)
})

Deno.test('marks genuine outbids as outbid', () => {
  const contests = [contest('X', bid('a-x', 'A', 6, 1), bid('b-x', 'B', 2, 1))]

  const resolution = resolveBidWinners(contests, new Map([['A', slotsOnlyCapacity(1)], ['B', slotsOnlyCapacity(1)]]))

  assertEquals(resolution.lossReasons.get('b-x'), 'outbid')
})

Deno.test('when nobody has a slot every bid is reported as no_slots', () => {
  const contests = [contest('X', bid('a-x', 'A', 6, 1), bid('b-x', 'B', 2, 1))]

  const resolution = resolveBidWinners(contests, new Map([['A', slotsOnlyCapacity(0)], ['B', slotsOnlyCapacity(0)]]))

  assertEquals(resolution.winners.size, 0)
  assertEquals(resolution.lossReasons.get('a-x'), 'no_slots')
  assertEquals(resolution.lossReasons.get('b-x'), 'no_slots')
})

Deno.test('normalizes gaps left by cancelled bids', () => {
  const contests = [
    contest('X', bid('a-x', 'A', 3, 10)),
    contest('Y', bid('a-y', 'A', 4, 40)),
  ]

  const normalized = normalizeBidPriorities(contests)

  assertEquals(normalized.get('a-x'), 1)
  assertEquals(normalized.get('a-y'), 2)
})

Deno.test('breaks duplicate priorities by bid strength', () => {
  const weak = bid('weak', 'A', 2, 1)
  const strong = bid('strong', 'A', 8, 1)
  const contests = [contest('X', weak), contest('Y', strong)]

  const normalized = normalizeBidPriorities(contests)
  assertEquals(normalized.get('strong'), 1)
  assertEquals(normalized.get('weak'), 2)

  // ...and the stronger of the tied bids is the one that takes the only slot.
  assertEquals(winnerIds(contests, { A: 1 }), { X: null, Y: 'strong' })
})

Deno.test('normalizes each team independently', () => {
  const contests = [
    contest('X', bid('a-x', 'A', 5, 7), bid('b-x', 'B', 4, 2)),
    contest('Y', bid('a-y', 'A', 6, 9), bid('b-y', 'B', 3, 5)),
  ]

  const normalized = normalizeBidPriorities(contests)

  assertEquals(normalized.get('a-x'), 1)
  assertEquals(normalized.get('a-y'), 2)
  assertEquals(normalized.get('b-x'), 1)
  assertEquals(normalized.get('b-y'), 2)
})

Deno.test('resolves an empty slate without looping', () => {
  const resolution = resolveBidWinners([], new Map())

  assertEquals(resolution.winners.size, 0)
  assertEquals(resolution.lossReasons.size, 0)
})

// ---------------------------------------------------------------------------
// resolveTargetRevalidation (dropped / traded holdings)
// ---------------------------------------------------------------------------

function retargetableBid(
  teamId: string,
  targetTeamId: string,
): RetargetableCounterpickBid {
  return { id: 'bid-1', team_id: teamId, target_team_id: targetTeamId }
}

function targetRow(teamId: string, droppedAt: string | null = null): CounterpickTargetRow {
  return { team_id: teamId, dropped_at: droppedAt }
}

Deno.test('target revalidation: keeps a bid whose holding is unchanged', () => {
  const bid = retargetableBid('bidder', 'holder')
  const result = resolveTargetRevalidation(bid, targetRow('holder'), false)

  assertEquals(result, { outcome: 'keep', targetTeamId: 'holder' })
})

Deno.test('target revalidation: retargets a bid at the current holder after a trade', () => {
  // Placed against 'holder', but the row has since moved to 'new-holder'.
  const bid = retargetableBid('bidder', 'holder')
  const result = resolveTargetRevalidation(bid, targetRow('new-holder'), false)

  assertEquals(result, { outcome: 'keep', targetTeamId: 'new-holder' })
})

Deno.test('target revalidation: voids a bid whose target was dropped', () => {
  const bid = retargetableBid('bidder', 'holder')
  const result = resolveTargetRevalidation(bid, targetRow('holder', '2026-01-01T00:00:00Z'), false)

  assertEquals(result, { outcome: 'void', reason: 'movie_dropped' })
})

Deno.test('target revalidation: voids a bid the target movie was traded into the bidder\'s own team', () => {
  const bid = retargetableBid('bidder', 'holder')
  const result = resolveTargetRevalidation(bid, targetRow('bidder'), false)

  assertEquals(result, { outcome: 'void', reason: 'target_owned' })
})

Deno.test('target revalidation: voids a bid whose target row cannot be found', () => {
  const bid = retargetableBid('bidder', 'holder')
  const result = resolveTargetRevalidation(bid, undefined, false)

  assertEquals(result, { outcome: 'void', reason: 'target_missing' })
})

Deno.test('target revalidation: fails open and leaves the bid alone when the read itself failed', () => {
  const bid = retargetableBid('bidder', 'holder')
  const result = resolveTargetRevalidation(bid, undefined, true)

  assertEquals(result, { outcome: 'keep', targetTeamId: 'holder' })
})

Deno.test('target revalidation: a failed read wins even if a row was somehow also supplied', () => {
  // Should not happen in practice (a failed batch read yields no rows), but the
  // read-failure flag must take priority over any row so a caller can never
  // accidentally void a bid it could not actually verify.
  const bid = retargetableBid('bidder', 'holder')
  const result = resolveTargetRevalidation(bid, targetRow('someone-else', '2026-01-01T00:00:00Z'), true)

  assertEquals(result, { outcome: 'keep', targetTeamId: 'holder' })
})

Deno.test('target revalidation: dropped takes priority over self-owned when both are true', () => {
  // Dropping a movie does not change the row's team_id, so a row can be both
  // dropped and (coincidentally, e.g. after a trade) sitting with the bidder.
  const bid = retargetableBid('bidder', 'holder')
  const result = resolveTargetRevalidation(bid, targetRow('bidder', '2026-01-01T00:00:00Z'), false)

  assertEquals(result, { outcome: 'void', reason: 'movie_dropped' })
})

// ---------------------------------------------------------------------------
// Capacity-aware resolution: budget, conditional drops, drop allowance
// ---------------------------------------------------------------------------

Deno.test('budget exhaustion awards in priority order and falls through', () => {
  // Team A leads all three at $40 with $100 to spend: two fit, the third does not.
  const contests = [
    contest('X', bid('a-x', 'A', 40, 1)),
    contest('Y', bid('a-y', 'A', 40, 2)),
    contest('Z', bid('a-z', 'A', 40, 3), bid('b-z', 'B', 5, 1)),
  ]

  const resolution = resolveBidWinners(
    contests,
    new Map([['A', cap({ remainingBudget: 100 })], ['B', cap()]]),
  )

  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.winners.get('Y')?.id, 'a-y')
  // A cannot afford Z, so it falls through to the runner-up rather than going unawarded.
  assertEquals(resolution.winners.get('Z')?.id, 'b-z')
  assertEquals(resolution.lossReasons.get('a-z'), 'insufficient_budget')
})

Deno.test('a conditional drop wins a contest with no free slot', () => {
  const contests = [contest('X', dropBid('a-x', 'A', 5, 1, 'h1'))]

  const resolution = resolveBidWinners(
    contests,
    new Map([['A', cap({ freeSlots: 0, remainingDrops: 1, droppableHoldingIds: new Set(['h1']) })]]),
  )

  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.executedDrops.get('a-x'), 'h1')
})

Deno.test('two bids naming the same drop target: only the higher priority takes it', () => {
  const contests = [
    contest('X', dropBid('a-x', 'A', 5, 1, 'h1')),
    contest('Y', dropBid('a-y', 'A', 5, 2, 'h1'), bid('b-y', 'B', 1, 1)),
  ]

  const resolution = resolveBidWinners(
    contests,
    new Map([
      ['A', cap({ freeSlots: 0, remainingDrops: 2, droppableHoldingIds: new Set(['h1']) })],
      ['B', cap()],
    ]),
  )

  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.executedDrops.get('a-x'), 'h1')
  // h1 is spent, and A has no free slot, so Y falls to B.
  assertEquals(resolution.winners.get('Y')?.id, 'b-y')
  assertEquals(resolution.lossReasons.get('a-y'), 'no_slots')
})

Deno.test('conditional drops are capped by remaining drop allowance', () => {
  const contests = [
    contest('X', dropBid('a-x', 'A', 5, 1, 'h1')),
    contest('Y', dropBid('a-y', 'A', 5, 2, 'h2')),
  ]

  const resolution = resolveBidWinners(
    contests,
    new Map([['A', cap({
      freeSlots: 0,
      remainingDrops: 1,
      droppableHoldingIds: new Set(['h1', 'h2']),
    })]]),
  )

  assertEquals(resolution.winners.size, 1)
  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.lossReasons.get('a-y'), 'no_slots')
})

Deno.test('an invalid drop target degrades the bid to a plain bid', () => {
  // 'h-gone' is absent from droppableHoldingIds: the target became undroppable.
  const contests = [contest('X', dropBid('a-x', 'A', 5, 1, 'h-gone'))]

  const withSlot = resolveBidWinners(contests, new Map([['A', cap({ freeSlots: 1 })]]))
  assertEquals(withSlot.winners.get('X')?.id, 'a-x')
  // It won on a free slot, so no drop fires.
  assertEquals(withSlot.executedDrops.has('a-x'), false)

  const withoutSlot = resolveBidWinners(contests, new Map([['A', cap({ freeSlots: 0 })]]))
  assertEquals(withoutSlot.winners.size, 0)
  assertEquals(withoutSlot.lossReasons.get('a-x'), 'no_slots')
})

Deno.test('a free slot is preferred over spending a conditional drop', () => {
  // Burning drop allowance while a slot sits open would cost the team a drop it
  // did not need to spend.
  const contests = [contest('X', dropBid('a-x', 'A', 5, 1, 'h1'))]

  const resolution = resolveBidWinners(
    contests,
    new Map([['A', cap({ freeSlots: 1, remainingDrops: 1, droppableHoldingIds: new Set(['h1']) })]]),
  )

  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.executedDrops.has('a-x'), false)
})

Deno.test('a team absent from the capacity map wins nothing', () => {
  const contests = [contest('X', bid('a-x', 'A', 5, 1), bid('b-x', 'B', 1, 1))]

  const resolution = resolveBidWinners(contests, new Map([['B', cap()]]))

  // Fail-closed: an unreadable team is treated as having no capacity at all.
  assertEquals(resolution.winners.get('X')?.id, 'b-x')
})

Deno.test("the caller's capacity map is not mutated", () => {
  const contests = [contest('X', bid('a-x', 'A', 5, 1))]
  const capacity = cap({ freeSlots: 1, remainingBudget: 10 })
  const capacities = new Map([['A', capacity]])

  resolveBidWinners(contests, capacities)

  assertEquals(capacity.freeSlots, 1)
  assertEquals(capacity.remainingBudget, 10)
})

// ---------------------------------------------------------------------------
// Conditional drop eligibility
// ---------------------------------------------------------------------------

function candidate(
  holdingId: string,
  overrides: Partial<DroppableCandidate> = {},
): DroppableCandidate {
  return {
    holdingId,
    releaseDate: '2099-01-01',
    counterpickedByTeamId: null,
    hasPendingCounterpickBid: false,
    ...overrides,
  }
}

const TODAY = '2026-08-20'

Deno.test('an unreleased, uncontested holding is droppable', () => {
  const ids = droppableHoldingIds([candidate('h1')], {
    today: TODAY,
    counterpicksBlockDrops: true,
  })

  assertEquals([...ids], ['h1'])
})

Deno.test('a released holding is not droppable', () => {
  // drop-movie refuses release_date < today; a conditional drop must match.
  const ids = droppableHoldingIds([candidate('h1', { releaseDate: '2026-08-19' })], {
    today: TODAY,
    counterpicksBlockDrops: true,
  })

  assertEquals(ids.size, 0)
})

Deno.test('a holding released today is still droppable', () => {
  // The rule is strictly "before today", matching drop-movie's < comparison.
  const ids = droppableHoldingIds([candidate('h1', { releaseDate: TODAY })], {
    today: TODAY,
    counterpicksBlockDrops: true,
  })

  assertEquals([...ids], ['h1'])
})

Deno.test('a holding with no release date is droppable', () => {
  const ids = droppableHoldingIds([candidate('h1', { releaseDate: null })], {
    today: TODAY,
    counterpicksBlockDrops: true,
  })

  assertEquals([...ids], ['h1'])
})

Deno.test('counterpick state blocks a drop only when the league says so', () => {
  const candidates = [
    candidate('awarded', { counterpickedByTeamId: 'team-x' }),
    candidate('pending', { hasPendingCounterpickBid: true }),
  ]

  const blocked = droppableHoldingIds(candidates, {
    today: TODAY,
    counterpicksBlockDrops: true,
  })
  assertEquals(blocked.size, 0)

  const allowed = droppableHoldingIds(candidates, {
    today: TODAY,
    counterpicksBlockDrops: false,
  })
  assertEquals(allowed.size, 2)
})
