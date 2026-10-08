/** Unit tests for the synthetic projection corpus used by tests and the backtest's fixture mode. */

import { assert, assertEquals } from '@std/assert'
import { effectiveUsDate } from './projection-features.ts'
import { syntheticCorpus } from './projection-synthetic.ts'

Deno.test('syntheticCorpus - deterministic for a seed, different across seeds', () => {
  const a = syntheticCorpus({ filmsPerYear: 20, seed: 5, firstYear: 2018, lastYear: 2020 })
  const b = syntheticCorpus({ filmsPerYear: 20, seed: 5, firstYear: 2018, lastYear: 2020 })
  const c = syntheticCorpus({ filmsPerYear: 20, seed: 6, firstYear: 2018, lastYear: 2020 })
  assertEquals(a, b)
  assert(JSON.stringify(a.films) !== JSON.stringify(c.films))
})

Deno.test('syntheticCorpus - well-formed rows with every film dated, credited and scored', () => {
  const { films, credits } = syntheticCorpus({ filmsPerYear: 30, firstYear: 2019, lastYear: 2020 })
  assertEquals(films.length, 60)
  const ids = new Set(films.map((f) => f.tmdb_id))
  assertEquals(ids.size, films.length)
  for (const film of films) {
    const date = effectiveUsDate(film)!
    assert(date >= '2019-01-01' && date <= '2020-12-31', date)
    assert(film.rt_critic! >= 0 && film.rt_critic! <= 100)
    assert(credits.some((c) => c.tmdb_id === film.tmdb_id && c.role === 'director'))
  }
  for (const credit of credits) assert(ids.has(credit.tmdb_id))
})

Deno.test('syntheticCorpus - films within the settle window are unsettled', () => {
  const { films } = syntheticCorpus({ filmsPerYear: 100, firstYear: 2020, lastYear: 2020, asOf: '2021-01-15' })
  const late = films.filter((f) => effectiveUsDate(f)! > '2020-11-16')
  assert(late.length > 0)
  assert(late.every((f) => f.rt_settled_at == null))
  assert(films.filter((f) => effectiveUsDate(f)! < '2020-10-01').every((f) => f.rt_settled_at != null))
})
