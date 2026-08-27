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

import { fetchMetadataStage } from '../ingest-film-corpus/handler.ts'

function tmdbResponder(url: string): Response | undefined {
  if (url.includes('/movie/404?')) return new Response('{}', { status: 404 })
  if (url.includes('/movie/10?')) {
    return new Response(JSON.stringify({
      id: 10, title: 'Sequel', release_date: '2026-12-15', vote_average: 0, vote_count: 0, budget: 0, runtime: 0,
      belongs_to_collection: { id: 500, name: 'Saga' },
      genres: [{ id: 28, name: 'Action' }], production_companies: [{ id: 33, name: 'Studio' }],
      credits: { cast: [{ id: 1001, name: 'Lead', order: 0 }], crew: [{ id: 2001, name: 'Dir', job: 'Director' }] },
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '', certification: 'PG-13' }] }] },
    }), { status: 200 })
  }
  if (url.includes('/person/2001/movie_credits')) {
    return new Response(JSON.stringify({ cast: [], crew: [{ id: 11, title: 'Prior', release_date: '2020-01-01', vote_count: 5000, job: 'Director' }] }), { status: 200 })
  }
  if (url.includes('/person/1001/movie_credits')) {
    return new Response(JSON.stringify({ cast: [{ id: 12, title: 'LeadPrior', release_date: '2018-01-01', vote_count: 5000, order: 1 }], crew: [] }), { status: 200 })
  }
  if (url.includes('/collection/500')) {
    return new Response(JSON.stringify({ name: 'Saga', parts: [{ id: 13, title: 'Saga 1', release_date: '2015-01-01', vote_count: 9000 }, { id: 10, title: 'Sequel', release_date: '2026-12-15', vote_count: 0 }] }), { status: 200 })
  }
  return undefined
}

Deno.test('ingest-film-corpus: metadata', async (t) => {
  await t.step('fills metadata, credits, and expands people + franchise for priority rows', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 10, title: 'Sequel', seed_source: 'upcoming', priority: 100, metadata_fetched_at: null, ratings_fetched_at: null, release_date: '2026-12-15' }],
      film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, {
      unique: { film_corpus: ['tmdb_id'], film_people: ['tmdb_person_id'], film_credits: ['tmdb_id', 'tmdb_person_id', 'role'], film_collections: ['collection_id'] },
    })
    const { restore } = stubFetch(tmdbResponder)
    try {
      const result = await fetchMetadataStage(client, DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 1)
      assertEquals(result.people_expanded, 3) // 2 people + 1 collection
      const row = db.film_corpus.find((r) => r.tmdb_id === 10)!
      assertEquals(row.collection_id, 500)
      assertEquals(row.us_release_type, 3)
      assert(row.metadata_fetched_at)
      assertEquals(db.film_credits.length, 2)
      assertEquals(db.film_people.map((p) => p.tmdb_person_id).sort(), [1001, 2001])
      assert(db.film_people.every((p) => p.credits_fetched_at))
      assertEquals(db.film_collections[0].parts_fetched_at !== null, true)
      const ids = db.film_corpus.map((r) => r.tmdb_id).sort()
      assertEquals(ids, [10, 11, 12, 13])
      const prior = db.film_corpus.find((r) => r.tmdb_id === 11)!
      assertEquals(prior.priority, 50)
      assertEquals(prior.seed_source, 'person')
    } finally {
      restore()
    }
  })

  await t.step('a TMDb 404 dead-ends the row instead of retrying forever', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 404, title: 'Gone', seed_source: 'discover', priority: 0, metadata_fetched_at: null, ratings_fetched_at: null }],
      film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { restore } = stubFetch(tmdbResponder)
    try {
      const result = await fetchMetadataStage(client, DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 0)
      assert(db.film_corpus[0].metadata_fetched_at)
      assertEquals(db.film_corpus[0].ratings_absent, true)
      assertEquals(result.remaining_metadata, 0)
    } finally {
      restore()
    }
  })

  await t.step('does not expand people credited only on low-priority films', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 10, title: 'Sequel', seed_source: 'discover', priority: 0, metadata_fetched_at: null, ratings_fetched_at: null }],
      film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, {
      unique: { film_corpus: ['tmdb_id'], film_people: ['tmdb_person_id'], film_credits: ['tmdb_id', 'tmdb_person_id', 'role'], film_collections: ['collection_id'] },
    })
    const { calls, restore } = stubFetch(tmdbResponder)
    try {
      const result = await fetchMetadataStage(client, DEPS, CONFIG)
      assertEquals(result.people_expanded, 0)
      assertEquals(calls.filter((c) => c.url.includes('/person/')).length, 0)
      assertEquals(db.film_people.length, 2) // still recorded, just not expanded
    } finally {
      restore()
    }
  })
})
