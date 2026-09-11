/** Concurrency and lost-response checks against real Auth, REST, and Edge handlers. */
import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getServiceClient, getUserId, invokeFunction, uniqueName } from './_setup.ts'

Deno.test({
  name: 'atomic draft requests and concurrent delivery claims',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const service = getServiceClient()
    const owner = await getUserId(client)
    const member = await getUserId(secondClient)
    let movieNumber = 1_980_000_000 + Math.floor(Math.random() * 1_000_000)
    const releaseDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
    async function movie() {
      const tmdbId = movieNumber++
      await factory.cacheDraftMovie(tmdbId, { release_date: releaseDate })
      const { data, error } = await service.from('movies').insert({
        tmdb_id: tmdbId, title: `Atomic pick ${tmdbId}`, release_date: releaseDate, status: 'upcoming',
      }).select('id').single()
      assertEquals(error, null)
      return { id: data!.id, tmdbId }
    }
    async function setup(slots = 1, counterpicks = 0) {
      const { id } = await factory.createLeague(uniqueName('atomic-draft'), { draft_counterpick_slots: counterpicks })
      await factory.addSecondParticipant(id)
      assertEquals((await service.from('leagues').update({ draft_slots: slots }).eq('id', id)).error, null)
      const { data: participants, error } = await client.from('league_participants')
        .select('id,user_id').eq('league_id', id).eq('status', 'active')
      assertEquals(error, null)
      assertExists(participants)
      participants.sort((a, b) => Number(b.user_id === owner) - Number(a.user_id === owner))
      assertEquals((await client.rpc('reorder_draft_order', {
        p_league_id: id, p_participant_order: participants.map(p => p.id),
      })).error, null)
      assertEquals((await client.rpc('start_draft', { p_league_id: id })).error, null)
      return id
    }
    function pick(league: string, user: string, movieId: string, slot: number, requestId = crypto.randomUUID()) {
      return service.rpc('commit_draft_pick', {
        p_league_id: league, p_user_id: user, p_movie_id: movieId, p_expected_pick: slot, p_request_id: requestId,
      })
    }
    try {
      await t.step('mutation handlers reject malformed and nonobject JSON', async () => {
        for (const name of ['start-draft', 'draft-pick', 'make-counterpick', 'start-counterpick-round', 'skip-counterpick-round']) {
          for (const body of ['{', 'null', '[]']) {
            const { error } = await client.functions.invoke(name, { body })
            assertExists(error)
            assertEquals((error.context as Response).status, 400, name)
          }
        }
      })
      await t.step('simultaneous same request commits once and returns the same pick', async () => {
        const league = await setup(2)
        const target = await movie()
        const requestId = crypto.randomUUID()
        const results = await Promise.all([pick(league, owner, target.id, 1, requestId), pick(league, owner, target.id, 1, requestId)])
        for (const result of results) assertEquals(result.error, null)
        assertEquals(results[0].data.pick.id, results[1].data.pick.id)
        assertEquals(results.filter(r => r.data.replayed).length, 1)
        assertEquals((await service.from('draft_picks').select('id', { count: 'exact' }).eq('league_id', league)).count, 1)
      })

      await t.step('concurrent distinct selections cannot consume a consecutive snake turn', async () => {
        const league = await setup(2)
        const first = await movie()
        assertEquals((await pick(league, owner, first.id, 1)).error, null)
        const a = await movie()
        const b = await movie()
        const results = await Promise.all([pick(league, member, a.id, 2), pick(league, member, b.id, 2)])
        assertEquals(results.filter(r => !r.error).length, 1)
        assertEquals(results.find(r => r.error)?.error?.code, 'PT409')
        const next = await service.rpc('get_next_draft_pick', { p_league_id: league })
        assertEquals(next.data[0].user_id, member)
        assertEquals(next.data[0].round, 2)
        assertEquals((await service.from('draft_picks').select('id', { count: 'exact' }).eq('league_id', league)).count, 2)
      })

      await t.step('Edge replays lost final response after activation without consulting expired metadata', async () => {
        const league = await setup()
        const a = await movie()
        const b = await movie()
        assertEquals((await pick(league, owner, a.id, 1)).error, null)
        const body = { league_id: league, tmdb_id: b.tmdbId, expected_pick: 2, request_id: crypto.randomUUID() }
        const first = await invokeFunction<{ pick: { id: string }; league: { status: string }; replayed: boolean }>(secondClient, 'draft-pick', body)
        assertEquals(first.status, 201)
        assertEquals(first.data?.league.status, 'active')
        // A retry after the eligibility date changes still refers to its committed pick.
        assertEquals((await service.from('movies').update({ release_date: '2020-01-01' }).eq('id', b.id)).error, null)
        const replay = await invokeFunction<typeof first.data>(secondClient, 'draft-pick', body)
        assertEquals(replay.status, 201)
        assertEquals(replay.data?.replayed, true)
        assertEquals(replay.data?.pick.id, first.data?.pick.id)
        const reused = await invokeFunction(secondClient, 'draft-pick', { ...body, tmdb_id: a.tmdbId })
        assertEquals(reused.status, 409)
      })

      await t.step('concurrent counterpicks commit once and final response replays', async () => {
        const league = await setup(1, 1)
        const a = await movie()
        const b = await movie()
        assertEquals((await pick(league, owner, a.id, 1)).error, null)
        assertEquals((await pick(league, member, b.id, 2)).error, null)
        assertEquals((await service.rpc('transition_draft_phase', {
          p_league_id: league, p_user_id: owner, p_action: 'start_counterpicks',
        })).error, null)
        const args = { p_league_id: league, p_user_id: member, p_movie_id: a.id, p_expected_pick: 1 }
        const results = await Promise.all([
          service.rpc('commit_counterpick', { ...args, p_request_id: crypto.randomUUID() }),
          service.rpc('commit_counterpick', { ...args, p_request_id: crypto.randomUUID() }),
        ])
        assertEquals(results.filter(r => !r.error).length, 1)
        assertEquals(results.find(r => r.error)?.error?.code, 'PT409')
        const body = { league_id: league, movie_id: b.id, expected_pick: 2, request_id: crypto.randomUUID() }
        const last = await invokeFunction<{ counterpick: { id: string }; league: { status: string } }>(client, 'make-counterpick', body)
        assertEquals(last.status, 201)
        assertEquals(last.data?.league.status, 'active')
        const replay = await invokeFunction<{ counterpick: { id: string }; replayed: boolean }>(client, 'make-counterpick', body)
        assertEquals(replay.status, 201)
        assertEquals(replay.data?.counterpick.id, last.data?.counterpick.id)
        assertEquals(replay.data?.replayed, true)
      })

      await t.step('concurrent workers claim one lease and preserve channel order', async () => {
        const { id: league } = await factory.createLeague(uniqueName('outbox-claim'))
        const channel = crypto.randomUUID()
        assertEquals((await service.from('discord_channels').insert({
          id: channel, league_id: league, guild_id: channel, channel_id: channel,
          webhook_id: 'inert', webhook_url: 'https://example.invalid/inert',
        })).error, null)
        assertEquals((await service.from('draft_notification_outbox').insert([
          { league_id: league, channel_id: channel, event_key: 'first', kind: 'draft_started' },
          { league_id: league, channel_id: channel, event_key: 'second', kind: 'draft_pick' },
        ])).error, null)
        const claims = await Promise.all([service.rpc('claim_draft_notifications'), service.rpc('claim_draft_notifications')])
        for (const result of claims) assertEquals(result.error, null)
        const owned = claims.flatMap(r => r.data).filter(r => r.channel_id === channel)
        assertEquals(owned.length, 1)
        assertEquals(owned[0].event_key, 'first')
      })
    } finally {
      await factory.cleanup()
    }
  },
})
