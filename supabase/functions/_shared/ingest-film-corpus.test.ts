import { assertEquals, assert } from '@std/assert'
import {
  seedCorpus,
  fetchMetadataStage,
  fetchRatingsStage,
  runIngestFilmCorpus,
  weekOf,
  type IngestConfig,
  DEFAULT_INGEST_CONFIG,
} from '../ingest-film-corpus/handler.ts'
import { createMockDbClient, stubFetch, type MockDb, type Row } from './_mock-client.ts'

const TODAY = '2026-08-26'
const CONFIG: IngestConfig = { ...DEFAULT_INGEST_CONFIG, discoverFromYear: 2024, today: TODAY }
const DEPS = { tmdbToken: 'tok', mdblistApiKey: 'key' }

const UNIQUE = {
  film_corpus: ['tmdb_id'],
  film_people: ['tmdb_person_id'],
  film_credits: ['tmdb_id', 'tmdb_person_id', 'role'],
  film_collections: ['collection_id'],
  film_corpus_seed_progress: ['year'],
  film_feature_snapshots: ['tmdb_id', 'week'],
}

const grantAll = { reserve_external_api_calls: (args?: Row) => args!.p_requested }

function client(db: MockDb, rpc: Record<string, unknown> = grantAll) {
  return createMockDbClient(db, { unique: UNIQUE, rpc })
}

/** A clock that jumps `stepMs` on every read, so stage deadlines are reachable. */
function steppingClock(stepMs: number): () => number {
  let t = 0
  return () => {
    const value = t
    t += stepMs
    return value
  }
}

const discoverYear = (url: string) => new URL(url).searchParams.get('release_date.gte')!.slice(0, 4)
const discoverPage = (url: string) => new URL(url).searchParams.get('page')!

/** Two pages per year, one film per page: id = `${year}${page}`. */
function discoverResponse(url: string): Response | undefined {
  if (!url.includes('/discover/movie')) return undefined
  const year = discoverYear(url)
  const id = Number(`${year}${discoverPage(url)}`)
  return new Response(JSON.stringify({
    total_pages: 2, total_results: 2,
    results: [{ id, title: `Film ${id}`, release_date: `${year}-05-01`, vote_count: 500 }],
  }), { status: 200 })
}

const emptyDiscover = () => new Response(JSON.stringify({ total_pages: 1, total_results: 0, results: [] }), { status: 200 })

function seedDb(extra: MockDb = {}): MockDb {
  return {
    film_corpus: [], film_corpus_seed_progress: [], team_holdings: [], leagues: [],
    league_participants: [], wishlisted_movies: [], ...extra,
  }
}

