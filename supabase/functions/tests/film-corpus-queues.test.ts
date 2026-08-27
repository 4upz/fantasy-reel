import { assertEquals } from '@std/assert'
import { getServiceClient } from './_setup.ts'

Deno.test('film_corpus queue ordering', async (t) => {
  const service = getServiceClient()
  const ids = [900200001, 900200002, 900200003, 900200004]

  await t.step('setup', async () => {
    await service.from('film_corpus').delete().in('tmdb_id', ids)
    const { error } = await service.from('film_corpus').insert([
      { tmdb_id: ids[0], title: 'sweep-old', seed_source: 'discover', priority: 0, release_date: '2015-01-01' },
      { tmdb_id: ids[1], title: 'sweep-new', seed_source: 'discover', priority: 0, release_date: '2025-01-01' },
      { tmdb_id: ids[2], title: 'predecessor', seed_source: 'person', priority: 50, release_date: '2010-01-01' },
      { tmdb_id: ids[3], title: 'in-league', seed_source: 'upcoming', priority: 100, release_date: null },
    ])
    assertEquals(error, null)
  })

  await t.step('metadata queue serves league movies, then predecessors, then newest sweep rows', async () => {
    const { data } = await service
      .from('film_corpus')
      .select('tmdb_id')
      .in('tmdb_id', ids)
      .is('metadata_fetched_at', null)
      .order('priority', { ascending: false })
      .order('release_date', { ascending: false, nullsFirst: false })
    assertEquals(data?.map((r) => r.tmdb_id), [ids[3], ids[2], ids[1], ids[0]])
  })

  await t.step('cleanup', async () => {
    await service.from('film_corpus').delete().in('tmdb_id', ids)
  })
})
