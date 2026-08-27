import { assertEquals, assert } from '@std/assert'
import { getServiceClient, getAuthenticatedClient } from './_setup.ts'

Deno.test('feature_flags + external_api_budgets', async (t) => {
  const service = getServiceClient()

  await t.step('reserve_external_api_calls exists and grants under a private key', async () => {
    const key = `test:${crypto.randomUUID()}`
    const first = await service.rpc('reserve_external_api_calls', { p_api: key, p_requested: 7, p_daily_limit: 10 })
    assertEquals(first.error, null)
    assertEquals(first.data, 7)
    const second = await service.rpc('reserve_external_api_calls', { p_api: key, p_requested: 7, p_daily_limit: 10 })
    assertEquals(second.data, 3)
    await service.from('external_api_budgets').delete().eq('api', key)
  })

  await t.step('authenticated users can read flags but not write them or call the RPC', async () => {
    const user = await getAuthenticatedClient()
    const read = await user.from('feature_flags').select('key, enabled, config').eq('key', 'projections_display').single()
    assertEquals(read.error, null)
    assertEquals(read.data?.enabled, false)
    await user.from('feature_flags').update({ enabled: true }).eq('key', 'projections_display')
    // RLS: no UPDATE policy for authenticated → zero rows affected, no error surfaced
    const check = await user.from('feature_flags').select('enabled').eq('key', 'projections_display').single()
    assertEquals(check.data?.enabled, false)
    const rpc = await user.rpc('reserve_external_api_calls', { p_api: 'x', p_requested: 1, p_daily_limit: 1 })
    assert(rpc.error !== null, 'authenticated must not execute reserve_external_api_calls')
  })
})
