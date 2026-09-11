/** Phase transitions use real completed draft fixtures and owner authorization. */
import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, getServiceClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'start-counterpick-round',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const service = getServiceClient()
    let tmdb = 1_970_000_000 + Math.floor(Math.random() * 1_000_000)
    async function completedDraft(counterpickSlots = 1) {
      const id = await factory.createDraftingLeague(uniqueName('completed-cp-draft'))
      assertEquals((await service.from('leagues').update({ draft_slots: 1, draft_counterpick_slots: counterpickSlots }).eq('id', id)).error, null)
      for (const picker of [client, secondClient]) {
        await factory.cacheDraftMovie(++tmdb)
        const pick = await invokeFunction(picker, 'draft-pick', { league_id: id, tmdb_id: tmdb })
        assertEquals(pick.status, 201)
      }
      return id
    }
    try {
      await t.step('authentication and required identifiers', async () => {
        assertEquals((await invokeFunction(getAnonClient(), 'start-counterpick-round', { league_id: crypto.randomUUID() })).status, 401)
        for (const body of [{}, { league_id: 'not-a-uuid' }]) {
          assertEquals((await invokeFunction(client, 'start-counterpick-round', body)).status, 400)
        }
        assertEquals((await invokeFunction(client, 'start-counterpick-round', { league_id: crypto.randomUUID() })).status, 404)
      })
      await t.step('only owner may start, skip, or end remaining counterpicks', async () => {
        const id = await factory.createDraftingLeague(uniqueName('cp-owner'))
        for (const [name, body] of [
          ['start-counterpick-round', { league_id: id }],
          ['skip-counterpick-round', { league_id: id }],
          ['skip-counterpick-round', { league_id: id, end_remaining: true }],
        ] as const) {
          assertEquals((await invokeFunction(secondClient, name, body)).status, 403)
        }
      })
      await t.step('setup and unfinished draft cannot enter or skip counterpicks', async () => {
        const { id: setup } = await factory.createLeague(uniqueName('cp-setup'))
        assertEquals((await invokeFunction(client, 'start-counterpick-round', { league_id: setup })).status, 409)
        const id = await factory.createDraftingLeague(uniqueName('cp-incomplete'))
        for (const name of ['start-counterpick-round', 'skip-counterpick-round']) {
          const result = await invokeFunction(client, name, { league_id: id })
          assertEquals(result.status, 409)
          assertEquals(result.error, 'All draft picks must be completed first')
        }
      })
      await t.step('zero and null quotas cannot start counterpicks', async () => {
        for (const quota of [0, null]) {
          const id = await factory.createDraftingLeague(uniqueName('cp-no-quota'))
          assertEquals((await service.from('leagues').update({ draft_counterpick_slots: quota }).eq('id', id)).error, null)
          const result = await invokeFunction(client, 'start-counterpick-round', { league_id: id })
          assertEquals(result.status, 400)
          assertEquals(result.error, 'League has no counterpick slots configured')
        }
      })
      await t.step('completed draft starts once and replays with the current first turn', async () => {
        const id = await completedDraft(2)
        const start = await invokeFunction<{ league: { status: string }; first_pick: { user_id: string; round: number; counterpicks_remaining: number } }>(client, 'start-counterpick-round', { league_id: id })
        assertEquals(start.status, 200)
        assertEquals(start.data?.league.status, 'counterpicking')
        assertExists(start.data?.first_pick)
        assertEquals(start.data.first_pick.round, 1)
        assertEquals(start.data.first_pick.counterpicks_remaining, 2)
        const repeat = await invokeFunction<typeof start.data>(client, 'start-counterpick-round', { league_id: id })
        assertEquals(repeat.status, 200)
        assertEquals(repeat.data?.first_pick, start.data.first_pick)
      })
      await t.step('owner may skip completed draft counterpicks and replay activation', async () => {
        const id = await completedDraft()
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await invokeFunction<{ league: { status: string }; round_complete: boolean }>(client, 'skip-counterpick-round', { league_id: id })
          assertEquals(result.status, 200)
          assertEquals(result.data?.league.status, 'active')
          assertEquals(result.data?.round_complete, true)
        }
      })
      await t.step('ending an active round requires the explicit end_remaining action', async () => {
        const id = await completedDraft()
        assertEquals((await invokeFunction(client, 'start-counterpick-round', { league_id: id })).status, 200)
        assertEquals((await invokeFunction(client, 'skip-counterpick-round', { league_id: id })).status, 409)
        assertEquals((await invokeFunction(client, 'skip-counterpick-round', { league_id: id, end_remaining: 'true' })).status, 400)
        const ended = await invokeFunction<{ league: { status: string } }>(client, 'skip-counterpick-round', { league_id: id, end_remaining: true })
        assertEquals(ended.status, 200)
        assertEquals(ended.data?.league.status, 'active')
      })
    } finally {
      await factory.cleanup()
    }
  },
})
