import { assertEquals, assert } from '@std/assert'
import { seedCorpus, type IngestConfig, DEFAULT_INGEST_CONFIG } from '../ingest-film-corpus/handler.ts'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'

const CONFIG: IngestConfig = { ...DEFAULT_INGEST_CONFIG, discoverFromYear: 2024, today: '2026-08-26' }
const DEPS = { tmdbToken: 'tok', mdblistApiKey: 'key' }

/** A clock that jumps `stepMs` on every read, so stage deadlines are reachable. */
function steppingClock(stepMs: number): () => number {
  let t = 0
  return () => {
    const value = t
    t += stepMs
    return value
  }
}

function discoverResponse(url: string): Response | undefined {
  if (!url.includes('/discover/movie')) return undefined
  const page = new URL(url).searchParams.get('page')
  const year = new URL(url).searchParams.get('primary_release_date.gte')!.slice(0, 4)
  const id = Number(`${year}${page}`)
  return new Response(JSON.stringify({ total_pages: 2, total_results: 2, results: [{ id, title: `Film ${id}`, release_date: `${year}-05-01`, vote_count: 500 }] }), { status: 200 })
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

  await t.step('a year whose row count has caught up to total_results fetches only page 1; a year still short pages through', async () => {
    // discoverResponse mocks total_results: 2 for every year. 2024 already has
    // 2 rows dated in it (caught up); 2025 has only 1 (still short). The count
    // is over every seed source, not just 'discover': a film first seen as a
    // person's prior work still covers its year.
    const db: MockDb = {
      film_corpus: [
        { tmdb_id: 1, seed_source: 'discover', release_date: '2024-01-01' },
        { tmdb_id: 2, seed_source: 'person', release_date: '2024-06-01' },
        { tmdb_id: 3, seed_source: 'collection', release_date: '2025-01-01' },
      ],
      movies: [],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { calls, restore } = stubFetch(discoverResponse)
    try {
      await seedCorpus(client, DEPS, CONFIG)
      const pagesFetched = (year: string) =>
        calls
          .filter((c) => c.url.includes('/discover/movie') && new URL(c.url).searchParams.get('primary_release_date.gte')!.startsWith(year))
          .map((c) => new URL(c.url).searchParams.get('page'))
      assertEquals(pagesFetched('2024'), ['1'])
      assertEquals(pagesFetched('2025'), ['1', '2'])
      assertEquals(pagesFetched('2026'), ['1', '2'])
    } finally {
      restore()
    }
  })

  await t.step('a discover page failure is isolated to its year and does not abort the sweep', async () => {
    const db: MockDb = { film_corpus: [], movies: [] }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const responder = (url: string): Response | undefined => {
      if (!url.includes('/discover/movie')) return undefined
      const year = new URL(url).searchParams.get('primary_release_date.gte')!.slice(0, 4)
      return year === '2025' ? new Response('', { status: 500 }) : discoverResponse(url)
    }
    const { restore } = stubFetch(responder)
    try {
      const result = await seedCorpus(client, DEPS, { ...CONFIG, discoverFromYear: 2025 })
      assertEquals(result.errors.length, 1)
      assertEquals(result.errors[0].stage, 'seed:discover')
      assertEquals(result.errors[0].id, 2025)
      assert(!db.film_corpus.some((r) => r.release_date?.startsWith('2025')))
      assert(db.film_corpus.some((r) => r.release_date?.startsWith('2026')))
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

  await t.step('promoting a league movie keeps the columns already fetched from TMDb', async () => {
    const db: MockDb = {
      film_corpus: [{
        tmdb_id: 7, title: 'From TMDb', release_date: '2026-09-04', vote_count: 812,
        seed_source: 'discover', priority: 0, metadata_fetched_at: '2026-08-20T00:00:00Z', runtime: 121,
      }],
      // The movies table's copy is staler: a placeholder title, no votes, and
      // a release date that has since moved. Promotion must not write it back.
      movies: [{ tmdb_id: 7, title: 'Untitled Sequel', release_date: '2026-09-01', status: 'upcoming', vote_count: null }],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { restore } = stubFetch(() => new Response(JSON.stringify({ total_pages: 1, results: [] }), { status: 200 }))
    try {
      await seedCorpus(client, DEPS, { ...CONFIG, discoverFromYear: 2026 })
      const row = db.film_corpus.find((r) => r.tmdb_id === 7)!
      assertEquals(row.priority, 100)
      assertEquals(row.title, 'From TMDb')
      assertEquals(row.release_date, '2026-09-04')
      assertEquals(row.vote_count, 812)
      assertEquals(row.runtime, 121)
      assertEquals(row.metadata_fetched_at, '2026-08-20T00:00:00Z')
    } finally {
      restore()
    }
  })

  await t.step('an upcoming movie with no release date yet is still seeded (not dropped by the date filter)', async () => {
    const db: MockDb = {
      film_corpus: [],
      movies: [{ tmdb_id: 10, title: 'Undated', release_date: null, status: 'upcoming', vote_count: 5 }],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { restore } = stubFetch(() => new Response(JSON.stringify({ total_pages: 1, results: [] }), { status: 200 }))
    try {
      await seedCorpus(client, DEPS, { ...CONFIG, discoverFromYear: 2026 })
      const row = db.film_corpus.find((r) => r.tmdb_id === 10)
      assertEquals(row?.seed_source, 'upcoming')
      assertEquals(row?.priority, 100)
      assertEquals(row?.release_date, null)
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

  await t.step('a predecessor already seeded by the discover sweep is promoted, and a league movie is not demoted', async () => {
    const db: MockDb = {
      film_corpus: [
        { tmdb_id: 10, title: 'Sequel', seed_source: 'upcoming', priority: 100, metadata_fetched_at: null, ratings_fetched_at: null, release_date: '2026-12-15' },
        // Already in the corpus at the back of the queue; it is also the prior
        // film of the sequel's director, so this run should move it forward.
        { tmdb_id: 11, title: 'Prior', seed_source: 'discover', priority: 0, metadata_fetched_at: null, ratings_fetched_at: null, release_date: '2020-01-01' },
      ],
      film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, {
      unique: { film_corpus: ['tmdb_id'], film_people: ['tmdb_person_id'], film_credits: ['tmdb_id', 'tmdb_person_id', 'role'], film_collections: ['collection_id'] },
    })
    const { restore } = stubFetch(tmdbResponder)
    try {
      await fetchMetadataStage(client, DEPS, CONFIG)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 11)!.priority, 50)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 11)!.seed_source, 'discover')
      // 10 is also a part of collection 500: promotion must never pull a
      // league movie back down to the expansion priority.
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 10)!.priority, 100)
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

  await t.step('a write failure while dead-ending a 404 is recorded, not silently dropped', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 404, title: 'Gone', seed_source: 'discover', priority: 0, metadata_fetched_at: null, ratings_fetched_at: null }],
      film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const originalFrom = client.from.bind(client)
    // deno-lint-ignore no-explicit-any
    client.from = (table: string): any => {
      const real = originalFrom(table)
      if (table !== 'film_corpus') return real
      return {
        ...real,
        update: (_patch: Record<string, unknown>) => ({
          eq: (_col: string, _val: unknown) => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }
    }
    const { restore } = stubFetch(tmdbResponder)
    try {
      const result = await fetchMetadataStage(client, DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 0)
      assertEquals(result.errors.length, 1)
      assertEquals(result.errors[0].stage, 'metadata')
      assertEquals(result.errors[0].id, 404)
      // Serialized, not String()'d: a persisted '[object Object]' is undiagnosable.
      assertEquals((result.errors[0].error as { message: string }).message, 'boom')
      // The row was never actually stamped -- the failed write must not be
      // mistaken for a completed dead-end.
      assertEquals(db.film_corpus[0].metadata_fetched_at, null)
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

import { fetchRatingsStage, runIngestFilmCorpus } from '../ingest-film-corpus/handler.ts'

function mdblistResponder(payloads: Record<number, Response>) {
  return (url: string): Response | undefined => {
    const m = url.match(/api\.mdblist\.com\/tmdb\/movie\/(\d+)/)
    if (m) return payloads[Number(m[1])] ?? new Response('', { status: 404 })
    if (url.includes('api.mdblist.com/user')) return new Response(JSON.stringify({ api_requests: 1000, api_requests_count: 100 }), { status: 200 })
    return undefined
  }
}

const ok = (rt: number | null) =>
  new Response(JSON.stringify({
    title: 't', budget: 5, certification: 'R', production_companies: [{ id: 9, name: 'S' }],
    ratings: [
      ...(rt === null ? [] : [{ source: 'tomatoes', value: rt, score: rt, votes: 120 }]),
      { source: 'metacritic', value: 61, score: 61, votes: 40 },
      { source: 'imdb', value: 7.4, score: 74, votes: 1000 },
    ],
  }), { status: 200 })

function ratingsDb(): MockDb {
  return {
    film_corpus: [
      { tmdb_id: 1, priority: 100, metadata_fetched_at: 'x', ratings_fetched_at: null, release_date: '2026-08-01', budget: null, certification: null, company_ids: [] },
      { tmdb_id: 2, priority: 50, metadata_fetched_at: 'x', ratings_fetched_at: null, release_date: '2026-08-02', budget: 99, certification: 'PG', company_ids: [1] },
      { tmdb_id: 3, priority: 0, metadata_fetched_at: 'x', ratings_fetched_at: null, release_date: '2026-08-03' },
      { tmdb_id: 4, priority: 0, metadata_fetched_at: null, ratings_fetched_at: null, release_date: '2026-08-04' },
    ],
  }
}

Deno.test('ingest-film-corpus: ratings', async (t) => {
  await t.step('fetches ratings for granted rows in priority order and stores details', async () => {
    const db = ratingsDb()
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => args!.p_requested } })
    const { calls, restore } = stubFetch(mdblistResponder({ 1: ok(88), 2: ok(null), 3: ok(40) }))
    try {
      const result = await fetchRatingsStage(client, DEPS, { ...CONFIG, perRunCap: 2 })
      assertEquals(result.mdblist_granted, 2)
      assertEquals(result.ratings_fetched, 1)
      assertEquals(result.ratings_absent, 1)
      assertEquals(result.remaining_ratings, 1)
      const one = db.film_corpus.find((r) => r.tmdb_id === 1)!
      assertEquals(one.rt_critic, 88)
      assertEquals(one.rt_critic_votes, 120)
      assertEquals(one.metacritic, 61)
      assertEquals(one.imdb, 7.4)
      assertEquals(one.budget, 5)
      assertEquals(one.company_ids, [9])
      const two = db.film_corpus.find((r) => r.tmdb_id === 2)!
      assertEquals(two.ratings_absent, true)
      assertEquals(two.budget, 99) // existing details kept
      assert(two.ratings_fetched_at)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 3)!.ratings_fetched_at, null)
      assertEquals(calls.filter((c) => c.url.includes('/tmdb/movie/')).length, 2)
    } finally {
      restore()
    }
  })

  await t.step('an unreleased row is never fetched, however high its priority', async () => {
    const db: MockDb = {
      film_corpus: [
        { tmdb_id: 1, priority: 100, metadata_fetched_at: 'x', ratings_fetched_at: null, release_date: '2026-12-01' },
        { tmdb_id: 2, priority: 100, metadata_fetched_at: 'x', ratings_fetched_at: null, release_date: null },
        { tmdb_id: 3, priority: 0, metadata_fetched_at: 'x', ratings_fetched_at: null, release_date: '2026-08-20' },
      ],
    }
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => args!.p_requested } })
    const { calls, restore } = stubFetch(mdblistResponder({ 3: ok(75) }))
    try {
      const result = await fetchRatingsStage(client, DEPS, CONFIG)
      const fetched = calls.filter((c) => c.url.includes('/tmdb/movie/')).map((c) => c.url.match(/movie\/(\d+)/)![1])
      assertEquals(fetched, ['3'])
      // Only the released row was ever eligible, so only one call was reserved.
      assertEquals(result.mdblist_granted, 1)
      assertEquals(result.remaining_ratings, 0)
    } finally {
      restore()
    }
  })

  await t.step('a recently released row with no rating yet is re-polled; an old one is left alone', async () => {
    const db: MockDb = {
      film_corpus: [
        // Released 10 days ago, MDBList had no Tomatometer then, stamped a week
        // ago: worth asking again while the movie is still in play.
        { tmdb_id: 1, priority: 100, metadata_fetched_at: 'x', ratings_absent: true, ratings_fetched_at: '2026-08-19T00:00:00Z', release_date: '2026-08-16' },
        // Released 90 days ago: past the window, it is never getting a score.
        { tmdb_id: 2, priority: 100, metadata_fetched_at: 'x', ratings_absent: true, ratings_fetched_at: '2026-06-01T00:00:00Z', release_date: '2026-05-28' },
        // Already stamped today: one ask per day, not one per run.
        { tmdb_id: 3, priority: 100, metadata_fetched_at: 'x', ratings_absent: true, ratings_fetched_at: '2026-08-26T09:00:00Z', release_date: '2026-08-20' },
        // Has a Tomatometer already: never re-fetched here.
        { tmdb_id: 4, priority: 100, metadata_fetched_at: 'x', ratings_absent: false, ratings_fetched_at: '2026-08-01T00:00:00Z', release_date: '2026-07-30' },
      ],
    }
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => args!.p_requested } })
    const { calls, restore } = stubFetch(mdblistResponder({ 1: ok(64) }))
    try {
      const result = await fetchRatingsStage(client, DEPS, CONFIG)
      const fetched = calls.filter((c) => c.url.includes('/tmdb/movie/')).map((c) => c.url.match(/movie\/(\d+)/)![1])
      assertEquals(fetched, ['1'])
      assertEquals(result.ratings_fetched, 1)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 1)!.rt_critic, 64)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 1)!.ratings_absent, false)
    } finally {
      restore()
    }
  })

  await t.step('reserves nothing, and asks MDBList nothing, when no row is eligible', async () => {
    const db: MockDb = {
      film_corpus: [
        { tmdb_id: 1, priority: 100, metadata_fetched_at: 'x', ratings_fetched_at: '2026-08-26T00:00:00Z', ratings_absent: false, release_date: '2026-08-01' },
        { tmdb_id: 2, priority: 100, metadata_fetched_at: null, ratings_fetched_at: null, release_date: '2026-08-01' },
      ],
    }
    const seen: Array<Record<string, unknown>> = []
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => { seen.push(args!); return 5 } } })
    const { calls, restore } = stubFetch(mdblistResponder({}))
    try {
      const result = await fetchRatingsStage(client, DEPS, CONFIG)
      assertEquals(seen.length, 0)
      assertEquals(result.mdblist_granted, 0)
      // Not even the /user reconciliation call: an empty queue costs nothing.
      assertEquals(calls.filter((c) => c.url.includes('api.mdblist.com')).length, 0)
    } finally {
      restore()
    }
  })

  await t.step('never reserves more than there is work for', async () => {
    const db = ratingsDb()
    const seen: Array<Record<string, unknown>> = []
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => { seen.push(args!); return 0 } } })
    const { restore } = stubFetch(mdblistResponder({}))
    try {
      // Headroom is the full 300-per-run cap, but only 3 rows are eligible.
      await fetchRatingsStage(client, DEPS, { ...CONFIG, perRunCap: 300 })
      assertEquals(seen[0].p_requested, 3)
    } finally {
      restore()
    }
  })

  await t.step('headroom respects the remote counter, the scoring reserve, and the daily budget', async () => {
    const db: MockDb = {
      // 20 eligible rows, so the grant is bounded by headroom rather than by
      // how much work there is.
      film_corpus: Array.from({ length: 20 }, (_, i) => ({
        tmdb_id: i + 1, priority: 0, metadata_fetched_at: 'x', ratings_fetched_at: null, release_date: '2026-08-01',
      })),
    }
    const seen: Array<Record<string, unknown>> = []
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => { seen.push(args!); return 0 } } })
    const fetchUsage = () => Promise.resolve({ cap: 1000, used: 890 })
    const { restore } = stubFetch(mdblistResponder({}))
    try {
      const result = await fetchRatingsStage(client, { ...DEPS, fetchUsage }, { ...CONFIG, dailyBudget: 500, perRunCap: 300 })
      // 1000 - 890 used - 100 scoring reserve - 1 for the /user call = 9
      assertEquals(seen[0], { p_api: 'mdblist:projections', p_requested: 9, p_daily_limit: 500 })
      assertEquals(result.mdblist_used_today, 890)
      assertEquals(result.ratings_fetched, 0)
    } finally {
      restore()
    }
  })

  await t.step('a 429 stops the stage and is reported', async () => {
    const db = ratingsDb()
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => args!.p_requested } })
    const { restore } = stubFetch(mdblistResponder({ 1: new Response('', { status: 429 }), 2: ok(70) }))
    try {
      const result = await fetchRatingsStage(client, DEPS, CONFIG)
      assertEquals(result.mdblist_429, true)
      assertEquals(result.ratings_fetched, 0)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 1)!.ratings_fetched_at, null) // not stamped: retry tomorrow
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 2)!.ratings_fetched_at, null) // loop stopped
    } finally {
      restore()
    }
  })

  await t.step('a 401 stops the stage and is reported as an auth failure', async () => {
    const db = ratingsDb()
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => args!.p_requested } })
    const { restore } = stubFetch(mdblistResponder({ 1: new Response('', { status: 401 }), 2: ok(70) }))
    try {
      const result = await fetchRatingsStage(client, DEPS, CONFIG)
      assertEquals(result.mdblist_auth_failed, true)
      assertEquals(result.ratings_fetched, 0)
      // A bad or expired key fails every row: burning the rest of the grant on
      // it is pointless, and none of them may be stamped.
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 1)!.ratings_fetched_at, null)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 2)!.ratings_fetched_at, null)
    } finally {
      restore()
    }
  })

  await t.step('runIngestFilmCorpus runs all stages and totals errors', async () => {
    const db: MockDb = { ...ratingsDb(), movies: [], film_people: [], film_credits: [], film_collections: [] }
    const client = createMockDbClient(db, {
      unique: { film_corpus: ['tmdb_id'], film_people: ['tmdb_person_id'], film_credits: ['tmdb_id', 'tmdb_person_id', 'role'], film_collections: ['collection_id'] },
      rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => args!.p_requested },
    })
    const { restore } = stubFetch((url) =>
      url.includes('/discover/movie') ? new Response(JSON.stringify({ total_pages: 1, results: [] }), { status: 200 })
      : url.includes('/movie/4?') ? new Response('{}', { status: 404 })
      : mdblistResponder({ 1: ok(80), 2: ok(60), 3: ok(50) })(url)
    )
    try {
      const result = await runIngestFilmCorpus(client, DEPS, { ...CONFIG, discoverFromYear: 2026 })
      assertEquals(result.ratings_fetched, 3)
      assertEquals(result.failed, 0)
      assertEquals(result.remaining_metadata, 0)
      assertEquals(result.remaining_ratings, 0)
      assertEquals(result.deadlines, { seed: false, metadata: false, ratings: false })
    } finally {
      restore()
    }
  })

  await t.step('each stage gets its own slice of the run budget: a slow Stage A cannot starve Stage C', async () => {
    // The whole run must fit inside the cron proxy's 55s abort. With a clock
    // that jumps 5s per read and a 10s seed budget, Stage A runs out during its
    // first year -- and Stage C must still get its own 17s and do work.
    const db: MockDb = {
      film_corpus: [
        { tmdb_id: 1, priority: 100, metadata_fetched_at: 'x', ratings_fetched_at: null, release_date: '2026-08-01', budget: null, certification: null, company_ids: [] },
      ],
      movies: [], film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, {
      unique: { film_corpus: ['tmdb_id'], film_people: ['tmdb_person_id'], film_collections: ['collection_id'] },
      rpc: { reserve_external_api_calls: (args?: Record<string, unknown>) => args!.p_requested },
    })
    const { calls, restore } = stubFetch((url) =>
      url.includes('/discover/movie') ? discoverResponse(url)
      : url.includes('/movie/') && url.includes('api.themoviedb.org') ? new Response('{}', { status: 404 })
      : mdblistResponder({ 1: ok(88) })(url)
    )
    try {
      const result = await runIngestFilmCorpus(client, { ...DEPS, now: steppingClock(5_000) }, CONFIG)
      assertEquals(result.deadlines.seed, true)
      // 2024 page 1, then the deadline lands before page 2 of the same year.
      assertEquals(calls.filter((c) => c.url.includes('/discover/movie')).length, 1)
      assertEquals(result.deadlines.ratings, false)
      assertEquals(result.ratings_fetched, 1)
    } finally {
      restore()
    }
  })
})
