import { assertEquals } from '@std/assert'
import { createMockDbClient, type MockDb } from './_mock-client.ts'

Deno.test('_mock-client extensions', async (t) => {
  await t.step('upsert merges on onConflict columns and inserts otherwise', async () => {
    const db: MockDb = { film_corpus: [{ tmdb_id: 1, title: 'Old', priority: 0 }] }
    const client = createMockDbClient(db)
    await client.from('film_corpus').upsert([{ tmdb_id: 1, title: 'New', priority: 50 }, { tmdb_id: 2, title: 'B', priority: 0 }], { onConflict: 'tmdb_id' })
    assertEquals(db.film_corpus.length, 2)
    assertEquals(db.film_corpus[0], { tmdb_id: 1, title: 'New', priority: 50 })
  })

  await t.step('upsert with ignoreDuplicates leaves existing rows alone', async () => {
    const db: MockDb = { film_corpus: [{ tmdb_id: 1, title: 'Old' }] }
    const client = createMockDbClient(db)
    await client.from('film_corpus').upsert([{ tmdb_id: 1, title: 'New' }], { onConflict: 'tmdb_id', ignoreDuplicates: true })
    assertEquals(db.film_corpus[0].title, 'Old')
  })

  await t.step('neq and not-is-null filter', async () => {
    const db: MockDb = { t: [{ a: 1, b: null }, { a: 2, b: 'x' }] }
    const client = createMockDbClient(db)
    assertEquals((await client.from('t').select('*').neq('a', 1)).data.length, 1)
    assertEquals((await client.from('t').select('*').not('b', 'is', null)).data.length, 1)
  })

  await t.step('update().is() and update().in() patch matching rows', async () => {
    const db: MockDb = { t: [{ id: 1, x: null }, { id: 2, x: 'set' }, { id: 3, x: null }] }
    const client = createMockDbClient(db)
    await client.from('t').update({ x: 'now' }).is('x', null)
    assertEquals(db.t.map((r) => r.x), ['now', 'set', 'now'])
    await client.from('t').update({ x: 'in' }).in('id', [2, 3])
    assertEquals(db.t.map((r) => r.x), ['now', 'in', 'in'])
  })
})
