import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getServiceClient, invokeFunction, uniqueName, waitFor } from './_setup.ts'

/**
 * Integration: model activation (activate_projection_model) and serving
 * (get-movie-projections) against local Supabase. Unit coverage of both lives
 * in _shared/fit-projection-model.test.ts and _shared/get-movie-projections.test.ts.
 */

const MODEL = { format: 1, feature_keys: [], note: 'integration fixture' }

type Service = ReturnType<typeof getServiceClient>

/** Activating a fixture model deactivates the real one: put it back. */
async function withActiveModelRestored(service: Service, body: (created: number[]) => Promise<void>) {
  const { data: before } = await service.from('projection_models').select('version').eq('is_active', true).maybeSingle()
  const created: number[] = []
  try {
    await body(created)
  } finally {
    await service.from('movie_projections').delete().in('model_version', created)
    if (created.length) await service.from('projection_models').delete().in('version', created)
    if (before) await service.from('projection_models').update({ is_active: true }).eq('version', before.version)
  }
}

Deno.test('activate_projection_model keeps exactly one active version', async (t) => {
  const service = getServiceClient()
  await withActiveModelRestored(service, async (created) => {
    await t.step('each call inserts the next version and makes it the only active one', async () => {
      for (let i = 0; i < 2; i++) {
        const { data, error } = await service.rpc('activate_projection_model', { p_coefficients: MODEL, p_metrics: { run: i } })
        assertEquals(error, null)
        assertEquals(typeof data, 'number')
        created.push(data as number)
      }
      assertEquals(created[1], created[0] + 1)
      const { data: active } = await service.from('projection_models').select('version, metrics').eq('is_active', true)
      assertEquals(active, [{ version: created[1], metrics: { run: 1 } }])
    })

    await t.step('rejects coefficients that are not an object', async () => {
      const { error } = await service.rpc('activate_projection_model', { p_coefficients: [1, 2], p_metrics: {} })
      assertExists(error)
    })

    await t.step('authenticated users cannot call it', async () => {
      const { client } = await createTestFactory()
      const { error } = await client.rpc('activate_projection_model', { p_coefficients: MODEL, p_metrics: {} })
      assertExists(error)
    })
  })
})

Deno.test('get-movie-projections serves cached rows only behind projections_display', async (t) => {
  const service = getServiceClient()
  const { client, secondClient, factory } = await createTestFactory()
  const { data: flagBefore } = await service.from('feature_flags').select('enabled, config').eq('key', 'projections_display').single()
  const tmdbId = 990_000_000 + Math.floor(Math.random() * 1_000_000)

  await withActiveModelRestored(service, async (created) => {
    try {
      const { id: leagueId } = await factory.createLeague(uniqueName('Projections'))
      const { data: league } = await service.from('leagues').select('series_id').eq('id', leagueId).single()
      assertExists(league?.series_id)

      const { data: activated, error: activateError } = await service.rpc('activate_projection_model', {
        p_coefficients: MODEL,
        p_metrics: {},
      })
      assertEquals(activateError, null)
      const version = activated as number
      created.push(version)
      const { error: insertError } = await service.from('movie_projections').insert({
        tmdb_id: tmdbId,
        model_version: version,
        projected_rt: 72.4,
        range50_lo: 66,
        range50_hi: 79,
        range80_lo: 55.5,
        range80_hi: 86,
        p_rotten: 0.18,
        p_fresh: 0.82,
        p_club90: 0.09,
        expected_points: 11.2,
        expected_points_double: 12.05,
        baseline_rt: 61,
        factors: [{ factor: 'director', label: 'Director', delta_rt: 11.4 }],
        coverage: 0.6,
        partial: false,
      })
      assertEquals(insertError, null)

      await service
        .from('feature_flags')
        .update({ enabled: true, config: { series_ids: [league!.series_id] } })
        .eq('key', 'projections_display')

      const body = { league_id: leagueId, tmdb_ids: [tmdbId, tmdbId + 1] }

      await t.step('a member sees the cached projection (after the 60s flag cache turns over)', async () => {
        // deno-lint-ignore no-explicit-any
        let result: any = null
        await waitFor(async () => {
          result = (await invokeFunction(client, 'get-movie-projections', body)).data
          return result?.enabled === true
        }, 70_000, 2_000)
        assertEquals(result.model_version, version)
        assertEquals(result.projections[String(tmdbId + 1)], null)
        const projection = result.projections[String(tmdbId)]
        assertEquals(projection.projected_rt, 72.4)
        assertEquals(projection.range50, [66, 79])
        assertEquals(projection.expected_points, 11.2)
      })

      await t.step('a non-member is refused', async () => {
        const { status } = await invokeFunction(secondClient, 'get-movie-projections', body)
        assertEquals(status, 403)
      })

      await t.step('validation runs before anything else', async () => {
        const { status } = await invokeFunction(client, 'get-movie-projections', { league_id: leagueId, tmdb_ids: [] })
        assertEquals(status, 400)
      })
    } finally {
      if (flagBefore) await service.from('feature_flags').update(flagBefore).eq('key', 'projections_display')
      await factory.cleanup()
    }
  })
})
