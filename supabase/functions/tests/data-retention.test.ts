/**
 * Integration tests for the purge-expired-data cron and the email-unsubscribe
 * endpoint. The retention windows themselves are covered row by row in
 * supabase/tests/data_retention.sql; these check the HTTP wiring.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals } from '@std/assert'
import {
  getServiceClient,
  getEdgeFunctionServiceRoleKey,
  getAuthenticatedClient,
  getUserId,
} from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'

Deno.test({
  name: 'purge-expired-data',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const url = `${SUPABASE_URL}/functions/v1/purge-expired-data`
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()

    await t.step('returns 403 without the cron secret or service role key', async () => {
      const response = await fetch(url, { method: 'POST', headers: { 'X-Cron-Secret': 'wrong' } })
      assertEquals(response.status, 403)
      await response.body?.cancel()
    })

    await t.step('purges and reports what it deleted', async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      })
      const data = await response.json()
      assertEquals(response.status, 200)
      assertEquals(data.job_status, 'ok')
      assertEquals(typeof data.deleted.notification_log, 'number')
      assertEquals(typeof data.more_remaining, 'boolean')
    })
  },
})

Deno.test({
  name: 'email-unsubscribe',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const url = `${SUPABASE_URL}/functions/v1/email-unsubscribe`
    const serviceClient = getServiceClient()
    const userId = await getUserId(await getAuthenticatedClient())

    const { data: rows, error } = await serviceClient.rpc('ensure_email_preferences', { p_user_ids: [userId] })
    if (error) throw error
    const token = (rows as { unsubscribe_token: string }[])[0].unsubscribe_token

    async function preference(): Promise<boolean> {
      const { data } = await serviceClient
        .from('email_preferences')
        .select('season_recap_emails')
        .eq('user_id', userId)
        .single()
      return data!.season_recap_emails
    }

    try {
      await t.step('refuses GET, so link scanners cannot unsubscribe anyone', async () => {
        const response = await fetch(`${url}?token=${token}`)
        assertEquals(response.status, 405)
        await response.body?.cancel()
        assertEquals(await preference(), true)
      })

      await t.step('rejects an unknown token', async () => {
        const response = await fetch(`${url}?token=00000000-0000-4000-8000-000000000000`, { method: 'POST' })
        assertEquals(response.status, 404)
        await response.body?.cancel()
      })

      await t.step('one-click POST from a mail client unsubscribes', async () => {
        const response = await fetch(`${url}?token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
        })
        assertEquals(response.status, 200)
        assertEquals((await response.json()).unsubscribed, true)
        assertEquals(await preference(), false)
      })

      await t.step('the site page can send the token in a JSON body', async () => {
        await serviceClient.from('email_preferences').update({ season_recap_emails: true }).eq('user_id', userId)
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        assertEquals(response.status, 200)
        await response.body?.cancel()
        assertEquals(await preference(), false)
      })
    } finally {
      await serviceClient.from('email_preferences').update({ season_recap_emails: true }).eq('user_id', userId)
    }
  },
})
