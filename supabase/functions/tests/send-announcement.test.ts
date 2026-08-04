/**
 * Integration tests for send-announcement Edge Function
 *
 * Tests the actual function via client.functions.invoke() (Supabase user JWT
 * auth), following the create-league.test.ts / update-league.test.ts
 * convention.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals } from '@std/assert'
import { createTestFactory, getAnonClient, invokeFunction, uniqueName } from './_setup.ts'

Deno.test({
  name: 'send-announcement',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'send-announcement', {
        league_id: '00000000-0000-0000-0000-000000000000',
        message: 'Hello',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    await t.step('returns 400 for missing league_id', async () => {
      const result = await invokeFunction(client, 'send-announcement', { message: 'Hello' })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for invalid league_id format', async () => {
      const result = await invokeFunction(client, 'send-announcement', {
        league_id: 'not-a-uuid',
        message: 'Hello',
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for an empty message', async () => {
      const { id: leagueId } = await factory.createLeague(uniqueName('announce-empty'))
      const result = await invokeFunction(client, 'send-announcement', {
        league_id: leagueId,
        message: '   ',
      })
      assertEquals(result.error, 'Announcement message cannot be empty')
    })

    await t.step('returns 404 when league does not exist', async () => {
      const result = await invokeFunction(client, 'send-announcement', {
        league_id: '00000000-0000-0000-0000-000000000000',
        message: 'Hello',
      })
      assertEquals(result.error, 'League not found')
    })

    await t.step('returns 403 when caller is not the league owner', async () => {
      const { id: leagueId } = await factory.createLeague(uniqueName('announce-403'))
      await factory.addSecondParticipant(leagueId)

      const result = await invokeFunction(secondClient, 'send-announcement', {
        league_id: leagueId,
        message: 'I am not the owner',
      })
      assertEquals(result.error, 'Only the league owner can post announcements')
    })

    await t.step('returns 200 with channels_notified: 0 when no Discord channel is linked', async () => {
      const { id: leagueId } = await factory.createLeague(uniqueName('announce-no-channel'))

      const result = await invokeFunction<{ message: string; channels_notified: number }>(
        client,
        'send-announcement',
        { league_id: leagueId, message: 'Draft trade deadline is Friday.' }
      )

      assertEquals(result.error, null)
      assertEquals(result.data?.channels_notified, 0)
    })

    await factory.cleanup()
  },
})
