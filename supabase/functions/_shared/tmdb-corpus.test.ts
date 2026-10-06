import { assertEquals } from '@std/assert'
import {
  toCorpusMetadata, usReleaseType, festivalPremiere, keywordFlags, fetchDiscoverPage, fetchPersonPriorFilms,
  fetchCollectionParts, fetchMovieMetadata,
} from './tmdb-corpus.ts'
import { labelForCompanies } from './film-labels.ts'
import { stubFetch } from './_mock-client.ts'

const DUNE = {
  id: 438631, title: 'Dune', release_date: '2021-09-15', original_language: 'en', budget: 165000000, runtime: 155,
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
    { iso_3166_1: 'IT', release_dates: [{ type: 1, release_date: '2021-09-03T00:00:00.000Z', certification: '', note: 'Venice Film Festival' }] },
    { iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2021-09-15T00:00:00.000Z', certification: '' }] },
    { iso_3166_1: 'US', release_dates: [
      { type: 1, release_date: '2021-10-07T00:00:00.000Z', certification: '' },
      { type: 3, release_date: '2021-10-22T00:00:00.000Z', certification: 'PG-13' },
      { type: 4, release_date: '2021-10-22T00:00:00.000Z', certification: 'PG-13' },
    ] },
  ] },
  keywords: { keywords: [{ id: 818, name: 'based on novel or book' }, { id: 4565, name: 'dystopia' }] },
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
    assertEquals(meta.us_wide_date, '2021-10-22')
    assertEquals(meta.us_limited_date, null)
    assertEquals(meta.us_digital_date, '2021-10-22')
    assertEquals(meta.festival_premiere, 'venice')
    assertEquals(meta.keyword_flags, ['adaptation'])
    assertEquals(meta.label_id, 'legendary')
    assertEquals(meta.original_language, 'en')
    assertEquals(meta.people, [
      { tmdb_person_id: 137427, name: 'Denis Villeneuve', role: 'director', billing: null },
      { tmdb_person_id: 137427, name: 'Denis Villeneuve', role: 'writer', billing: null },
      { tmdb_person_id: 27, name: 'Eric Roth', role: 'writer', billing: null },
      { tmdb_person_id: 1190668, name: 'Timothée Chalamet', role: 'cast', billing: 0 },
      { tmdb_person_id: 933238, name: 'Rebecca Ferguson', role: 'cast', billing: 1 },
    ])
  })

  await t.step('festivalPremiere takes the earliest festival before the US release, and ignores later stops', () => {
    const rd = (country: string, date: string, note: string) => ({ iso_3166_1: country, release_dates: [{ type: 1, release_date: `${date}T00:00:00.000Z`, certification: '', note }] })
    const dates = { results: [rd('CA', '2024-09-08', 'Toronto International Film Festival'), rd('FR', '2024-05-20', 'Cannes Film Festival')] }
    assertEquals(festivalPremiere(dates, '2024-11-01'), 'cannes')
    assertEquals(festivalPremiere(dates, '2024-05-01'), null)
    assertEquals(festivalPremiere({ results: [rd('US', '2024-01-20', 'Sundance Film Festival')] }, null), 'sundance')
    assertEquals(festivalPremiere({ results: [rd('US', '2024-03-10', 'Premiere')] }, null), null)
    assertEquals(festivalPremiere(undefined, null), null)
  })

  await t.step('keywordFlags maps adaptation, remake, sequel and true-story keywords', () => {
    const k = (...names: string[]) => names.map((name, id) => ({ id, name }))
    assertEquals(keywordFlags(k('based on comic', 'sequel')), ['adaptation', 'sequel'])
    assertEquals(keywordFlags(k('remake', 'Based on True Story')), ['remake', 'true_story'])
    assertEquals(keywordFlags(k('biography')), ['true_story'])
    assertEquals(keywordFlags(k('dystopia')), [])
  })

  await t.step('labelForCompanies picks the highest-precedence label, else other, else null', () => {
    assertEquals(labelForCompanies([{ name: 'Some Financier LLC' }, { name: 'A24' }]), 'a24')
    assertEquals(labelForCompanies([{ name: 'Walt Disney Pictures' }, { name: 'Marvel Studios' }]), 'marvel')
    assertEquals(labelForCompanies([{ name: 'Fox Searchlight Pictures' }]), 'searchlight')
    assertEquals(labelForCompanies([{ name: 'Some Financier LLC' }]), 'other')
    assertEquals(labelForCompanies([]), null)
  })

  await t.step('usReleaseType prefers wide (3) over limited (2) over digital (4) and ignores non-US', () => {
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '', certification: '' }, { type: 2, release_date: '', certification: '' }] }] }), 2)
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '', certification: '' }] }] }), 4)
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'US', release_dates: [{ type: 2, release_date: '', certification: '' }, { type: 3, release_date: '', certification: '' }] }] }), 3)
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'US', release_dates: [{ type: 2, release_date: '', certification: '' }] }] }), 2)
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'GB', release_dates: [{ type: 3, release_date: '', certification: '' }] }] }), null)
    assertEquals(usReleaseType(undefined), null)
  })

  await t.step('fetchDiscoverPage samples US limited, wide and digital releases with the seed rules', async () => {
    const { calls, restore } = stubFetch((url) =>
      url.includes('/discover/movie')
        ? new Response(JSON.stringify({ total_pages: 3, total_results: 55, results: [{ id: 1, title: 'A', release_date: '2024-03-01', vote_count: 400 }] }), { status: 200 })
        : undefined
    )
    try {
      const page = await fetchDiscoverPage(2024, 2, 'tok', 25)
      assertEquals(page.totalPages, 3)
      assertEquals(page.totalResults, 55)
      assertEquals(page.stubs, [{ tmdb_id: 1, title: 'A', release_date: '2024-03-01', vote_count: 400, seed_source: 'discover', priority: 0 }])
      const url = new URL(calls[0].url)
      assertEquals(url.searchParams.get('vote_count.gte'), '25')
      assertEquals(url.searchParams.get('page'), '2')
      assertEquals(url.searchParams.get('region'), 'US')
      assertEquals(url.searchParams.get('with_release_type'), '2|3|4')
      assertEquals(url.searchParams.get('with_runtime.gte'), '70')
      assertEquals(url.searchParams.get('release_date.gte'), '2024-01-01')
      assertEquals(url.searchParams.get('release_date.lte'), '2024-12-31')
    } finally {
      restore()
    }
  })

  await t.step('fetchPersonPriorFilms keeps released director/writer/top-3-cast credits above the vote floor', async () => {
    const { restore } = stubFetch((url) =>
      url.includes('/person/137427/movie_credits')
        ? new Response(JSON.stringify({
            cast: [
              { id: 5, title: 'Cameo', release_date: '2010-01-01', vote_count: 5000, order: 3 },
              { id: 7, title: 'Lead', release_date: '2012-01-01', vote_count: 50, order: 2 },
            ],
            crew: [
              { id: 2, title: 'Arrival', release_date: '2016-11-11', vote_count: 20000, job: 'Director' },
              { id: 3, title: 'Tiny', release_date: '2001-01-01', vote_count: 12, job: 'Director' },
              { id: 4, title: 'Produced', release_date: '2019-01-01', vote_count: 900, job: 'Producer' },
              { id: 6, title: 'Undated', release_date: '', vote_count: 0, job: 'Director' },
              { id: 8, title: 'Upcoming', release_date: '2027-01-01', vote_count: 900, job: 'Director' },
            ],
          }), { status: 200 })
        : undefined
    )
    try {
      const stubs = await fetchPersonPriorFilms(137427, 'tok', 25, '2026-10-06', 50)
      assertEquals(stubs, [
        { tmdb_id: 2, title: 'Arrival', release_date: '2016-11-11', vote_count: 20000, seed_source: 'person', priority: 50 },
        { tmdb_id: 7, title: 'Lead', release_date: '2012-01-01', vote_count: 50, seed_source: 'person', priority: 50 },
      ])
    } finally {
      restore()
    }
  })

  await t.step('fetchCollectionParts keeps released entries only', async () => {
    const { restore } = stubFetch((url) =>
      url.includes('/collection/9')
        ? new Response(JSON.stringify({ name: 'Saga', parts: [
            { id: 1, title: 'One', release_date: '2020-01-01' },
            { id: 2, title: 'Two', release_date: '2027-01-01' },
            { id: 3, title: 'Three', release_date: '' },
          ] }), { status: 200 })
        : undefined
    )
    try {
      const { name, stubs } = await fetchCollectionParts(9, 'tok', '2026-10-06', 50)
      assertEquals(name, 'Saga')
      assertEquals(stubs.map((s) => s.tmdb_id), [1])
      assertEquals(stubs[0].seed_source, 'collection')
    } finally {
      restore()
    }
  })

  await t.step('fetchMovieMetadata asks for keywords and returns null on 404', async () => {
    const { calls, restore } = stubFetch((url) => (url.includes('/movie/') ? new Response('{}', { status: 404 }) : undefined))
    try {
      assertEquals(await fetchMovieMetadata(1, 'tok'), null)
      assertEquals(new URL(calls[0].url).searchParams.get('append_to_response'), 'credits,release_dates,keywords')
    } finally {
      restore()
    }
  })
})
