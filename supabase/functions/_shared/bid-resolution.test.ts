import { assertEquals } from 'jsr:@std/assert@^1.0.0'
import {
  type CounterpickContest,
  type CounterpickTargetRow,
  normalizeBidPriorities,
  type RetargetableCounterpickBid,
  resolveCounterpickWinners,
  resolveTargetRevalidation,
  type ResolvableCounterpickBid,
} from './bid-resolution.ts'

let placedCounter = 0

/** Bids default to increasing created_at, so "placed earlier" follows call order. */
function bid(
  id: string,
  teamId: string,
  amount: number,
  priority: number,
  createdAt?: string,
): ResolvableCounterpickBid {
  placedCounter += 1
  return {
    id,
    team_id: teamId,
    amount,
    priority,
    created_at: createdAt ?? `2026-01-01T00:00:${String(placedCounter).padStart(2, '0')}Z`,
  }
}

function contest(key: string, ...activeBids: ResolvableCounterpickBid[]): CounterpickContest {
  return { key, activeBids }
}

function winnerIds(contests: CounterpickContest[], slots: Record<string, number>) {
  const resolution = resolveCounterpickWinners(contests, new Map(Object.entries(slots)))
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

  const resolution = resolveCounterpickWinners(contests, new Map([['A', 1]]))

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

  const resolution = resolveCounterpickWinners(contests, new Map([['A', 1], ['B', 1]]))

  // A led Y on strength and lost it only for want of a slot.
  assertEquals(resolution.lossReasons.get('a-y'), 'no_slots')
  // Nothing outbid the winner of Y itself.
  assertEquals(resolution.lossReasons.has('b-y'), false)
})

Deno.test('marks genuine outbids as outbid', () => {
  const contests = [contest('X', bid('a-x', 'A', 6, 1), bid('b-x', 'B', 2, 1))]

  const resolution = resolveCounterpickWinners(contests, new Map([['A', 1], ['B', 1]]))

  assertEquals(resolution.lossReasons.get('b-x'), 'outbid')
})

Deno.test('when nobody has a slot every bid is reported as no_slots', () => {
  const contests = [contest('X', bid('a-x', 'A', 6, 1), bid('b-x', 'B', 2, 1))]

  const resolution = resolveCounterpickWinners(contests, new Map([['A', 0], ['B', 0]]))

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
  const resolution = resolveCounterpickWinners([], new Map())

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
