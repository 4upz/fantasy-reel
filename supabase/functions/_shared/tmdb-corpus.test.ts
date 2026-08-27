import { assertEquals } from '@std/assert'
import { toCorpusMetadata, usReleaseType, fetchDiscoverPage, fetchPersonPriorFilms, fetchMovieMetadata } from './tmdb-corpus.ts'
import { stubFetch } from './_mock-client.ts'

const DUNE = {
  id: 438631, title: 'Dune', release_date: '2021-09-15', budget: 165000000, runtime: 155,
  vote_average: 7.8, vote_count: 12000,
  belongs_to_collection: { id: 726871, name: 'Dune Collection' },
  genres: [{ id: 878, name: 'Science Fiction' }, { id: 12, name: 'Adventure' }],
  production_companies: [{ id: 923, name: 'Legendary Pictures' }],
  credits: {
    cast: [
      { id: 1190668, name: 'Timothée Chalamet', order: 0 },
      { id: 933238, name: 'Rebecca Ferguson', order: 1 },
      { id: 99, name: 'Sixth Billed', order: 5 },
    ],
    crew: [
      { id: 137427, name: 'Denis Villeneuve', job: 'Director' },
      { id: 137427, name: 'Denis Villeneuve', job: 'Screenplay' },
      { id: 27, name: 'Eric Roth', job: 'Screenplay' },
      { id: 17315, name: 'Cale Boyter', job: 'Producer' },
    ],
  },
  release_dates: { results: [
    { iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2021-09-15T00:00:00.000Z', certification: '' }] },
    { iso_3166_1: 'US', release_dates: [
      { type: 1, release_date: '2021-10-07T00:00:00.000Z', certification: '' },
      { type: 3, release_date: '2021-10-22T00:00:00.000Z', certification: 'PG-13' },
    ] },
  ] },
}

Deno.test('tmdb-corpus', async (t) => {
  await t.step('toCorpusMetadata maps people, franchise, studio, genres, US release', () => {
    const meta = toCorpusMetadata(DUNE)
    assertEquals(meta.tmdb_id, 438631)
    assertEquals(meta.collection_id, 726871)
    assertEquals(meta.collection_name, 'Dune Collection')
    assertEquals(meta.genre_ids, [878, 12])
    assertEquals(meta.company_ids, [923])
    assertEquals(meta.us_release_type, 3)
    assertEquals(meta.certification, 'PG-13')
    assertEquals(meta.people, [
      { tmdb_person_id: 137427, name: 'Denis Villeneuve', role: 'director', billing: null },
      { tmdb_person_id: 137427, name: 'Denis Villeneuve', role: 'writer', billing: null },
      { tmdb_person_id: 27, name: 'Eric Roth', role: 'writer', billing: null },
      { tmdb_person_id: 1190668, name: 'Timothée Chalamet', role: 'cast', billing: 0 },
      { tmdb_person_id: 933238, name: 'Rebecca Ferguson', role: 'cast', billing: 1 },
    ])
  })

  await t.step('usReleaseType prefers wide (3) over limited (2) and ignores non-US', () => {
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'US', release_dates: [{ type: 2, release_date: '', certification: '' }, { type: 3, release_date: '', certification: '' }] }] }), 3)
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'US', release_dates: [{ type: 2, release_date: '', certification: '' }] }] }), 2)
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'GB', release_dates: [{ type: 3, release_date: '', certification: '' }] }] }), null)
    assertEquals(usReleaseType(undefined), null)
  })

  await t.step('fetchDiscoverPage builds stubs with seed_source discover', async () => {
    const { calls, restore } = stubFetch((url) =>
      url.includes('/discover/movie')
        ? new Response(JSON.stringify({ total_pages: 3, results: [{ id: 1, title: 'A', release_date: '2024-03-01', vote_count: 400 }] }), { status: 200 })
        : undefined
    )
    try {
      const page = await fetchDiscoverPage(2024, 2, 'tok', 300)
      assertEquals(page.totalPages, 3)
      assertEquals(page.stubs, [{ tmdb_id: 1, title: 'A', release_date: '2024-03-01', vote_count: 400, seed_source: 'discover', priority: 0 }])
      const url = new URL(calls[0].url)
      assertEquals(url.searchParams.get('vote_count.gte'), '300')
      assertEquals(url.searchParams.get('page'), '2')
      assertEquals(url.searchParams.get('with_release_type'), '3')
    } finally {
      restore()
    }
  })

  await t.step('fetchPersonPriorFilms keeps director/writer/lead-cast credits above the vote floor', async () => {
    const { restore } = stubFetch((url) =>
      url.includes('/person/137427/movie_credits')
        ? new Response(JSON.stringify({
            cast: [{ id: 5, title: 'Cameo', release_date: '2010-01-01', vote_count: 5000, order: 9 }],
            crew: [
              { id: 2, title: 'Arrival', release_date: '2016-11-11', vote_count: 20000, job: 'Director' },
              { id: 3, title: 'Tiny', release_date: '2001-01-01', vote_count: 12, job: 'Director' },
              { id: 4, title: 'Produced', release_date: '2019-01-01', vote_count: 900, job: 'Producer' },
              { id: 6, title: 'Unreleased', release_date: '', vote_count: 0, job: 'Director' },
            ],
          }), { status: 200 })
        : undefined
    )
    try {
      const stubs = await fetchPersonPriorFilms(137427, 'tok', 100)
      assertEquals(stubs, [{ tmdb_id: 2, title: 'Arrival', release_date: '2016-11-11', vote_count: 20000, seed_source: 'person', priority: 50 }])
    } finally {
      restore()
    }
  })

  await t.step('fetchMovieMetadata returns null on 404', async () => {
    const { restore } = stubFetch((url) => (url.includes('/movie/') ? new Response('{}', { status: 404 }) : undefined))
    try {
      assertEquals(await fetchMovieMetadata(1, 'tok'), null)
    } finally {
      restore()
    }
  })
})
