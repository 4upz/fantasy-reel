import { assertEquals } from '@std/assert'
import { getServiceClient, getAuthenticatedClient } from './_setup.ts'

/**
 * Every projections table is service-role only: the frontend never reads
 * feature flags or projections directly, so the display flag is a real gate
 * (projections reach clients only through get-movie-projections).
 */
Deno.test('projections tables are service-role only', async (t) => {
  const service = getServiceClient()

  await t.step('the service role reads the seeded flags', async () => {
    const { data, error } = await service
      .from('feature_flags')
      .select('key, enabled, config')
      .in('key', ['projections_ingestion', 'projections_display'])
      .order('key')
    assertEquals(error, null)
    assertEquals(data?.map((r) => [r.key, r.enabled]), [
      ['projections_display', false],
      ['projections_ingestion', false],
    ])
    assertEquals(data?.[0].config, { series_ids: ['86de1055-23a7-4cf3-be5c-5806d029dabe'] })
  })

  await t.step('authenticated users can neither read nor write any of them', async () => {
    const user = await getAuthenticatedClient()

    // RLS on with no policy is an empty result, a revoked grant is an error:
    // whichever way Postgres answers, nothing may come back.
    for (const table of [
      'feature_flags',
      'film_corpus',
      'film_people',
      'film_credits',
      'film_collections',
      'film_corpus_seed_progress',
      'film_feature_snapshots',
      'projection_models',
      'movie_projections',
    ]) {
      const { data, error } = await user.from(table).select('*').limit(1)
      if (error) continue
      assertEquals(data?.length ?? 0, 0, `${table} must not be readable by authenticated users`)
    }

    await user.from('feature_flags').update({ enabled: true }).eq('key', 'projections_display')
    const { data: check } = await service.from('feature_flags').select('enabled').eq('key', 'projections_display').single()
    assertEquals(check?.enabled, false)
  })
})
