/**
 * Unit tests for projection feature building. Pure -- hand-built corpora, no
 * database. The leak tests matter most: a film's features must never see
 * itself or anything released on or after its effective US date.
 */

import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import {
  buildCorpusIndex,
  coverage,
  dayNumber,
  DEFAULT_SHRINKAGE,
  effectiveUsDate,
  FEATURE_KEYS,
  FEATURE_SPECS,
  featureVector,
  genreBaseline,
  genreMask,
  groupLabel,
  logit,
  logitToRt,
  rawFeatures,
  rtToLogit,
  shrinkFactor,
} from './projection-features.ts'
import type { CorpusCredit, CorpusFilm } from './projection-types.ts'

function film(tmdbId: number, date: string | null, overrides: Partial<CorpusFilm> = {}): CorpusFilm {
  return {
    tmdb_id: tmdbId,
    title: `Film ${tmdbId}`,
    release_date: date,
    us_wide_date: null,
    us_limited_date: null,
    us_release_type: 3,
    collection_id: null,
    genre_ids: [18],
    company_ids: [],
    label_id: null,
    festival_premiere: null,
    keyword_flags: [],
    original_language: 'en',
    budget: null,
    runtime: 105,
    certification: null,
    rt_critic: 60,
    rt_critic_votes: 100,
    rt_settled_at: '2030-01-01T00:00:00Z',
    ...overrides,
  }
}

const director = (tmdbId: number, person: number): CorpusCredit => ({ tmdb_id: tmdbId, tmdb_person_id: person, role: 'director', billing: null })
const cast = (tmdbId: number, person: number, billing: number): CorpusCredit => ({ tmdb_id: tmdbId, tmdb_person_id: person, role: 'cast', billing })
const valueOf = (vector: number[], key: string) => vector[FEATURE_KEYS.indexOf(key)]

Deno.test('effectiveUsDate - prefers the US wide date, then limited, then digital, then TMDb primary', () => {
  assertEquals(effectiveUsDate(film(1, '2020-01-01', { us_wide_date: '2020-03-01', us_limited_date: '2020-02-01' })), '2020-03-01')
  assertEquals(effectiveUsDate(film(1, '2020-01-01', { us_limited_date: '2020-02-01', us_digital_date: '2020-04-01' })), '2020-02-01')
  assertEquals(effectiveUsDate(film(1, '2020-01-01', { us_digital_date: '2020-04-01' })), '2020-04-01')
  assertEquals(effectiveUsDate(film(1, '2020-01-01')), '2020-01-01')
  assertEquals(effectiveUsDate(film(1, null)), null)
})

Deno.test('effectiveUsDate - the stored effective_release_date wins when the row carries it', () => {
  const stored = film(1, '2020-01-01', { us_wide_date: '2020-03-01', effective_release_date: '2020-05-01' })
  assertEquals(effectiveUsDate(stored), '2020-05-01')
  assertEquals(effectiveUsDate(film(1, '2020-01-01', { us_wide_date: '2020-03-01', effective_release_date: null })), '2020-03-01')
})

Deno.test('dayNumber - counts UTC days and ignores a time of day', () => {
  assertEquals(dayNumber('1970-01-02'), 1)
  assertEquals(dayNumber('2020-03-01T23:59:00Z'), dayNumber('2020-03-01'))
})

Deno.test('rtToLogit - smooths the share so 0% and 100% stay finite', () => {
  assert(Number.isFinite(rtToLogit(0, 40)))
  assert(Number.isFinite(rtToLogit(100, 40)))
  assertAlmostEquals(rtToLogit(50, 40), 0, 1e-12)
  // More reviews at the same score is stronger evidence: further from 50%.
  assert(rtToLogit(100, 300) > rtToLogit(100, 20))
  // No review count: treated as 100 reviews.
  assertEquals(rtToLogit(80, null), rtToLogit(80, 100))
})

Deno.test('logitToRt - inverts logit on the 0-100 scale', () => {
  assertAlmostEquals(logitToRt(logit(0.73)), 73, 1e-9)
  assertAlmostEquals(logitToRt(-800), 0, 1e-9)
  assertAlmostEquals(logitToRt(800), 100, 1e-9)
})

Deno.test('FEATURE_SPECS - keys are unique and every column has a group', () => {
  assertEquals(new Set(FEATURE_KEYS).size, FEATURE_KEYS.length)
  for (const spec of FEATURE_SPECS) assert(spec.group.length > 0)
})