Deno.test('ingest-film-corpus: seed', async (t) => {
  await t.step('sweeps every year page by page and records each finished year', async () => {
    const db = seedDb()
    const { calls, restore } = stubFetch(discoverResponse)
    try {
      const result = await seedCorpus(client(db), DEPS, CONFIG)
      // years 2024, 2025, 2026 x 2 pages
      assertEquals(calls.filter((c) => c.url.includes('/discover/movie')).length, 6)
      assertEquals(result.seeded, 6)
      assert(db.film_corpus.every((r) => r.seed_source === 'discover' && r.priority === 0))
      assertEquals(db.film_corpus_seed_progress.map((p) => [p.year, p.next_page, p.total_pages]), [
        [2024, 1, 2], [2025, 1, 2], [2026, 1, 2],
      ])
      assert(db.film_corpus_seed_progress.every((p) => p.completed_at))
    } finally {
      restore()
    }
  })

  await t.step('seeded counts rows actually inserted, not rows sent', async () => {
    const db = seedDb({ film_corpus: [{ tmdb_id: 20241, title: 'Known', seed_source: 'person', priority: 50 }] })
    const { restore } = stubFetch(discoverResponse)
    try {
      const result = await seedCorpus(client(db), DEPS, { ...CONFIG, discoverFromYear: 2026 - 2 })
      assertEquals(result.seeded, 5)
      // The existing row keeps its own source and priority.
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 20241)!.priority, 50)
    } finally {
      restore()
    }
  })

  await t.step('resumes a year at its stored page, skips finished old years, re-sweeps stale recent ones', async () => {
    const db = seedDb({
      film_corpus_seed_progress: [
        // Finished long ago and not recent: skipped outright.
        { year: 2023, next_page: 1, completed_at: '2026-01-01T00:00:00Z' },
        // Cut off mid-year last run: resumes at page 2, page 1 is not re-read.
        { year: 2024, next_page: 2, completed_at: null },
        // Recent year finished three weeks ago: re-swept from page 1.
        { year: 2025, next_page: 1, completed_at: '2026-08-05T00:00:00Z' },
        // Recent year finished yesterday: left alone.
        { year: 2026, next_page: 1, completed_at: '2026-08-25T00:00:00Z' },
      ],
    })
    const { calls, restore } = stubFetch(discoverResponse)
    try {
      await seedCorpus(client(db), DEPS, { ...CONFIG, discoverFromYear: 2023 })
      const pages = (year: string) =>
        calls.filter((c) => c.url.includes('/discover/movie') && discoverYear(c.url) === year).map((c) => discoverPage(c.url))
      assertEquals(pages('2023'), [])
      assertEquals(pages('2024'), ['2'])
      assertEquals(pages('2025'), ['1', '2'])
      assertEquals(pages('2026'), [])
    } finally {
      restore()
    }
  })

  await t.step('a stage deadline saves the next page so the next run resumes there', async () => {
    const db = seedDb()
    const { restore } = stubFetch(discoverResponse)
    try {
      // 5s per clock read against an 8s budget: one page, then the deadline.
      const result = await seedCorpus(client(db), { ...DEPS, now: steppingClock(5_000) }, CONFIG)
      assertEquals(result.deadline_hit, true)
      assertEquals(db.film_corpus_seed_progress, [
        { year: 2024, next_page: 2, total_pages: 2, total_results: 2, completed_at: null },
      ])
    } finally {
      restore()
    }
  })

  await t.step('a discover page failure is isolated to its year and does not abort the sweep', async () => {
    const db = seedDb()
    const { restore } = stubFetch((url) =>
      url.includes('/discover/movie') && discoverYear(url) === '2025' ? new Response('', { status: 500 }) : discoverResponse(url)
    )
    try {
      const result = await seedCorpus(client(db), DEPS, { ...CONFIG, discoverFromYear: 2025 })
      assertEquals(result.errors.map((e) => [e.stage, e.id]), [['seed:discover', 2025]])
      assert(!db.film_corpus.some((r) => r.release_date?.startsWith('2025')))
      assert(db.film_corpus.some((r) => r.release_date?.startsWith('2026')))
    } finally {
      restore()
    }
  })

  await t.step('league movies come from rosters and active wishlists, at league priority', async () => {
    const db = seedDb({
      film_corpus: [{ tmdb_id: 7, title: 'From TMDb', release_date: '2026-09-04', seed_source: 'discover', priority: 0, runtime: 121 }],
      team_holdings: [
        { holding_id: 'h1', tmdb_id: 7, title: 'Untitled Sequel', release_date: '2026-09-01' },
        { holding_id: 'h2', tmdb_id: 8, title: 'Recent', release_date: '2026-07-15' },
        { holding_id: 'h3', tmdb_id: 9, title: 'Ancient', release_date: '2020-01-01' },
        { holding_id: 'h4', tmdb_id: 10, title: 'Undated', release_date: null },
      ],
      leagues: [{ id: 'live', status: 'active' }, { id: 'done', status: 'completed' }],
      league_participants: [
        { league_id: 'live', user_id: 'u1', status: 'active' },
        { league_id: 'live', user_id: 'u2', status: 'left' },
        { league_id: 'done', user_id: 'u3', status: 'active' },
      ],
      wishlisted_movies: [
        { user_id: 'u1', tmdb_id: 11, title: 'Wished' },
        { user_id: 'u1', tmdb_id: 8, title: 'Recent' },
        { user_id: 'u2', tmdb_id: 12, title: 'Left the league' },
        { user_id: 'u3', tmdb_id: 13, title: 'Finished season' },
      ],
    })
    const { restore } = stubFetch(emptyDiscover)
    try {
      const result = await seedCorpus(client(db), DEPS, { ...CONFIG, discoverFromYear: 2026 })
      const byId = Object.fromEntries(db.film_corpus.map((r) => [r.tmdb_id, r]))
      assertEquals(result.league_movies, 4)
      assertEquals(Object.keys(byId).map(Number).sort((a, b) => a - b), [7, 8, 10, 11])
      assertEquals([byId[7].priority, byId[8].priority, byId[10].priority, byId[11].priority], [100, 100, 100, 100])
      assertEquals([byId[8].seed_source, byId[11].seed_source], ['league', 'wishlist'])
      // Promotion writes priority only: the TMDb-sourced columns survive.
      assertEquals([byId[7].title, byId[7].release_date, byId[7].runtime, byId[7].seed_source], ['From TMDb', '2026-09-04', 121, 'discover'])
    } finally {
      restore()
    }
  })

  await t.step('a league seeding failure is recorded, not fatal', async () => {
    const db = seedDb()
    const c = client(db)
    const originalFrom = c.from.bind(c)
    // deno-lint-ignore no-explicit-any
    c.from = (table: string): any =>
      table === 'team_holdings'
        ? { select: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) }
        : originalFrom(table)
    const { restore } = stubFetch(emptyDiscover)
    try {
      const result = await seedCorpus(c, DEPS, { ...CONFIG, discoverFromYear: 2026 })
      assertEquals(result.errors.map((e) => e.stage), ['seed:league'])
    } finally {
      restore()
    }
  })
})

