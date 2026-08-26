import { assertEquals } from '@std/assert'
import {
  historyForMovie,
  releasedParts,
  MAX_PRIOR_FILMS,
  type CollectionRecord,
  type FranchiseFilm,
} from './franchise-history.ts'

const TODAY = '2026-08-26'

function film(tmdb_id: number, release_date: string | null, rt_score: number | null): FranchiseFilm {
  return { tmdb_id, title: `Film ${tmdb_id}`, release_date, poster_url: null, rt_score }
}

const SHREK: CollectionRecord = {
  collection_id: 2150,
  collection_name: 'Shrek Collection',
  films: [
    film(808, '2001-05-18', 88),
    film(809, '2004-05-19', 89),
    film(810, '2007-05-18', 41),
    film(10192, '2010-05-21', 58),
  ],
}

Deno.test('releasedParts keeps only dated, already-released parts, oldest first', () => {
  const parts = releasedParts(
    [
      { id: 3, title: 'c', release_date: '2027-06-30', poster_path: null },
      { id: 2, title: 'b', release_date: '2004-05-19', poster_path: null },
      { id: 4, title: 'd', release_date: null, poster_path: null },
      { id: 5, title: 'e', release_date: '', poster_path: null },
      { id: 1, title: 'a', release_date: '2001-05-18', poster_path: null },
    ],
    TODAY
  )
  assertEquals(parts.map((p) => p.id), [1, 2])
})

Deno.test('historyForMovie: an upcoming sequel sees every released film', () => {
  const history = historyForMovie(SHREK, { tmdb_id: 999, release_date: '2027-06-30' })
  assertEquals(history?.entry_number, 5)
  assertEquals(history?.films.map((f) => f.tmdb_id), [808, 809, 810, 10192])
  assertEquals(history?.average_rt, 69)
  assertEquals(history?.last_rt, 58)
  assertEquals(history?.collection_name, 'Shrek Collection')
})

Deno.test('historyForMovie: an undated sequel is treated as after everything released', () => {
  const history = historyForMovie(SHREK, { tmdb_id: 999, release_date: null })
  assertEquals(history?.entry_number, 5)
  assertEquals(history?.films.length, 4)
})

Deno.test('historyForMovie: a released film only sees what came before it, never itself', () => {
  const history = historyForMovie(SHREK, { tmdb_id: 810, release_date: '2007-05-18' })
  assertEquals(history?.entry_number, 3)
  assertEquals(history?.films.map((f) => f.tmdb_id), [808, 809])
  assertEquals(history?.average_rt, 89)
  assertEquals(history?.last_rt, 89)
})

Deno.test('historyForMovie: the first film in a series has no history', () => {
  assertEquals(historyForMovie(SHREK, { tmdb_id: 808, release_date: '2001-05-18' }), null)
})

Deno.test('historyForMovie: unscored films are skipped by the average but not the list', () => {
  const record: CollectionRecord = {
    ...SHREK,
    films: [film(1, '2000-01-01', 80), film(2, '2005-01-01', null)],
  }
  const history = historyForMovie(record, { tmdb_id: 3, release_date: '2027-01-01' })
  assertEquals(history?.films.length, 2)
  assertEquals(history?.average_rt, 80)
  assertEquals(history?.last_rt, null)
})

Deno.test('historyForMovie: no scored films at all yields a null average', () => {
  const record: CollectionRecord = { ...SHREK, films: [film(1, '2000-01-01', null)] }
  const history = historyForMovie(record, { tmdb_id: 3, release_date: null })
  assertEquals(history?.average_rt, null)
})

Deno.test('historyForMovie: caps at the most recent prior films but counts them all', () => {
  const films = Array.from({ length: 12 }, (_, i) =>
    film(100 + i, `${1990 + i}-01-01`, 50 + i)
  )
  const history = historyForMovie({ ...SHREK, films }, { tmdb_id: 999, release_date: null })
  assertEquals(history?.entry_number, 13)
  assertEquals(history?.films.length, MAX_PRIOR_FILMS)
  assertEquals(history?.films[0].tmdb_id, 104)
  assertEquals(history?.last_rt, 61)
})
