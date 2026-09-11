/** Direct Data API checks: endpoint owner checks must not be the only boundary. */
import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, getServiceClient, getUserId, invokeFunction, uniqueName } from './_setup.ts'

Deno.test({
  name: 'draft authorization and concurrent start',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const anon = getAnonClient()
    const service = getServiceClient()
    const outsider = await factory.createThirdClient()

    async function setup() {
      const { id } = await factory.createLeague(uniqueName('draft-auth'))
      await factory.addSecondParticipant(id)
      const { data, error } = await client.from('league_participants')
        .select('id').eq('league_id', id).eq('status', 'active').order('id')
      assertEquals(error, null)
      assertExists(data)
      return { id, order: data.map((p: { id: string }) => p.id) }
    }

    async function readOrder(id: string) {
      const { data, error } = await client.from('league_participants')
        .select('id').eq('league_id', id).eq('status', 'active').order('draft_order')
      assertEquals(error, null)
      assertExists(data)
      return data.map((p: { id: string }) => p.id)
    }

    function mutations(id: string, order: string[]) {
      return [
        { name: 'randomize_draft_order', args: { p_league_id: id } },
        { name: 'randomize_draft_order_if_needed', args: { p_league_id: id } },
        { name: 'reorder_draft_order', args: { p_league_id: id, p_participant_order: order } },
        { name: 'start_draft', args: { p_league_id: id } },
        { name: 'kick_draft_participant', args: { p_league_id: id, p_participant_id: order[0] } },
      ]
    }
    const reorder = (id: string, order: Array<string | null>) => client.rpc('reorder_draft_order', {
      p_league_id: id, p_participant_order: order,
    })

    try {
      await t.step('anonymous, members, and outsiders cannot mutate another owner’s order', async () => {
        const { id, order } = await setup()
        for (const mutation of mutations(id, order)) {
          assertEquals((await anon.rpc(mutation.name, mutation.args)).error?.code, '42501', mutation.name)
          assertEquals((await secondClient.rpc(mutation.name, mutation.args)).error?.code, 'PT403', mutation.name)
          assertEquals((await outsider.rpc(mutation.name, mutation.args)).error?.code, 'PT403', mutation.name)
        }
        assertEquals((await client.rpc('lock_draft_setup', { p_league_id: id })).error?.code, '42501')
        assertEquals((await invokeFunction(secondClient, 'update-league', {
          action: 'reorder_participants', league_id: id, participant_order: order,
        })).status, 403)
      })

      await t.step('owner order and custom flag are saved together and preserved at start', async () => {
        const { id, order } = await setup()
        assertEquals((await client.rpc('randomize_draft_order', { p_league_id: id })).error, null)
        assertEquals((await client.from('leagues').select('custom_draft_order').eq('id', id).single()).data?.custom_draft_order, true)
        assertEquals((await reorder(id, order)).error, null)
        assertEquals((await client.rpc('randomize_draft_order_if_needed', { p_league_id: id })).error, null)
        assertEquals(await readOrder(id), order)
        const { data, error } = await client.rpc('start_draft', { p_league_id: id })
        assertEquals(error, null)
        assertEquals(data.league.status, 'drafting')
        assertEquals(data.participant_count, 2)
        assertEquals(await readOrder(id), order)
      })

      await t.step('invalid participant lists leave the saved order intact', async () => {
        const { id, order } = await setup()
        assertEquals((await reorder(id, order)).error, null)
        for (const invalid of [[], [order[0], order[0]], [order[0], crypto.randomUUID()], [null, order[0]]]) {
          assertEquals((await reorder(id, invalid)).error?.code, 'PT400')
          assertEquals(await readOrder(id), order)
        }
      })

      await t.step('next-turn identifiers are visible only to members or service', async () => {
        const { id, order } = await setup()
        assertEquals((await reorder(id, order)).error, null)
        assertEquals((await anon.rpc('get_next_draft_pick', { p_league_id: id })).error?.code, '42501')
        assertEquals((await outsider.rpc('get_next_draft_pick', { p_league_id: id })).error?.code, 'PT403')
        for (const allowed of [client, secondClient, service]) {
          const result = await allowed.rpc('get_next_draft_pick', { p_league_id: id })
          assertEquals(result.error, null)
          assertEquals(result.data[0].participant_id, order[0])
        }
      })

      await t.step('active phases reject order RPCs and direct start/order bypasses', async () => {
        const { id, order } = await setup()
        assertEquals((await reorder(id, order)).error, null)
        assertEquals((await client.from('league_participants').update({ draft_order: 99 }).eq('id', order[0])).error?.code, '42501')
        assertEquals((await client.from('leagues').update({ status: 'drafting' }).eq('id', id)).error?.code, '42501')
        for (const status of ['drafting', 'counterpicking', 'active', null]) {
          assertEquals((await service.from('leagues').update({ status }).eq('id', id)).error, null)
          for (const mutation of mutations(id, [...order].reverse())) {
            assertEquals((await client.rpc(mutation.name, mutation.args)).error?.code, 'PT409', `${status}: ${mutation.name}`)
          }
          assertEquals((await client.from('leagues').update({ status: 'setup' }).eq('id', id)).error?.code, '42501')
          assertEquals(await readOrder(id), order)
        }
      })

      await t.step('membership cannot bypass invitations or change a live turn count', async () => {
        const { id, order } = await setup()
        const outsiderId = await getUserId(outsider)
        const secondId = await getUserId(secondClient)
        const enrollment = { league_id: id, user_id: outsiderId, status: 'active', draft_order: 1 }
        assertEquals((await outsider.from('league_participants').insert(enrollment)).error?.code, '42501')
        assertEquals((await client.from('league_participants').insert(enrollment)).error?.code, '42501')
        assertEquals((await client.from('league_participants').update({ user_id: outsiderId }).eq('id', order[0])).error?.code, '42501')
        assertEquals((await reorder(id, order)).error, null)
        assertEquals((await client.rpc('start_draft', { p_league_id: id })).error, null)
        assertEquals((await service.from('league_participants').insert(enrollment)).error?.code, 'PT409')
        assertEquals((await secondClient.from('league_participants').delete().eq('league_id', id).eq('user_id', secondId)).error?.code, 'PT409')
        assertEquals((await client.from('league_participants').delete().eq('id', order[0])).error?.code, 'PT409')
        assertEquals((await client.from('league_participants').update({ status: 'kicked' }).eq('id', order[0])).error?.code, 'PT409')
        assertEquals((await service.from('league_participants').update({ draft_order: 99 }).eq('id', order[0])).error?.code, 'PT409')
        assertEquals(await readOrder(id), order)
      })

      await t.step('simultaneous starts commit exactly once', async () => {
        const { id } = await setup()
        const results = await Promise.all([
          client.rpc('start_draft', { p_league_id: id }),
          client.rpc('start_draft', { p_league_id: id }),
        ])
        assertEquals(results.filter((r) => !r.error).length, 1)
        assertEquals(results.find((r) => r.error)?.error?.code, 'PT409')
      })

      await t.step('racing start/reorder has a serial outcome and freezes order', async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const { id, order } = await setup()
          const reversed = [...order].reverse()
          assertEquals((await reorder(id, order)).error, null)
          const [start, reordered] = await Promise.all([
            client.rpc('start_draft', { p_league_id: id }), reorder(id, reversed),
          ])
          assertEquals(start.error, null)
          if (reordered.error) assertEquals(reordered.error.code, 'PT409')
          const frozen = reordered.error ? order : reversed
          assertEquals(await readOrder(id), frozen)
          assertEquals((await reorder(id, order)).error?.code, 'PT409')
          assertEquals(await readOrder(id), frozen)
        }
      })
    } finally {
      await factory.cleanup()
    }
  },
})
