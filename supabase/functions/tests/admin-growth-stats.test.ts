/**
 * Integration tests for admin_growth_stats(), the RPC behind /admin.
 *
 * It reads every user and league in the database, so the thing worth pinning
 * down is who may call it: app_admins members only, and nobody may read
 * app_admins itself.
 *
 * Talks to the database through PostgREST only, so it does not depend on
 * which checkout the edge runtime is serving.
 *
 * Requires: npx supabase start
 */

import { assert, assertEquals, assertExists } from '@std/assert'
import {
  getAnonClient,
  getAuthenticatedClient,
  getServiceClient,
  getThirdAuthenticatedClient,
  getUserId,
} from './_setup.ts'

Deno.test({
  name: 'admin_growth_stats',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const service = getServiceClient()
    const admin = await getThirdAuthenticatedClient()
    const adminId = await getUserId(admin)

    const { error: grantError } = await service.from('app_admins').upsert({ user_id: adminId })
    if (grantError) throw new Error(grantError.message)

    try {
      await t.step('refuses anonymous callers', async () => {
        const { data, error } = await getAnonClient().rpc('admin_growth_stats')
        assertEquals(data, null)
        assertEquals(error?.code, '42501')
      })

      await t.step('refuses signed-in users who are not admins', async () => {
        const { data, error } = await (await getAuthenticatedClient()).rpc('admin_growth_stats')
        assertEquals(data, null)
        assertEquals(error?.code, '42501')
      })

      await t.step('nobody can read or change the admin list through the API', async () => {
        const nonAdmin = await getAuthenticatedClient()
        const nonAdminId = await getUserId(nonAdmin)
        const table = (client: typeof admin) => client.from('app_admins')

        for (const client of [getAnonClient(), nonAdmin, admin]) {
          const attempts = [
            table(client).select('user_id'),
            table(client).insert({ user_id: nonAdminId }),
            table(client).upsert({ user_id: nonAdminId }, { onConflict: 'user_id' }),
            table(client).update({ user_id: nonAdminId }).eq('user_id', adminId),
            table(client).delete().eq('user_id', adminId),
          ]
          for (const { error } of await Promise.all(attempts)) {
            assertEquals(error?.code, '42501')
          }
        }

        const { data } = await service.from('app_admins').select('user_id').eq('user_id', nonAdminId)
        assertEquals(data, [], 'no attempt made the non-admin an admin')
      })

      await t.step('returns the dashboard document to an admin', async () => {
        const { data, error } = await admin.rpc('admin_growth_stats')
        assertEquals(error, null)
        assertExists(data)

        assert(data.users.total >= 1)
        assert(data.users.active_30d >= 1, 'the admin just signed in, so is active')
        assertEquals(data.monthly.length, 12)
        assert(Array.isArray(data.league_list))
        assert(data.recent_users.length <= 25)

        const funnel = data.league_funnel
        assertEquals(funnel.created, data.leagues.total, 'the funnel counts leagues, not seasons')
        assert(
          funnel.created >= funnel.invited &&
            funnel.invited >= funnel.second_player &&
            funnel.second_player >= funnel.drafted &&
            funnel.drafted >= funnel.live,
          `league funnel must never widen: ${JSON.stringify(funnel)}`,
        )

        const growth = data.growth as { users: number; leagues: number }[]
        const lastWeek = growth[growth.length - 1]
        assertEquals(lastWeek.users, data.users.total, 'the line ends at the headline user count')
        assertEquals(lastWeek.leagues, data.leagues.total, 'the line ends at the headline league count')
        assert(
          growth.every((w, i) => i === 0 || (w.users >= growth[i - 1].users && w.leagues >= growth[i - 1].leagues)),
          'running totals never fall',
        )

        const users = data.user_funnel
        assert(
          data.users.total >= users.in_league &&
            users.in_league >= users.with_others &&
            users.with_others >= users.drafted,
          `user funnel must never widen: ${JSON.stringify(users)}`,
        )
      })
    } finally {
      await service.from('app_admins').delete().eq('user_id', adminId)
    }
  },
})