Deno.test('genreBaseline - averages earlier same-genre films in the 3-year window, pulled toward all genres', () => {
  const films = [
    film(1, '2015-01-01', { genre_ids: [27], rt_critic: 90 }), // outside the window
    film(2, '2019-01-01', { genre_ids: [27], rt_critic: 30 }),
    film(3, '2019-06-01', { genre_ids: [18], rt_critic: 80 }),
    film(4, '2020-01-01', { genre_ids: [27], rt_critic: 99 }), // on the cutoff day: excluded
  ]
  const index = buildCorpusIndex(films, [])
  const horror = genreBaseline(index, genreMask([27]), dayNumber('2020-01-01'))
  const allMean = (rtToLogit(30, 100) + rtToLogit(80, 100)) / 2
  assertAlmostEquals(horror, (rtToLogit(30, 100) + 5 * allMean) / 6, 1e-12)
})

Deno.test('genreBaseline - an empty corpus starts from 60%', () => {
  const index = buildCorpusIndex([], [])
  assertAlmostEquals(logitToRt(genreBaseline(index, 1, 1000)), 60, 1e-9)
})

Deno.test('rawFeatures - a director track record uses only earlier films, most recent first', () => {
  const films = [
    film(1, '2015-01-01', { rt_critic: 90 }),
    film(2, '2017-01-01', { rt_critic: 40 }),
    film(10, '2020-01-01', { rt_critic: null }),
    film(3, '2021-01-01', { rt_critic: 100 }), // after the target: must not count
  ]
  const credits = [director(1, 7), director(2, 7), director(10, 7), director(3, 7)]
  const index = buildCorpusIndex(films, credits)
  const raw = rawFeatures(index, films[2])
  const record = raw.trackRecords.director!
  assertEquals(record.n, 2)
  // Film 2 is newer (weight 1), film 1 older (weight 0.8); deviations from their own baselines.
  const byId = index.byId
  const dev = (id: number) => byId.get(id)!.score! - byId.get(id)!.baseline
  assertAlmostEquals(record.mean, (dev(2) + 0.8 * dev(1)) / 1.8, 1e-12)
})

Deno.test('rawFeatures - a film released later cannot change an earlier film\'s features', () => {
  const base = [film(1, '2015-01-01', { rt_critic: 70 }), film(2, '2018-01-01', { rt_critic: null })]
  const credits = [director(1, 7), director(2, 7), cast(1, 50, 0), cast(2, 50, 0)]
  const before = rawFeatures(buildCorpusIndex(base, credits), base[1])
  const later = film(3, '2019-01-01', { rt_critic: 5 })
  const after = rawFeatures(
    buildCorpusIndex([...base, later], [...credits, director(3, 7), cast(3, 50, 0)]),
    base[1],
  )
  assertEquals(featureVector(after, DEFAULT_SHRINKAGE), featureVector(before, DEFAULT_SHRINKAGE))
  assertEquals(after.baseline, before.baseline)
})

Deno.test('rawFeatures - a film released the same day is not history', () => {
  const films = [film(1, '2018-01-01', { rt_critic: 95 }), film(2, '2018-01-01', { rt_critic: null })]
  const raw = rawFeatures(buildCorpusIndex(films, [director(1, 7), director(2, 7)]), films[1])
  assertEquals(raw.trackRecords.director, null)
})

Deno.test('rawFeatures - asOfDay simulates projecting from further out', () => {
  const films = [film(1, '2019-11-01', { rt_critic: 95 }), film(2, '2020-01-01', { rt_critic: null })]
  const index = buildCorpusIndex(films, [director(1, 7), director(2, 7)])
  assertEquals(rawFeatures(index, films[1]).trackRecords.director?.n, 1)
  assertEquals(rawFeatures(index, films[1], { asOfDay: dayNumber('2019-10-01') }).trackRecords.director, null)
})

Deno.test('rawFeatures - track records keep only the last 5 director films', () => {
  const films = Array.from({ length: 8 }, (_, i) => film(i + 1, `${2010 + i}-01-01`))
  const target = film(100, '2020-01-01', { rt_critic: null })
  const credits = [...films.map((f) => director(f.tmdb_id, 7)), director(100, 7)]
  const raw = rawFeatures(buildCorpusIndex([...films, target], credits), target)
  assertEquals(raw.trackRecords.director!.n, 5)
})

