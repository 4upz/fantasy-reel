import { assertEquals, assert } from '@std/assert'
import { seedCorpus, type IngestConfig, DEFAULT_INGEST_CONFIG } from '../ingest-film-corpus/handler.ts'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'

const CONFIG: IngestConfig = { ...DEFAULT_INGEST_CONFIG, discoverFromYear: 2024, today: '2026-08-26' }
const DEPS = { tmdbToken: 'tok', mdblistApiKey: 'key' }

function discoverResponse(url: string): Response | undefined {
  if (!url.includes('/discover/movie')) return undefined
  const page = new URL(url).searchParams.get('page')
  const year = new URL(url).searchParams.get('primary_release_date.gte')!.slice(0, 4)
  const id = Number(`${year}${page}`)
  return new Response(JSON.stringify({ total_pages: 2, results: [{ id, title: `Film ${id}`, release_date: `${year}-05-01`, vote_count: 500 }] }), { status: 200 })
}

Deno.test('ingest-film-corpus: seed', async (t) => {
  await t.step('pages discover for every year lacking stubs and inserts them', async () => {
    const db: MockDb = { film_corpus: [], movies: [] }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { calls, restore } = stubFetch(discoverResponse)
    try {
      const result = await seedCorpus(client, DEPS, CONFIG)
      // years 2024, 2025, 2026 × 2 pages
      assertEquals(calls.filter((c) => c.url.includes('/discover/movie')).length, 6)
      assertEquals(result.seeded, 6)
      assert(db.film_corpus.every((r) => r.seed_source === 'discover' && r.priority === 0))
    } finally {
      restore()
    }
  })

  await t.step('skips years that already have 50+ discover stubs', async () => {
    const db: MockDb = {
      film_corpus: Array.from({ length: 50 }, (_, i) => ({ tmdb_id: i + 1, seed_source: 'discover', release_date: '2024-01-01' })),
      movies: [],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { calls, restore } = stubFetch(discoverResponse)
    try {
      await seedCorpus(client, DEPS, CONFIG)
      const years = calls.map((c) => new URL(c.url).searchParams.get('primary_release_date.gte')!.slice(0, 4))
      assert(!years.includes('2024'))
      assert(years.includes('2025'))
    } finally {
      restore()
    }
  })

  await t.step('upcoming and recently released league movies are seeded at priority 100', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 7, title: 'Already', seed_source: 'discover', priority: 0, release_date: '2026-09-01' }],
      movies: [
        { tmdb_id: 7, title: 'Already', release_date: '2026-09-01', status: 'upcoming', vote_count: 10 },
        { tmdb_id: 8, title: 'Recent', release_date: '2026-07-15', status: 'released', vote_count: 900 },
        { tmdb_id: 9, title: 'Ancient', release_date: '2020-01-01', status: 'released', vote_count: 900 },
      ],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { restore } = stubFetch(() => new Response(JSON.stringify({ total_pages: 1, results: [] }), { status: 200 }))
    try {
      await seedCorpus(client, DEPS, { ...CONFIG, discoverFromYear: 2026 })
      const byId = Object.fromEntries(db.film_corpus.map((r) => [r.tmdb_id, r]))
      assertEquals(byId[7].priority, 100)
      assertEquals(byId[8].seed_source, 'upcoming')
      assertEquals(byId[9], undefined)
    } finally {
      restore()
    }
  })
})
