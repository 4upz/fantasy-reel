import { assertEquals, assert } from '@std/assert'
import { createClient } from '@supabase/supabase-js'

// Use the real query builder against a deterministic HTTP boundary. This tests
// the processor's error handling without breaking a live database connection.
Deno.test('bid processing holds unread leagues and resolves eligible runners-up', async (t) => {
  const originalServe = Deno.serve
  Deno.serve = (() => {}) as unknown as typeof Deno.serve
  const { getTeamCapacities, processCounterpickBids, reconcileAwardedPickupContests } = await import('../process-bids/index.ts')
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
    const failures = { lossReason: '' }
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
          const field = column.split('.').reduce<unknown>((value, key) => (value as Row | undefined)?.[key], row)
          if (value.startsWith('eq.')) return String(field) === value.slice(3)
          if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[column]))
          return true
        }))
        if (method === 'PATCH') {
          const update = JSON.parse(String(options?.body))
          if (update.resolution_reason === failures.lossReason) {
            return Promise.resolve(Response.json({ message: 'write failed', code: '08006' }, { status: 500 }))
          }
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
    return { client, tables, requests, failures }
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

  await t.step('reports committed losses even when another reason group fails, without repeating them on retry', async () => {
    const bids = [bid('leader', 'movie-one', 'team-a', 10), bid('runner', 'movie-one', 'team-b', 5, 'outbid')]
    const f = fixture(bids)
    f.tables.counterpicks.push({ counterpicker_team_id: 'team-a', phase: 'bidding', league_id: 'league' })
    f.tables.team_budgets[1].remaining_budget = 0
    f.tables.teams.push({ id: 'team-a', league_participants: { user_id: '11111111-1111-4111-8111-111111111111' } })
    f.failures.lossReason = 'insufficient_budget'
    const first = await process(f, bids)
    assertEquals(first.errors.length, 1)
    assertEquals(bids.map(b => b.status), ['lost', 'outbid'])
    assertEquals(first.ledger.get('league:movie-one')?.bids.map((b: { team_id: string }) => b.team_id), ['team-a'])
    assertEquals(f.tables.notifications.map(n => (n.data as { bid_id: string }).bid_id), ['leader'])

    f.failures.lossReason = ''
    const retry = await process(f, [bids[1]])
    assertEquals(retry.errors, [])
    assertEquals(retry.ledger.get('league:movie-one')?.bids.map((b: { team_id: string }) => b.team_id), ['team-b'])
    assertEquals(f.tables.notifications.length, 1, 'the earlier settled loss is not notified again')
    assertEquals(bids.map(b => b.status), ['lost', 'lost'])
  })

  await t.step('a counterpick retry settles residual offers without another award or budget charge', async () => {
    const bids = [bid('leader', 'movie-one', 'team-a', 10), bid('runner', 'movie-one', 'team-b', 5, 'outbid')]
    const f = fixture(bids)
    f.failures.lossReason = 'outbid'
    assertEquals((await process(f, bids)).errors.length, 1)
    assertEquals(bids.map(b => b.status), ['won', 'outbid'])
    f.failures.lossReason = ''
    const retry = await process(f, [bids[1]])
    assertEquals(retry.results, [])
    assertEquals(retry.errors, [])
    assertEquals(f.tables.counterpicks.length, 1)
    assertEquals(f.tables.team_budgets.map(b => b.remaining_budget), [90, 100])
    assertEquals(bids.map(b => b.status), ['won', 'lost'])
  })

  await t.step('a retry does not invent an outbid reason for a stronger offer skipped by a fallback award', async () => {
    const bids = [bid('leader', 'movie-one', 'team-a', 10), bid('runner', 'movie-one', 'team-b', 5, 'outbid')]
    const f = fixture(bids)
    f.tables.counterpicks.push({ counterpicker_team_id: 'team-a', phase: 'bidding', league_id: 'league' })
    f.failures.lossReason = 'no_slots'
    assertEquals((await process(f, bids)).errors.length, 1)
    assertEquals(bids.map(b => b.status), ['active', 'won'])
    f.failures.lossReason = ''
    const retry = await process(f, [bids[0]])
    assertEquals(retry.errors.length, 1)
    assertEquals(retry.results, [])
    assertEquals(retry.ledger.size, 0)
    assertEquals(bids[0].status, 'active')
  })

  for (const state of ['awarded', 'stronger-offer', 'uncertain-status', 'dropped-old-offer', 'dropped-new-offer', 'unread'] as const) {
    await t.step(`pickup retry reconciliation: ${state}`, async () => {
      const pending = { ...bid('runner', 'movie-one', 'team-b', state === 'stronger-offer' ? 20 : 5, 'outbid'), tmdb_id: 123,
        movie_data: null, conditional_drop_draft_pick_id: null, conditional_drop_pickup_id: null,
        created_at: state === 'dropped-new-offer' ? '2026-01-05T00:00:00Z' : '2026-01-01T00:00:00Z' }
      const f = fixture([pending], state === 'unread' ? 'pickups' : undefined)
      f.tables.pickup_bids = [{ ...bid('winner', 'movie-one', 'team-a', 10), status: state === 'uncertain-status' ? 'active' : 'won' }, pending]
      f.tables.pickups = [{ league_id: 'league', bid_id: 'winner', amount_paid: 10, picked_up_at: '2026-01-02T00:00:00Z',
        dropped_at: state.startsWith('dropped') ? '2026-01-04T00:00:00Z' : null,
        movies: { id: 'movie-one', tmdb_id: 123, title: 'Movie one' } }]
      const errors: Array<{ movie_key: string; error: string }> = []
      const ledger = new Map()
      const contests = [{ key: 'league:123', activeBids: [pending] }]
      const surviving = await reconcileAwardedPickupContests(f.client, contests,
        new Map([['league:123', [pending]]]) as Parameters<typeof reconcileAwardedPickupContests>[2], ledger, errors)
      assertEquals(surviving, state === 'dropped-new-offer' ? contests : [])
      assertEquals(pending.status, state === 'awarded' ? 'lost' : 'outbid')
      assertEquals(errors.length, ['stronger-offer', 'uncertain-status', 'dropped-old-offer', 'unread'].includes(state) ? 1 : 0)
      assertEquals(ledger.size, state === 'awarded' ? 1 : 0)
      assertEquals(f.tables.team_budgets[0].remaining_budget, 100)
      assertEquals(f.requests.filter(r => r.method !== 'GET' && r.table !== 'pickup_bids'), [])
    })
  }

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