// ---------------------------------------------------------------------------
// Stage B
// ---------------------------------------------------------------------------

function sequelDetails(overrides: Record<string, unknown> = {}) {
  return {
    id: 10, title: 'Sequel', release_date: '2026-11-20', original_language: 'en', vote_average: 0, vote_count: 0, budget: 0, runtime: 0,
    belongs_to_collection: { id: 500, name: 'Saga' },
    genres: [{ id: 28, name: 'Action' }], production_companies: [{ id: 41077, name: 'A24' }],
    credits: {
      cast: [{ id: 1001, name: 'Lead', order: 0 }, { id: 1004, name: 'Fourth', order: 3 }],
      crew: [{ id: 2001, name: 'Dir', job: 'Director' }],
    },
    release_dates: { results: [
      { iso_3166_1: 'FR', release_dates: [{ type: 1, release_date: '2026-05-20T00:00:00.000Z', certification: '', note: 'Cannes Film Festival' }] },
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2026-12-15T00:00:00.000Z', certification: 'PG-13' }] },
    ] },
    keywords: { keywords: [{ id: 9663, name: 'sequel' }] },
    ...overrides,
  }
}

function tmdbResponder(details: Record<string, unknown> = sequelDetails()) {
  return (url: string): Response | undefined => {
    if (url.includes('/movie/404?')) return new Response('{}', { status: 404 })
    if (url.includes('/movie/10?')) return new Response(JSON.stringify(details), { status: 200 })
    if (url.includes('/movie/11?')) return new Response(JSON.stringify({ ...sequelDetails(), id: 11, title: 'Prior', belongs_to_collection: null }), { status: 200 })
    if (url.includes('/person/2001/movie_credits')) {
      return new Response(JSON.stringify({ cast: [], crew: [{ id: 11, title: 'Prior', release_date: '2020-01-01', vote_count: 5000, job: 'Director' }] }), { status: 200 })
    }
    if (url.includes('/person/1001/movie_credits')) {
      return new Response(JSON.stringify({ cast: [{ id: 12, title: 'LeadPrior', release_date: '2018-01-01', vote_count: 5000, order: 1 }], crew: [] }), { status: 200 })
    }
    if (url.includes('/collection/500')) {
      return new Response(JSON.stringify({ name: 'Saga', parts: [
        { id: 13, title: 'Saga 1', release_date: '2015-01-01', vote_count: 9000 },
        { id: 10, title: 'Sequel', release_date: '2026-12-15', vote_count: 0 },
      ] }), { status: 200 })
    }
    return undefined
  }
}

function metadataDb(rows: Row[], extra: MockDb = {}): MockDb {
  return {
    film_corpus: rows, film_people: [], film_credits: [], film_collections: [], film_feature_snapshots: [], ...extra,
  }
}

const leagueSequel = (overrides: Row = {}): Row => ({
  tmdb_id: 10, title: 'Sequel', seed_source: 'league', priority: 100,
  metadata_fetched_at: null, ratings_fetched_at: null, release_date: '2026-12-15', effective_release_date: '2026-12-15',
  ...overrides,
})

