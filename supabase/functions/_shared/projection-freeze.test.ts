/**
 * Unit tests for freezeProjection (projection-freeze.ts).
 *
 * Run with: deno task test:unit
 */
import { assertEquals } from '@std/assert'
import { createMockDbClient, type MockDb } from './_mock-client.ts'
import { freezeProjection, type FreezeClient } from './projection-freeze.ts'

const NOW = '2026-08-27T00:00:00.000Z'

Deno.test('freezeProjection', async (t) => {
  await t.step('freezes on a real Tomatometer score, rounding to the nearest integer', async () => {
    const db: MockDb = {
      movie_projections: [{ tmdb_id: 550, frozen_at: null, actual_rt: null }],
    }
    const client = createMockDbClient(db)

    const result = await freezeProjection(
      client,
      550,
      [{ source: 'imdb', score: 88 }, { source: 'rotten_tomatoes', score: 81.4 }],
      NOW
    )

    assertEquals(result, 'frozen')
    assertEquals(db.movie_projections[0].frozen_at, NOW)
    assertEquals(db.movie_projections[0].actual_rt, 81)
  })

  await t.step('skips without touching the row when there is no rotten_tomatoes rating', async () => {
    const db: MockDb = {
      movie_projections: [{ tmdb_id: 550, frozen_at: null, actual_rt: null }],
    }
    const client = createMockDbClient(db)

    const result = await freezeProjection(
      client,
      550,
      [{ source: 'imdb', score: 88 }, { source: 'metacritic', score: 66 }],
      NOW
    )

    assertEquals(result, 'skipped')
    assertEquals(db.movie_projections[0], { tmdb_id: 550, frozen_at: null, actual_rt: null })
  })

  await t.step('leaves an already-frozen row untouched', async () => {
    const db: MockDb = {
      movie_projections: [{ tmdb_id: 550, frozen_at: '2020-01-01T00:00:00.000Z', actual_rt: 70 }],
    }
    const client = createMockDbClient(db)

    const result = await freezeProjection(client, 550, [{ source: 'rotten_tomatoes', score: 81 }], NOW)

    // The mock client's .is('frozen_at', null) guard excludes this row, so
    // the update silently matches nothing -- mirroring the real DB's
    // conditional update. freezeProjection can't distinguish "no row" from
    // "row already frozen" (neither can the real UPDATE), so this is still
    // reported as 'frozen'; what matters is the row itself is untouched.
    assertEquals(result, 'frozen')
    assertEquals(db.movie_projections[0], { tmdb_id: 550, frozen_at: '2020-01-01T00:00:00.000Z', actual_rt: 70 })
  })

  await t.step('reports failed and does not throw when the update errors', async () => {
    const client: FreezeClient = {
      from: () => ({
        update: () => ({
          eq: () => ({
            is: () => Promise.resolve({ error: { message: 'boom' } }),
          }),
        }),
      }),
    }

    const result = await freezeProjection(client, 550, [{ source: 'rotten_tomatoes', score: 81 }], NOW)

    assertEquals(result, 'failed')
  })
})
