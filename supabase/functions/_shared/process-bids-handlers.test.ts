import { assertEquals, assert } from '@std/assert'
import { createClient } from '@supabase/supabase-js'

// Use the real query builder against a deterministic HTTP boundary. This tests
// the processor's error handling without breaking a live database connection.
Deno.test('bid processing holds unread leagues and resolves eligible runners-up', async (t) => {
  const originalServe = Deno.serve
  Deno.serve = (() => {}) as unknown as typeof Deno.serve
  const { getTeamCapacities, processCounterpickBids } = await import('../process-bids/index.ts')
    .finally(() => { Deno.serve = originalServe })

  type Row = Record<string, unknown>
  const bid = (id: string, movie_id: string, team_id: string, amount: number, status = 'active') => ({
    id, movie_id, team_id, amount, status, league_id: 'league', target_team_id: 'holder',
    draft_pick_id: `holding-${movie_id}`, pickup_id: null, priority: 1,
    created_at: '2026-01-01T00:00:00Z', processing_deadline: '2026-01-02T00:00:00Z',
    countered_at: null, response_deadline: null,
  })
  type TestBid = ReturnType<typeof bid>
  function fixture(bids: TestBid[], failTable?: string, missingBudget = false) {
    const requests: { table: string; method: string }[] = []
    const tables: Record<string, Row[]> = {
      leagues: [{ id: 'league', status: 'active', season_year: 2026, total_slots: 2,
        bidding_counterpick_slots: 1, drop_limit: 1, counterpicks_block_drops: true }],
      counterpick_bids: bids,
      movies: [...new Set(bids.map(b => b.movie_id))].map(id => ({ id, title: id, release_date: '2999-01-01', fantasy_points: null })),
      draft_picks: [...new Set(bids.map(b => b.draft_pick_id))].map(id => ({ id, team_id: 'holder', dropped_at: null })),
      pickups: [], counterpicks: [], team_drops: [], team_holdings: [], teams: [],
      team_budgets: missingBudget ? [] : [...new Set(bids.map(b => b.team_id))].map(team_id => ({ team_id, remaining_budget: 100, total_spent: 0 })),
    }
    const client = createClient('http://bid-processing.invalid', 'test-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        const table = url.pathname.split('/').at(-1)!
        const options = init as { method?: string; body?: unknown; headers?: HeadersInit } | undefined
        const method = options?.method ?? 'GET'
        requests.push({ table, method })
        if (table === failTable && method === 'GET') {
          return Promise.resolve(Response.json({ message: 'read failed', code: '08006' }, { status: 500 }))
        }
        const source = tables[table] ?? []
        const rows = source.filter(row => [...url.searchParams].every(([column, value]) => {
          if (value.startsWith('eq.')) return String(row[column]) === value.slice(3)
          if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[column]))
          return true
        }))
        if (method === 'PATCH') {
          const update = JSON.parse(String(options?.body))
          rows.forEach(row => Object.assign(row, update))
        } else if (method === 'POST') {
          const value = JSON.parse(String(options?.body))
          ;(tables[table] ??= []).push(value)
        }
        const accept = new Headers(options?.headers).get('accept')
        const body = accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows
        return Promise.resolve(method === 'HEAD'
          ? new Response(null, { headers: { 'content-range': `0-0/${rows.length}` } })
          : Response.json(body))
      } },
    })
    return { client, tables, requests }
  }
  async function process(f: ReturnType<typeof fixture>, bids: TestBid[]) {
    const errors: Array<{ movie_key: string; error: string }> = []
    const ledger = new Map()
    const results = await processCounterpickBids(f.client,
      bids as Parameters<typeof processCounterpickBids>[1], new Date('2026-09-28T00:00:00Z'), errors, [], [], ledger)
    return { errors, results, ledger }
  }

  for (const failedRead of ['counterpicks', 'team_budgets', 'movies', 'draft_picks']) {
    await t.step(`a failed ${failedRead} read holds every counterpick contest in the league`, async () => {
      const bids = [bid('one', 'movie-one', 'team-a', 10), bid('two', 'movie-two', 'team-b', 5)]
      const f = fixture(bids, failedRead)
      const { errors, results, ledger } = await process(f, bids)
      assertEquals(errors.length, 1)
      assertEquals(errors[0].movie_key, 'league')
      assertEquals(results, [])
      assertEquals(ledger.size, 0)
      assertEquals(bids.map(b => b.status), ['active', 'active'])
      assertEquals(f.requests.filter(r => r.method !== 'GET' && r.method !== 'HEAD'), [])
    })
  }

  await t.step('missing budget rows also hold the league', async () => {
    const bids = [bid('one', 'movie-one', 'team-a', 10)]
    const f = fixture(bids, undefined, true)
    assertEquals((await process(f, bids)).errors.length, 1)
    assertEquals(bids[0].status, 'active')
  })

  await t.step('an outbid runner-up wins when the higher bidder has no slots', async () => {
    const bids = [bid('leader', 'movie-one', 'team-a', 10), bid('runner', 'movie-one', 'team-b', 5, 'outbid')]
    const f = fixture(bids)
    f.tables.counterpicks.push({ counterpicker_team_id: 'team-a', phase: 'bidding', league_id: 'league' })
    const { errors, results } = await process(f, bids)
    assertEquals(errors, [])
    assertEquals(results[0].winner_team_id, 'team-b')
    assertEquals(f.requests.filter(r => r.table === 'movies').length, 1, 'movie facts are read once before capacity resolution')
    assertEquals(f.tables.counterpick_bids.map(b => [b.status, b.resolution_reason]), [['lost', 'no_slots'], ['won', null]])
    assertEquals(f.tables.team_budgets.map(b => b.remaining_budget), [100, 95])
  })

  await t.step('a runner-up with no budget loses for budget, never incorrectly for slots', async () => {
    const bids = [bid('leader', 'movie-one', 'team-a', 10), bid('runner', 'movie-one', 'team-b', 5, 'outbid')]
    const f = fixture(bids)
    f.tables.counterpicks.push({ counterpicker_team_id: 'team-a', phase: 'bidding', league_id: 'league' })
    f.tables.team_budgets[1].remaining_budget = 0
    const { errors, results } = await process(f, bids)
    assertEquals(errors, [])
    assertEquals(results, [])
    assertEquals(f.tables.counterpick_bids.map(b => [b.status, b.resolution_reason]), [['lost', 'no_slots'], ['lost', 'insufficient_budget']])
  })

  await t.step('pickup capacity counts and classifies a single holdings snapshot', async () => {
    const f = fixture([bid('bid', 'movie', 'team-a', 5)])
    f.tables.team_holdings.push({ holding_id: 'holding', team_id: 'team-a', movie_id: 'movie', release_date: '2999-01-01', counterpicked_by_team_id: null })
    f.tables.counterpick_bids = []
    const { capacities, unreadableLeagues } = await getTeamCapacities(f.client,
      [{ key: 'league:movie', activeBids: [bid('bid', 'movie', 'team-a', 5)] }], 'pickup')
    assertEquals(unreadableLeagues.size, 0)
    assertEquals(capacities.get('team-a')?.freeSlots, 1)
    assert(capacities.get('team-a')?.droppableHoldingIds.has('holding'))
    assertEquals(f.requests.filter(r => r.table === 'team_holdings').length, 1)
  })

  await t.step('an unread counterpick block list holds pickup bidders instead of allowing a drop', async () => {
    const f = fixture([bid('bid', 'movie', 'team-a', 5)], 'counterpick_bids')
    f.tables.team_holdings.push({ holding_id: 'holding', team_id: 'team-a', movie_id: 'movie', release_date: '2999-01-01', counterpicked_by_team_id: null })
    const { unreadableLeagues } = await getTeamCapacities(f.client,
      [{ key: 'league:movie', activeBids: [bid('bid', 'movie', 'team-a', 5)] }], 'pickup')
    assertEquals([...unreadableLeagues], ['league'])
  })
})