Deno.test('ingest-film-corpus: metadata', async (t) => {
  await t.step('stores the pre-release features, credits, and expands one level from league movies', async () => {
    const db = metadataDb([leagueSequel()])
    const { calls, restore } = stubFetch(tmdbResponder())
    try {
      const result = await fetchMetadataStage(client(db), DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 1)
      assertEquals([result.people_expanded, result.collections_expanded, result.remaining_expansion], [2, 1, 0])
      const row = db.film_corpus.find((r) => r.tmdb_id === 10)!
      assertEquals(row.us_wide_date, '2026-12-15')
      assertEquals(row.festival_premiere, 'cannes')
      assertEquals(row.keyword_flags, ['sequel'])
      assertEquals(row.label_id, 'a24')
      assertEquals(row.original_language, 'en')
      assertEquals(row.collection_id, 500)
      assert(row.metadata_fetched_at)
      // Fourth-billed cast is stored as a credit but not expanded.
      assertEquals(db.film_credits.length, 3)
      assertEquals(calls.filter((c) => c.url.includes('/person/1004/')).length, 0)
      const prior = db.film_corpus.find((r) => r.tmdb_id === 11)!
      assertEquals([prior.priority, prior.seed_source], [50, 'person'])
      assertEquals(db.film_corpus.map((r) => r.tmdb_id).sort((a, b) => a - b), [10, 11, 12, 13])
    } finally {
      restore()
    }
  })

  await t.step('predecessors are never expanded themselves: expansion is one level deep', async () => {
    // A predecessor (priority 50) gets its metadata, but its people stay unexpanded.
    const db = metadataDb([{ tmdb_id: 11, title: 'Prior', seed_source: 'person', priority: 50, metadata_fetched_at: null, effective_release_date: '2020-01-01' }])
    const { calls, restore } = stubFetch(tmdbResponder())
    try {
      const result = await fetchMetadataStage(client(db), DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 1)
      assertEquals(result.people_expanded, 0)
      assertEquals(calls.filter((c) => c.url.includes('/person/')).length, 0)
      assert(db.film_people.length > 0) // recorded, just not expanded
    } finally {
      restore()
    }
  })

  await t.step('expansion a run did not reach is picked up from stored rows on the next run', async () => {
    // Metadata was fetched earlier; the director was never expanded (the
    // old in-memory expansion forgot such people for good).
    const db = metadataDb([leagueSequel({ metadata_fetched_at: `${TODAY}T01:00:00Z` })], {
      film_people: [{ tmdb_person_id: 2001, name: 'Dir', credits_fetched_at: null }],
      film_credits: [{ tmdb_id: 10, tmdb_person_id: 2001, role: 'director', billing: null }],
    })
    const { calls, restore } = stubFetch(tmdbResponder())
    try {
      const result = await fetchMetadataStage(client(db), DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 0)
      assertEquals(result.people_expanded, 1)
      assertEquals(calls.filter((c) => c.url.includes('/movie/10?')).length, 0)
      assert(db.film_people[0].credits_fetched_at)
      assert(db.film_corpus.some((r) => r.tmdb_id === 11))
    } finally {
      restore()
    }
  })

  await t.step('a predecessor already in the sweep is promoted; a league movie is never demoted', async () => {
    const db = metadataDb([
      leagueSequel(),
      { tmdb_id: 11, title: 'Prior', seed_source: 'discover', priority: 0, metadata_fetched_at: null, effective_release_date: '2020-01-01' },
    ])
    const { restore } = stubFetch(tmdbResponder())
    try {
      await fetchMetadataStage(client(db), DEPS, CONFIG)
      const byId = Object.fromEntries(db.film_corpus.map((r) => [r.tmdb_id, r]))
      assertEquals([byId[11].priority, byId[11].seed_source], [50, 'discover'])
      // 10 is also a part of collection 500.
      assertEquals(byId[10].priority, 100)
    } finally {
      restore()
    }
  })

  await t.step('an unreleased league movie is refreshed weekly and its credits replaced; a released one is not', async () => {
    const db = metadataDb([
      leagueSequel({ metadata_fetched_at: '2026-08-10T00:00:00Z', us_wide_date: '2026-11-01' }),
      { tmdb_id: 404, title: 'Out', seed_source: 'league', priority: 100, metadata_fetched_at: '2026-08-10T00:00:00Z', effective_release_date: '2026-08-01' },
    ], {
      film_people: [{ tmdb_person_id: 2001, name: 'Dir', credits_fetched_at: TODAY }, { tmdb_person_id: 3001, name: 'Recast', credits_fetched_at: TODAY }],
      film_credits: [{ tmdb_id: 10, tmdb_person_id: 3001, role: 'cast', billing: 0 }],
      film_collections: [{ collection_id: 500, name: 'Saga', parts_fetched_at: TODAY }],
    })
    const { calls, restore } = stubFetch(tmdbResponder())
    try {
      const result = await fetchMetadataStage(client(db), DEPS, CONFIG)
      assertEquals(result.metadata_refreshed, 1)
      assertEquals(calls.filter((c) => c.url.includes('/movie/404?')).length, 0)
      const row = db.film_corpus.find((r) => r.tmdb_id === 10)!
      assertEquals(row.us_wide_date, '2026-12-15') // the date moved
      assert(!db.film_credits.some((c) => c.tmdb_person_id === 3001))
    } finally {
      restore()
    }
  })

  await t.step('writes one feature snapshot per unreleased league movie per week', async () => {
    const db = metadataDb([
      leagueSequel({ metadata_fetched_at: `${TODAY}T01:00:00Z`, label_id: 'a24', festival_premiere: 'cannes' }),
      { tmdb_id: 20, seed_source: 'league', priority: 100, metadata_fetched_at: `${TODAY}T01:00:00Z`, effective_release_date: '2026-08-01' },
    ], {
      film_credits: [{ tmdb_id: 10, tmdb_person_id: 2001, role: 'director', billing: null }],
      film_people: [{ tmdb_person_id: 2001, name: 'Dir', credits_fetched_at: TODAY }],
    })
    const { restore } = stubFetch(tmdbResponder())
    try {
      assertEquals((await fetchMetadataStage(client(db), DEPS, CONFIG)).snapshots_written, 1)
      assertEquals((await fetchMetadataStage(client(db), DEPS, CONFIG)).snapshots_written, 0)
      const [snap] = db.film_feature_snapshots
      assertEquals([snap.tmdb_id, snap.week, snap.effective_release_date], [10, '2026-08-24', '2026-12-15'])
      assertEquals([snap.features.label_id, snap.features.festival_premiere], ['a24', 'cannes'])
      assertEquals(snap.features.credits, [{ tmdb_person_id: 2001, role: 'director', billing: null }])
    } finally {
      restore()
    }
  })

  await t.step('a TMDb 404 dead-ends the row instead of retrying forever', async () => {
    const db = metadataDb([{ tmdb_id: 404, title: 'Gone', seed_source: 'discover', priority: 0, metadata_fetched_at: null, ratings_fetched_at: null }])
    const { restore } = stubFetch(tmdbResponder())
    try {
      const result = await fetchMetadataStage(client(db), DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 0)
      assert(db.film_corpus[0].metadata_fetched_at)
      assertEquals(db.film_corpus[0].ratings_absent, true)
      assertEquals(result.remaining_metadata, 0)
    } finally {
      restore()
    }
  })

  await t.step('a failed write is recorded and leaves the row due', async () => {
    const db = metadataDb([{ tmdb_id: 404, title: 'Gone', seed_source: 'discover', priority: 0, metadata_fetched_at: null, ratings_fetched_at: null }])
    const c = client(db)
    const originalFrom = c.from.bind(c)
    // deno-lint-ignore no-explicit-any
    c.from = (table: string): any => {
      const real = originalFrom(table)
      if (table !== 'film_corpus') return real
      return { ...real, update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }
    }
    const { restore } = stubFetch(tmdbResponder())
    try {
      const result = await fetchMetadataStage(c, DEPS, CONFIG)
      assertEquals(result.errors.map((e) => [e.stage, e.id]), [['metadata', 404]])
      assertEquals((result.errors[0].error as { message: string }).message, 'boom')
      assertEquals(db.film_corpus[0].metadata_fetched_at, null)
    } finally {
      restore()
    }
  })
})