Deno.test('rawFeatures - the cast record pools the top three billed only', () => {
  const films = [film(1, '2015-01-01', { rt_critic: 90 }), film(2, '2016-01-01', { rt_critic: 20 })]
  const target = film(3, '2020-01-01', { rt_critic: null })
  const credits = [
    cast(1, 10, 0), // top-billed in target
    cast(2, 99, 0), // billed 4th in target: ignored
    cast(3, 10, 0),
    cast(3, 11, 1),
    cast(3, 12, 2),
    cast(3, 99, 3),
  ]
  const raw = rawFeatures(buildCorpusIndex([...films, target], credits), target)
  assertEquals(raw.trackRecords.cast!.n, 1)
})

Deno.test('rawFeatures - the "other" label and no label have no track record', () => {
  const films = [film(1, '2015-01-01', { label_id: 'other' }), film(2, '2016-01-01', { label_id: 'a24' })]
  const index = buildCorpusIndex(films, [])
  assertEquals(rawFeatures(index, film(3, '2020-01-01', { label_id: 'other' })).trackRecords.label, null)
  assertEquals(rawFeatures(index, film(3, '2020-01-01', { label_id: null })).trackRecords.label, null)
  assertEquals(rawFeatures(index, film(3, '2020-01-01', { label_id: 'a24' })).trackRecords.label?.n, 1)
})

Deno.test('rawFeatures - franchise terms: last entry, trend, years since, reboot', () => {
  const films = [
    film(1, '2000-06-01', { collection_id: 9, rt_critic: 90 }),
    film(2, '2004-06-01', { collection_id: 9, rt_critic: 60 }),
    film(3, '2006-06-01', { collection_id: 9, rt_critic: null }), // unscored, still the latest entry
  ]
  const target = film(4, '2018-06-01', { collection_id: 9, rt_critic: null })
  const index = buildCorpusIndex([...films, target], [])
  const raw = rawFeatures(index, target)
  const dev = (id: number) => index.byId.get(id)!.score! - index.byId.get(id)!.baseline
  assertEquals(raw.franchise.entries, 2)
  assertAlmostEquals(raw.franchise.last!, dev(2), 1e-12)
  assertAlmostEquals(raw.franchise.trend!, dev(2) - dev(1), 1e-12)
  assertAlmostEquals(raw.franchise.yearsSince!, 12, 0.01)
  const vector = featureVector(raw, DEFAULT_SHRINKAGE)
  assertEquals(valueOf(vector, 'franchise_reboot'), 1)
  assertEquals(valueOf(vector, 'franchise_no_history'), 0)
})

Deno.test('rawFeatures - a franchise\'s first film is flagged as having no history', () => {
  const target = film(1, '2018-06-01', { collection_id: 9, rt_critic: null })
  const vector = featureVector(rawFeatures(buildCorpusIndex([target], []), target), DEFAULT_SHRINKAGE)
  assertEquals(valueOf(vector, 'franchise_no_history'), 1)
  assertEquals(valueOf(vector, 'franchise_last'), 0)
})

Deno.test('featureVector - a factor with no films is exactly 0 plus its missing flag', () => {
  const target = film(1, '2020-01-01', { rt_critic: null })
  const vector = featureVector(rawFeatures(buildCorpusIndex([target], []), target), DEFAULT_SHRINKAGE)
  assertEquals(vector.length, FEATURE_KEYS.length)
  for (const factor of ['director', 'writers', 'cast', 'label']) {
    assertEquals(valueOf(vector, `${factor}_dev`), 0)
    assertEquals(valueOf(vector, `${factor}_missing`), 1)
  }
})

Deno.test('featureVector - shrinks a track record by n / (n + k)', () => {
  const films = [film(1, '2015-01-01', { rt_critic: 95 }), film(2, '2020-01-01', { rt_critic: null })]
  const raw = rawFeatures(buildCorpusIndex(films, [director(1, 7), director(2, 7)]), films[1])
  const mean = raw.trackRecords.director!.mean
  assertAlmostEquals(valueOf(featureVector(raw, { ...DEFAULT_SHRINKAGE, director: 1 }), 'director_dev'), mean / 2, 1e-12)
  assertAlmostEquals(valueOf(featureVector(raw, { ...DEFAULT_SHRINKAGE, director: 3 }), 'director_dev'), mean / 4, 1e-12)
  assertEquals(shrinkFactor(5, 5), 0.5)
})

