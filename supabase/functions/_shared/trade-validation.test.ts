/**
 * Unit tests for trade-validation Discord mention helpers.
 *
 * Run with: deno task test:unit
 */

import { assertEquals } from '@std/assert'
import {
  buildTradeMentions,
  getTradeMentionContent,
  tradeItemLabel,
  validateCounterpickPlacement,
  validateCounterpickSlots,
  validateMovieOwnership,
} from './trade-validation.ts'
import type { LeagueTradeConfig, TradeItems, TradeItemSource, TradeMovieItem } from './trade-validation.ts'

// ============================================================================
// buildTradeMentions (pure)
// ============================================================================

Deno.test('buildTradeMentions - mentions both parties when both are linked', () => {
  const content = buildTradeMentions(['111', '222'])
  assertEquals(content, '<@111> <@222>')
})

Deno.test('buildTradeMentions - mentions only the linked party', () => {
  assertEquals(buildTradeMentions(['111', null]), '<@111>')
  assertEquals(buildTradeMentions([undefined, '222']), '<@222>')
})

Deno.test('buildTradeMentions - clean fallback when neither party is linked', () => {
  assertEquals(buildTradeMentions([null, undefined]), undefined)
  assertEquals(buildTradeMentions([]), undefined)
})

// ============================================================================
// getTradeMentionContent (RPC wrapper)
// ============================================================================

function mockClient(rpcResult: { data: unknown; error: { message: string } | null }) {
  return {
    // deno-lint-ignore no-explicit-any
    rpc: (_fn: string, _params: unknown) => Promise.resolve(rpcResult),
    // deno-lint-ignore no-explicit-any
  } as any
}

Deno.test('getTradeMentionContent - builds mentions from resolved discord_ids', async () => {
  const client = mockClient({
    data: [
      { user_id: 'user-a', discord_id: '111' },
      { user_id: 'user-b', discord_id: null },
    ],
    error: null,
  })

  const content = await getTradeMentionContent(client, ['user-a', 'user-b'])
  assertEquals(content, '<@111>')
})

Deno.test('getTradeMentionContent - returns undefined when nobody is linked', async () => {
  const client = mockClient({ data: [], error: null })
  const content = await getTradeMentionContent(client, ['user-a', 'user-b'])
  assertEquals(content, undefined)
})

Deno.test('getTradeMentionContent - returns undefined for an empty user list without calling rpc', async () => {
  const content = await getTradeMentionContent(mockClient({ data: null, error: null }), [])
  assertEquals(content, undefined)
})

Deno.test('getTradeMentionContent - fails closed (no mentions) on RPC error', async () => {
  const client = mockClient({ data: null, error: { message: 'boom' } })
  const content = await getTradeMentionContent(client, ['user-a'])
  assertEquals(content, undefined)
})

// ============================================================================
// Counterpick trade items
//
// A counterpick is a tradeable asset (20260822120000_allow_trading_counterpicks):
// the tests below cover who may give one up, and the invariant that no team may
// finish a trade holding both a movie and the bet against it.
// ============================================================================

type Row = Record<string, unknown>

/**
 * Tiny in-memory stand-in for the query shapes these validators use:
 * `.select().eq().single()` and the awaitable `.select().in()`.
 */
function mockDb(tables: Record<string, Row[]>) {
  const query = (initial: Row[]) => {
    let rows = initial
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: (col: string, value: unknown) => {
        rows = rows.filter((row) => row[col] === value)
        return api
      },
      in: (col: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[col]))
        return api
      },
      single: () =>
        Promise.resolve(
          rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { message: 'not found' } }
        ),
      // deno-lint-ignore no-explicit-any
      then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
    }
    return api
  }

  // deno-lint-ignore no-explicit-any
  return { from: (table: string) => query([...(tables[table] ?? [])]) } as any
}

const item = (source: TradeItemSource, sourceId: string): TradeMovieItem => ({
  movie_id: `movie-for-${sourceId}`,
  source,
  source_id: sourceId,
})

const items = (...movies: TradeMovieItem[]): TradeItems => ({ movies, faab: 0 })
const NO_ITEMS: TradeItems = { movies: [], faab: 0 }

Deno.test('tradeItemLabel - distinguishes a counterpick from the movie it targets', () => {
  assertEquals(tradeItemLabel({ ...item('draft_pick', 'p1'), title: 'Dune' }), 'Dune')
  assertEquals(tradeItemLabel({ ...item('counterpick', 'c1'), title: 'Dune' }), 'Counterpick: Dune')
})

Deno.test('validateMovieOwnership - a team may give up a counterpick it owns', async () => {
  const db = mockDb({
    counterpicks: [{ id: 'cp-1', counterpicker_team_id: 'team-a' }],
  })

  assertEquals(await validateMovieOwnership(db, 'team-a', items(item('counterpick', 'cp-1'))), {
    valid: true,
  })
})

Deno.test('validateMovieOwnership - rejects a counterpick owned by another team', async () => {
  const db = mockDb({
    counterpicks: [{ id: 'cp-1', counterpicker_team_id: 'team-b' }],
  })

  assertEquals(await validateMovieOwnership(db, 'team-a', items(item('counterpick', 'cp-1'))), {
    valid: false,
    error: 'Counterpick not owned by team: cp-1',
  })
})