// ---------------------------------------------------------------------------
// Stage C
// ---------------------------------------------------------------------------

const USER_OK = { api_requests: 1000, api_requests_count: 100 }

function mdblistResponder(payloads: Record<number, Response>, user: unknown = USER_OK) {
  return (url: string): Response | undefined => {
    const m = url.match(/api\.mdblist\.com\/tmdb\/movie\/(\d+)/)
    if (m) return payloads[Number(m[1])]?.clone() ?? new Response('', { status: 404 })
    if (url.includes('api.mdblist.com/user')) return new Response(JSON.stringify(user), { status: 200 })
    return undefined
  }
}

const ok = (rt: number | null, votes = 120) =>
  new Response(JSON.stringify({
    title: 't', budget: 5, certification: 'R', production_companies: [{ id: 9, name: 'S' }],
    ratings: [
      ...(rt === null ? [] : [{ source: 'tomatoes', value: rt, score: rt, votes }]),
      { source: 'metacritic', value: 61, score: 61, votes: 40 },
      { source: 'imdb', value: 7.4, score: 74, votes: 1000 },
    ],
  }), { status: 200 })

const due = (tmdb_id: number, overrides: Row = {}): Row => ({
  tmdb_id, priority: 0, metadata_fetched_at: 'x', ratings_fetched_at: null, effective_release_date: '2026-01-01',
  rt_critic: null, rt_settled_at: null, ratings_error_count: 0, budget: null, certification: null, company_ids: [],
  ...overrides,
})