Deno.test('featureVector - plain features: festival, window, keywords, genres, runtime, rating, budget, release, language', () => {
  const target = film(1, '2020-11-15', {
    festival_premiere: 'venice',
    keyword_flags: ['adaptation', 'true_story'],
    genre_ids: [18, 36],
    runtime: 135,
    certification: 'pg-13',
    budget: 30_000_000 * Math.E,
    us_release_type: 4,
    original_language: 'ko',
    rt_critic: null,
  })
  const v = featureVector(rawFeatures(buildCorpusIndex([target], []), target), DEFAULT_SHRINKAGE)
  assertEquals(valueOf(v, 'festival_venice'), 1)
  assertEquals(valueOf(v, 'festival_cannes'), 0)
  assertEquals(valueOf(v, 'window_oct_dec'), 1)
  assertEquals(valueOf(v, 'window_summer'), 0)
  assertEquals(valueOf(v, 'kw_adaptation'), 1)
  assertEquals(valueOf(v, 'kw_true_story'), 1)
  assertEquals(valueOf(v, 'kw_sequel'), 0)
  assertEquals(valueOf(v, 'genre_18'), 1)
  assertEquals(valueOf(v, 'genre_36'), 1)
  assertEquals(valueOf(v, 'genre_27'), 0)
  assertAlmostEquals(valueOf(v, 'runtime'), 1, 1e-12)
  assertEquals(valueOf(v, 'runtime_missing'), 0)
  assertEquals(valueOf(v, 'mpaa_pg13'), 1)
  assertAlmostEquals(valueOf(v, 'log_budget'), 1, 1e-9)
  assertEquals(valueOf(v, 'budget_missing'), 0)
  assertEquals(valueOf(v, 'release_digital'), 1)
  assertEquals(valueOf(v, 'release_wide'), 0)
  assertEquals(valueOf(v, 'non_english'), 1)
})

Deno.test('featureVector - unknown runtime and budget are 0 with a missing flag', () => {
  const target = film(1, '2020-04-01', { runtime: null, budget: 0, rt_critic: null })
  const v = featureVector(rawFeatures(buildCorpusIndex([target], []), target), DEFAULT_SHRINKAGE)
  assertEquals(valueOf(v, 'runtime'), 0)
  assertEquals(valueOf(v, 'runtime_missing'), 1)
  assertEquals(valueOf(v, 'log_budget'), 0)
  assertEquals(valueOf(v, 'budget_missing'), 1)
  // April is in no release window.
  assertEquals(valueOf(v, 'window_jan_feb') + valueOf(v, 'window_summer') + valueOf(v, 'window_oct_dec'), 0)
})

Deno.test('coverage - 0 with no history, rising with evidence; franchise only counts for franchise films', () => {
  const lone = film(1, '2020-01-01', { rt_critic: null })
  assertEquals(coverage(rawFeatures(buildCorpusIndex([lone], []), lone), DEFAULT_SHRINKAGE), 0)

  const history = Array.from({ length: 5 }, (_, i) => film(i + 10, `${2012 + i}-01-01`))
  const target = film(2, '2020-01-01', { rt_critic: null })
  const credits = [...history.map((f) => director(f.tmdb_id, 7)), director(2, 7)]
  const index = buildCorpusIndex([...history, target], credits)
  const directorOnly = coverage(rawFeatures(index, target), DEFAULT_SHRINKAGE)
  assertAlmostEquals(directorOnly, 0.4 * (5 / 8), 1e-12)
  const franchiseFilm = { ...target, collection_id: 77 }
  // A franchise film with no earlier entries has more to know, so lower coverage.
  assert(coverage(rawFeatures(index, franchiseFilm), DEFAULT_SHRINKAGE) < directorOnly)
})

Deno.test('groupLabel - names factors for explanations', () => {
  const target = film(1, '2020-01-20', { festival_premiere: 'sundance', certification: 'R', runtime: 128, rt_critic: null })
  const raw = rawFeatures(buildCorpusIndex([target], []), target)
  assertEquals(groupLabel('director', raw), 'Director (no track record)')
  assertEquals(groupLabel('festival', raw), 'Sundance premiere')
  assertEquals(groupLabel('release_window', raw), 'January–February release')
  assertEquals(groupLabel('mpaa', raw), 'Rated R')
  assertEquals(groupLabel('runtime', raw), 'Runtime (128 min)')
  assertEquals(groupLabel('budget', raw), 'Budget unknown')
  assertEquals(groupLabel('kw_true_story', raw), 'Based on a true story')
  assertEquals(groupLabel('release_type', raw), 'Wide release')
})
