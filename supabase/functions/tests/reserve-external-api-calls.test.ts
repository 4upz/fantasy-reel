/**
 * Integration tests for reserve_external_api_calls(), the daily budget that
 * keeps get-franchise-history's MDBList lookups from starving the nightly
 * score sync.
 *
 * Talks to the database through the service client only, so it does not
 * depend on which checkout the edge runtime is serving.
 *
 * Requires: npx supabase start
 */

import { assertEquals } from '@std/assert'
import { getAnonClient, getServiceClient, uniqueName } from './_setup.ts'

async function reserve(api: string, requested: number, limit: number): Promise<number> {
  const { data, error } = await getServiceClient().rpc('reserve_external_api_calls', {
    p_api: api,
    p_requested: requested,
    p_daily_limit: limit,
  })
  if (error) throw new Error(error.message)
  return data as number
}

Deno.test({
  name: 'reserve_external_api_calls',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    // A name of this test's own, so a parallel run cannot spend its budget.
    const api = uniqueName('test-api')

    try {
      await t.step('grants what is asked while under the limit', async () => {
        assertEquals(await reserve(api, 5, 8), 5)
      })

      await t.step('grants only what is left as the limit is reached', async () => {
        assertEquals(await reserve(api, 5, 8), 3)
      })

      await t.step('grants nothing once the day is spent', async () => {
        assertEquals(await reserve(api, 1, 8), 0)
      })

      await t.step('a raised limit frees the difference', async () => {
        assertEquals(await reserve(api, 10, 10), 2)
      })

      await t.step('a limit lowered below the spend grants nothing and keeps the count', async () => {
        assertEquals(await reserve(api, 1, 4), 0)

        const { data } = await getServiceClient()
          .from('external_api_budgets')
          .select('calls')
          .eq('api', api)
          .single()
        assertEquals(data?.calls, 10)
      })

      await t.step('a non-positive request or limit grants nothing and records nothing', async () => {
        assertEquals(await reserve(api, 0, 100), 0)
        assertEquals(await reserve(api, -3, 100), 0)
        assertEquals(await reserve(api, 3, 0), 0)

        const { data } = await getServiceClient()
          .from('external_api_budgets')
          .select('calls')
          .eq('api', api)
          .single()
        assertEquals(data?.calls, 10)
      })

      await t.step('is not callable by the anon role', async () => {
        const { error } = await getAnonClient().rpc('reserve_external_api_calls', {
          p_api: api,
          p_requested: 1,
          p_daily_limit: 100,
        })
        assertEquals(Boolean(error), true)
      })
    } finally {
      await getServiceClient().from('external_api_budgets').delete().eq('api', api)
    }
  },
})