/** Films looked up, once each (fetchWithRetry repeats a 429/5xx itself). */
const lookups = (calls: Array<{ url: string }>) => [
  ...new Set(calls.filter((c) => c.url.includes('/tmdb/movie/')).map((c) => Number(c.url.match(/movie\/(\d+)/)![1]))),
]

Deno.test('ingest-film-corpus: ratings', async (t) => {
  await t.step('fetches due rows in priority order and stores ratings and details', async () => {
    const db: MockDb = {
      film_corpus: [
        due(1, { priority: 100 }),
        due(2, { priority: 50, budget: 99, certification: 'PG', company_ids: [1] }),
        due(3),
        due(4, { metadata_fetched_at: null }),
      ],
    }
    const { calls, restore } = stubFetch(mdblistResponder({ 1: ok(88), 2: ok(null), 3: ok(40) }))
    try {
      const result = await fetchRatingsStage(client(db), DEPS, { ...CONFIG, perRunCap: 2 })
      assertEquals(lookups(calls), [1, 2])
      assertEquals([result.mdblist_granted, result.ratings_fetched, result.ratings_absent, result.remaining_ratings], [2, 1, 1, 1])
      const one = db.film_corpus.find((r) => r.tmdb_id === 1)!
      assertEquals([one.rt_critic, one.rt_critic_votes, one.metacritic, one.imdb, one.budget, one.company_ids], [88, 120, 61, 7.4, 5, [9]])
      const two = db.film_corpus.find((r) => r.tmdb_id === 2)!
      assertEquals([two.ratings_absent, two.budget], [true, 99])
    } finally {
      restore()
    }
  })

  await t.step('settles a score only with 20+ reviews and 60+ days past release', async () => {
    const db: MockDb = {
      film_corpus: [
        due(1, { effective_release_date: '2026-01-01' }), // old, enough reviews
        due(2, { effective_release_date: '2026-01-01' }), // old, too few reviews
        due(3, { effective_release_date: '2026-08-01' }), // recent: still moving
      ],
    }
    const { restore } = stubFetch(mdblistResponder({ 1: ok(80, 150), 2: ok(80, 12), 3: ok(95, 40) }))
    try {
      const result = await fetchRatingsStage(client(db), DEPS, CONFIG)
      assertEquals(result.ratings_settled, 1)
      const settled = db.film_corpus.map((r) => [r.tmdb_id, r.rt_settled_at !== null])
      assertEquals(settled, [[1, true], [2, false], [3, false]])
    } finally {
      restore()
    }
  })

  await t.step('re-polls unsettled scores weekly until well past the settle line, then stops', async () => {
    const db: MockDb = {
      film_corpus: [
        // Release-day score fetched 10 days ago: due again.
        due(1, { effective_release_date: '2026-08-01', ratings_fetched_at: '2026-08-15T00:00:00Z', rt_critic: 95 }),
        // Fetched 3 days ago: not yet.
        due(2, { effective_release_date: '2026-08-01', ratings_fetched_at: '2026-08-23T00:00:00Z', rt_critic: 90 }),
        // Released 100 days ago and never settled: out of the window.
        due(3, { effective_release_date: '2026-05-18', ratings_fetched_at: '2026-07-01T00:00:00Z', rt_critic: 70 }),
        // Settled: never re-polled.
        due(4, { effective_release_date: '2026-06-01', ratings_fetched_at: '2026-08-01T00:00:00Z', rt_critic: 70, rt_settled_at: '2026-08-01T00:00:00Z' }),
        // No score yet, released recently: due again.
        due(5, { effective_release_date: '2026-08-10', ratings_fetched_at: '2026-08-12T00:00:00Z', ratings_absent: true }),
        // Unreleased, however high its priority: never.
        due(6, { priority: 100, effective_release_date: '2026-12-01' }),
        due(7, { priority: 100, effective_release_date: null }),
      ],
    }
    const { calls, restore } = stubFetch(mdblistResponder({ 1: ok(84, 140), 5: ok(64) }))
    try {
      await fetchRatingsStage(client(db), DEPS, CONFIG)
      assertEquals(lookups(calls).sort(), [1, 5])
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 1)!.rt_critic, 84)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 5)!.ratings_absent, false)
    } finally {
      restore()
    }
  })

  await t.step('a score that goes missing upstream is kept', async () => {
    const db: MockDb = { film_corpus: [due(1, { effective_release_date: '2026-08-01', ratings_fetched_at: '2026-08-15T00:00:00Z', rt_critic: 91 })] }
    const { restore } = stubFetch(mdblistResponder({ 1: ok(null) }))
    try {
      await fetchRatingsStage(client(db), DEPS, CONFIG)
      assertEquals(db.film_corpus[0].rt_critic, 91)
      assert(db.film_corpus[0].ratings_fetched_at > '2026-08-15')
    } finally {
      restore()
    }
  })

  await t.step('a transient failure backs off and retries every few days, up to a cap', async () => {
    const db: MockDb = {
      film_corpus: [
        due(1),
        due(2, { ratings_error_count: 2, ratings_fetched_at: '2026-08-20T00:00:00Z' }), // waited long enough
        due(3, { ratings_error_count: 1, ratings_fetched_at: '2026-08-25T00:00:00Z' }), // too soon
        due(4, { ratings_error_count: 5, ratings_fetched_at: '2026-01-01T00:00:00Z' }), // gave up
      ],
    }
    const { calls, restore } = stubFetch(mdblistResponder({ 1: new Response('', { status: 503 }), 2: ok(70) }))
    try {
      const result = await fetchRatingsStage(client(db), DEPS, CONFIG)
      assertEquals(lookups(calls).sort(), [1, 2])
      assertEquals(result.errors.map((e) => [e.stage, e.id]), [['ratings', 1]])
      const byId = Object.fromEntries(db.film_corpus.map((r) => [r.tmdb_id, r]))
      assertEquals([byId[1].ratings_error_count, byId[1].ratings_absent], [1, undefined])
      assert(byId[1].ratings_fetched_at)
      assertEquals([byId[2].ratings_error_count, byId[2].rt_critic], [0, 70])
    } finally {
      restore()
    }
  })

  await t.step('reserves in chunks of 25 as it goes, never more than the work', async () => {
    const db: MockDb = { film_corpus: Array.from({ length: 60 }, (_, i) => due(i + 1)) }
    const seen: Row[] = []
    const rpc = { reserve_external_api_calls: (args?: Row) => (seen.push(args!), args!.p_requested) }
    const { restore } = stubFetch(mdblistResponder({}))
    try {
      const result = await fetchRatingsStage(client(db, rpc), DEPS, { ...CONFIG, perRunCap: 160 })
      assertEquals(seen.map((a) => a.p_requested), [25, 25, 10])
      assertEquals(seen[0], { p_api: 'mdblist:projections', p_requested: 25, p_daily_limit: CONFIG.dailyBudget })
      assertEquals([result.mdblist_granted, result.mdblist_spent], [60, 60])
    } finally {
      restore()
    }
  })

  await t.step('fetches at most four lookups at a time', async () => {
    const db: MockDb = { film_corpus: Array.from({ length: 12 }, (_, i) => due(i + 1)) }
    const respond = mdblistResponder({})
    let inFlight = 0
    let maxInFlight = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return respond(String(input)) ?? new Response(null, { status: 204 })
    }) as typeof fetch
    try {
      await fetchRatingsStage(client(db), DEPS, CONFIG)
      assertEquals(maxInFlight, 4)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await t.step('headroom keeps the 150-call safety reserve on the account', async () => {
    const db: MockDb = { film_corpus: Array.from({ length: 20 }, (_, i) => due(i + 1)) }
    const seen: Row[] = []
    const rpc = { reserve_external_api_calls: (args?: Row) => (seen.push(args!), args!.p_requested) }
    const fetchUsage = () => Promise.resolve({ cap: 1000, used: 841 })
    const { calls, restore } = stubFetch(mdblistResponder({}))
    try {
      const result = await fetchRatingsStage(client(db, rpc), { ...DEPS, fetchUsage }, CONFIG)
      // 1000 - 841 used - 150 reserve = 9
      assertEquals(seen.map((a) => a.p_requested), [9])
      assertEquals(lookups(calls).length, 9)
      assertEquals(result.mdblist_used_today, 841)
    } finally {
      restore()
    }
  })

  await t.step('spends nothing when MDBList usage cannot be read', async () => {
    const db: MockDb = { film_corpus: [due(1)] }
    const seen: Row[] = []
    const rpc = { reserve_external_api_calls: (args?: Row) => (seen.push(args!), 1) }
    const { calls, restore } = stubFetch(mdblistResponder({ 1: ok(80) }, {}))
    try {
      const result = await fetchRatingsStage(client(db, rpc), DEPS, CONFIG)
      assertEquals(result.mdblist_stopped, 'usage_unavailable')
      assertEquals(result.errors.map((e) => e.stage), ['ratings:usage'])
      assertEquals([seen.length, lookups(calls).length], [0, 0])
    } finally {
      restore()
    }
  })

  await t.step('asks MDBList nothing when no row is due', async () => {
    const db: MockDb = { film_corpus: [due(1, { metadata_fetched_at: null })] }
    const { calls, restore } = stubFetch(mdblistResponder({}))
    try {
      const result = await fetchRatingsStage(client(db), DEPS, CONFIG)
      assertEquals(result.mdblist_granted, 0)
      assertEquals(calls.filter((c) => c.url.includes('api.mdblist.com')).length, 0)
    } finally {
      restore()
    }
  })

  await t.step('an exhausted daily budget stops the stage', async () => {
    const db: MockDb = { film_corpus: [due(1)] }
    const { calls, restore } = stubFetch(mdblistResponder({ 1: ok(80) }))
    try {
      const result = await fetchRatingsStage(client(db, { reserve_external_api_calls: 0 }), DEPS, CONFIG)
      assertEquals(result.mdblist_stopped, 'budget_exhausted')
      assertEquals(lookups(calls), [])
    } finally {
      restore()
    }
  })

  for (const [status, reason] of [[429, 'rate_limited'], [401, 'auth_failed']] as const) {
    await t.step(`a ${status} stops the stage, stamps nothing, and is reported as ${reason}`, async () => {
      const db: MockDb = { film_corpus: Array.from({ length: 10 }, (_, i) => due(i + 1)) }
      const payloads = Object.fromEntries(db.film_corpus.map((r) => [r.tmdb_id, new Response('', { status })]))
      const { calls, restore } = stubFetch(mdblistResponder(payloads))
      try {
        const result = await fetchRatingsStage(client(db), DEPS, CONFIG)
        assertEquals(result.mdblist_stopped, reason)
        assertEquals(result.ratings_fetched, 0)
        // The in-flight batch finishes; nothing after it starts.
        assertEquals(lookups(calls).length, 4)
        assert(db.film_corpus.every((r) => r.ratings_fetched_at === null))
      } finally {
        restore()
      }
    })
  }
})