Deno.test('validateMovieOwnership - rejects a dropped draft pick', async () => {
  const db = mockDb({
    draft_picks: [{ id: 'pick-1', team_id: 'team-a', dropped_at: '2026-01-01T00:00:00Z' }],
  })

  assertEquals(await validateMovieOwnership(db, 'team-a', items(item('draft_pick', 'pick-1'))), {
    valid: false,
    error: 'Draft pick has been dropped: pick-1',
  })
})

Deno.test('validateCounterpickPlacement - rejects sending a movie to the team that counterpicked it', async () => {
  const db = mockDb({
    counterpicks: [
      {
        id: 'cp-1',
        counterpicker_team_id: 'team-b',
        target_team_id: 'team-a',
        draft_pick_id: 'pick-1',
        pickup_id: null,
        phase: 'draft',
      },
    ],
  })

  assertEquals(
    await validateCounterpickPlacement(
      db,
      'team-a',
      'team-b',
      items(item('draft_pick', 'pick-1')),
      NO_ITEMS
    ),
    {
      valid: false,
      error: 'Cannot trade a counterpicked movie to the team that counterpicked it: pick-1',
    }
  )
})

Deno.test('validateCounterpickPlacement - allows a movie counterpicked by an uninvolved third team', async () => {
  const db = mockDb({
    counterpicks: [
      {
        id: 'cp-1',
        counterpicker_team_id: 'team-c',
        target_team_id: 'team-a',
        draft_pick_id: 'pick-1',
        pickup_id: null,
        phase: 'draft',
      },
    ],
  })

  assertEquals(
    await validateCounterpickPlacement(
      db,
      'team-a',
      'team-b',
      items(item('draft_pick', 'pick-1')),
      NO_ITEMS
    ),
    { valid: true }
  )
})

Deno.test('validateCounterpickPlacement - rejects sending a counterpick to the team holding the movie', async () => {
  const db = mockDb({
    counterpicks: [
      {
        id: 'cp-1',
        counterpicker_team_id: 'team-a',
        target_team_id: 'team-b',
        draft_pick_id: 'pick-1',
        pickup_id: null,
        phase: 'draft',
      },
    ],
  })

  assertEquals(
    await validateCounterpickPlacement(
      db,
      'team-a',
      'team-b',
      items(item('counterpick', 'cp-1')),
      NO_ITEMS
    ),
    {
      valid: false,
      error: 'Cannot trade a counterpick to the team that holds the counterpicked movie: cp-1',
    }
  )
})

Deno.test('validateCounterpickPlacement - allows swapping a movie one way and its counterpick the other', async () => {
  // team-a holds the movie, team-b holds the bet against it. After the swap
  // they have exchanged roles, which is legal -- neither ends up on both sides.
  const db = mockDb({
    counterpicks: [
      {
        id: 'cp-1',
        counterpicker_team_id: 'team-b',
        target_team_id: 'team-a',
        draft_pick_id: 'pick-1',
        pickup_id: null,
        phase: 'draft',
      },
    ],
  })

  assertEquals(
    await validateCounterpickPlacement(
      db,
      'team-a',
      'team-b',
      items(item('draft_pick', 'pick-1')),
      items(item('counterpick', 'cp-1'))
    ),
    { valid: true }
  )
})

const config = (overrides: Partial<LeagueTradeConfig> = {}): LeagueTradeConfig => ({
  trades_enabled: true,
  trade_deadline: null,
  trade_veto_hours: 24,
  trade_review_enabled: false,
  total_slots: 5,
  faab_budget: 100,
  draft_counterpick_slots: 1,
  bidding_counterpick_slots: 0,
  ...overrides,
})

Deno.test('validateCounterpickSlots - rejects a trade that puts a team over its phase limit', async () => {
  const db = mockDb({
    counterpicks: [
      { id: 'cp-1', counterpicker_team_id: 'team-a', phase: 'draft' },
      { id: 'cp-2', counterpicker_team_id: 'team-b', phase: 'draft' },
    ],
  })

  assertEquals(
    await validateCounterpickSlots(
      db,
      'team-a',
      'team-b',
      NO_ITEMS,
      items(item('counterpick', 'cp-2')),
      config({ draft_counterpick_slots: 1 })
    ),
    { valid: false, error: "Trade would exceed initiator's draft counterpick limit (2/1)" }
  )
})

Deno.test('validateCounterpickSlots - allows a one-for-one counterpick swap at the limit', async () => {
  const db = mockDb({
    counterpicks: [
      { id: 'cp-1', counterpicker_team_id: 'team-a', phase: 'draft' },
      { id: 'cp-2', counterpicker_team_id: 'team-b', phase: 'draft' },
    ],
  })

  assertEquals(
    await validateCounterpickSlots(
      db,
      'team-a',
      'team-b',
      items(item('counterpick', 'cp-1')),
      items(item('counterpick', 'cp-2')),
      config({ draft_counterpick_slots: 1 })
    ),
    { valid: true }
  )
})

Deno.test('validateCounterpickSlots - counts phases separately', async () => {
  // The bidding slot is free even though the draft slot is full.
  const db = mockDb({
    counterpicks: [
      { id: 'cp-1', counterpicker_team_id: 'team-a', phase: 'draft' },
      { id: 'cp-2', counterpicker_team_id: 'team-b', phase: 'bidding' },
    ],
  })

  assertEquals(
    await validateCounterpickSlots(
      db,
      'team-a',
      'team-b',
      NO_ITEMS,
      items(item('counterpick', 'cp-2')),
      config({ draft_counterpick_slots: 1, bidding_counterpick_slots: 1 })
    ),
    { valid: true }
  )
})

