import { assertEquals } from '@std/assert'
import { fetchMdblistUsage, reserveApiCalls, utcDay, type BudgetClient } from './mdblist-budget.ts'

Deno.test('mdblist-budget', async (t) => {
  await t.step('utcDay formats YYYY-MM-DD in UTC', () => {
    assertEquals(utcDay(new Date('2026-08-26T23:59:00Z')), '2026-08-26')
    assertEquals(utcDay(new Date('2026-08-27T00:00:01Z')), '2026-08-27')
  })

  await t.step('fetchMdblistUsage parses the /user payload', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response(JSON.stringify({ api_requests: 1000, api_requests_count: 79 }), { status: 200 }))) as typeof fetch
    assertEquals(await fetchMdblistUsage('key', fetchImpl), { cap: 1000, used: 79 })
  })

  await t.step('fetchMdblistUsage returns null on non-2xx or malformed body', async () => {
    const bad = (() => Promise.resolve(new Response('nope', { status: 500 }))) as typeof fetch
    assertEquals(await fetchMdblistUsage('key', bad), null)
    const malformed = (() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))) as typeof fetch
    assertEquals(await fetchMdblistUsage('key', malformed), null)
  })

  await t.step('reserveApiCalls forwards to reserve_external_api_calls and returns the grant', async () => {
    const seen: Array<{ name: string; args: Record<string, unknown> }> = []
    const client: BudgetClient = { rpc: (name, args) => { seen.push({ name, args }); return Promise.resolve({ data: 4, error: null }) } }
    assertEquals(await reserveApiCalls(client, 'mdblist:projections', 10, 500), 4)
    assertEquals(seen[0], { name: 'reserve_external_api_calls', args: { p_api: 'mdblist:projections', p_requested: 10, p_daily_limit: 500 } })
  })

  await t.step('reserveApiCalls returns 0 on RPC error or non-positive request', async () => {
    const failing: BudgetClient = { rpc: () => Promise.resolve({ data: null, error: { message: 'x' } }) }
    assertEquals(await reserveApiCalls(failing, 'mdblist:projections', 10, 500), 0)
    let called = false
    const counting: BudgetClient = { rpc: () => { called = true; return Promise.resolve({ data: 1, error: null }) } }
    assertEquals(await reserveApiCalls(counting, 'mdblist:projections', 0, 500), 0)
    assertEquals(called, false)
  })
})