Deno.test('ingest-film-corpus: runner', async (t) => {
  await t.step('weekOf returns the Monday of the UTC week', () => {
    assertEquals(weekOf('2026-08-26'), '2026-08-24')
    assertEquals(weekOf('2026-08-24'), '2026-08-24')
    assertEquals(weekOf('2026-08-30'), '2026-08-24')
  })

  await t.step('runs all stages and totals errors', async () => {
    const db = { ...seedDb(), ...metadataDb([due(1, { priority: 100 }), due(2), due(404, { metadata_fetched_at: null })]) }
    const { restore } = stubFetch((url) =>
      url.includes('/discover/movie') ? emptyDiscover()
      : url.includes('/movie/404?') ? new Response('{}', { status: 404 })
      : mdblistResponder({ 1: ok(80), 2: ok(60) })(url)
    )
    try {
      const result = await runIngestFilmCorpus(client(db), DEPS, { ...CONFIG, discoverFromYear: 2026 })
      assertEquals(result.ratings_fetched, 2)
      assertEquals(result.failed, 0)
      assertEquals([result.remaining_metadata, result.remaining_ratings], [0, 0])
      assertEquals(result.deadlines, { seed: false, metadata: false, ratings: false })
    } finally {
      restore()
    }
  })

  await t.step('each stage gets its own slice: a slow sweep cannot starve the ratings stage', async () => {
    const db = { ...seedDb(), ...metadataDb([due(1, { priority: 100 })]) }
    const { calls, restore } = stubFetch((url) => discoverResponse(url) ?? mdblistResponder({ 1: ok(88) })(url))
    try {
      const result = await runIngestFilmCorpus(client(db), { ...DEPS, now: steppingClock(5_000) }, CONFIG)
      assertEquals(result.deadlines.seed, true)
      assertEquals(calls.filter((c) => c.url.includes('/discover/movie')).length, 1)
      assertEquals(result.deadlines.ratings, false)
      assertEquals(result.ratings_fetched, 1)
    } finally {
      restore()
    }
  })
})
