/**
 * Unit tests for freezeProjection (projection-freeze.ts).
 *
 * Run with: deno task test:unit
 */
import { assertEquals } from '@std/assert'
import { createMockDbClient, type MockDb } from './_mock-client.ts'
import { freezeProjection, type FreezeClient } from './projection-freeze.ts'

const NOW = '2026-08-27T00:00:00.000Z'
const RT = (score: number) => [{ source: 'imdb', score: 88 }, { source: 'rotten_tomatoes', score }]

function unfrozen(): MockDb {
  return { movie_projections: [{ tmdb_id: 550, frozen_at: null, actual_rt: null }] }
}

Deno.test('freezeProjection', async (t) => {
  await t.step('freezes a released movie on its Tomatometer, rounding to the nearest integer', async () => {
    const db = unfrozen()
    assertEquals(await freezeProjection(createMockDbClient(db), 550, RT(81.4), true, NOW), 'frozen')
    assertEquals(db.movie_projections[0], { tmdb_id: 550, frozen_at: NOW, actual_rt: 81 })
  })

  await t.step('a pre-release (festival or embargo) score freezes nothing', async () => {
    const db = unfrozen()
    assertEquals(await freezeProjection(createMockDbClient(db), 550, RT(95), false, NOW), 'skipped')
    assertEquals(db.movie_projections[0], { tmdb_id: 550, frozen_at: null, actual_rt: null })
  })

  await t.step('skips without touching the row when there is no rotten_tomatoes rating', async () => {
    const db = unfrozen()
    const result = await freezeProjection(createMockDbClient(db), 550, [{ source: 'metacritic', score: 66 }], true, NOW)
    assertEquals(result, 'skipped')
    assertEquals(db.movie_projections[0], { tmdb_id: 550, frozen_at: null, actual_rt: null })
  })

  await t.step('a later score updates actual_rt but never moves frozen_at', async () => {
    const db: MockDb = {
      movie_projections: [{ tmdb_id: 550, frozen_at: '2020-01-01T00:00:00.000Z', actual_rt: 95 }],
    }
    assertEquals(await freezeProjection(createMockDbClient(db), 550, RT(84), true, NOW), 'frozen')
    assertEquals(db.movie_projections[0], { tmdb_id: 550, frozen_at: '2020-01-01T00:00:00.000Z', actual_rt: 84 })
  })

  await t.step('reports failed and does not throw when the update errors', async () => {
    const failing = Promise.resolve({ error: { message: 'boom' } })
    const client: FreezeClient = {
      from: () => ({ update: () => ({ eq: () => Object.assign(failing, { is: () => failing }) }) }),
    }
    assertEquals(await freezeProjection(client, 550, RT(81), true, NOW), 'failed')
  })
})
