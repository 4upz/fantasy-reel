/**
 * Feature building for the projection model: turns `film_corpus` /
 * `film_credits` rows into one feature vector per film.
 *
 * Every track-record input is computed only from films released strictly
 * before the target's effective US release date (or an earlier `asOfDay`, to
 * simulate projecting further ahead), so a film's features never see its own
 * outcome or anything later. A film's features therefore do not depend on
 * which year a backtest is predicting, and are built once per lead time.
 *
 * Scale: scores are modelled as the logit of the Tomatometer share. Each
 * track-record factor is a recency-weighted mean of earlier films' deviations
 * from their own genre baseline, shrunk by n / (n + k) with a per-factor k; a
 * factor with no films is exactly 0 plus a missing flag.
 *
 * Pure: no I/O, no Supabase.
 */

import type { CorpusCredit, CorpusFilm } from './projection-types.ts'

export const DAY_MS = 86_400_000
const DAYS_PER_YEAR = 365.25

// ---------------------------------------------------------------------------
// Dates and scale
// ---------------------------------------------------------------------------

/** Effective US release date: wide, else limited, else TMDb's primary date. */
export function effectiveUsDate(film: CorpusFilm): string | null {
  return film.us_wide_date ?? film.us_limited_date ?? film.release_date
}

/** Whole UTC days since the epoch for an ISO date (time of day ignored). */
export function dayNumber(isoDate: string): number {
  const ms = Date.parse(isoDate.slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(ms)) throw new Error(`invalid date: ${isoDate}`)
  return Math.round(ms / DAY_MS)
}

export function logit(p: number): number {
  return Math.log(p / (1 - p))
}

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))
}

/** Assumed review count when RT reports none, for smoothing only. */
const ASSUMED_REVIEW_COUNT = 100

/**
 * The model's target: logit of the smoothed positive share,
 * (k + 0.5) / (n + 1) with k = rt% of n reviews. Smoothing keeps 0% and 100%
 * finite, and pulls thinly reviewed scores toward the middle.
 */
export function rtToLogit(rt: number, reviews: number | null): number {
  const n = reviews != null && reviews > 0 ? reviews : ASSUMED_REVIEW_COUNT
  const positive = (Math.min(100, Math.max(0, rt)) / 100) * n
  return logit((positive + 0.5) / (n + 1))
}

/** Tomatometer (0-100) for a logit-scale score. */
export function logitToRt(z: number): number {
  return 100 * sigmoid(z)
}

// ---------------------------------------------------------------------------
// Feature catalogue
// ---------------------------------------------------------------------------

export const SHRUNK_FACTORS = ['director', 'writers', 'cast', 'label'] as const
export type ShrunkFactor = typeof SHRUNK_FACTORS[number]
export type Shrinkage = Record<ShrunkFactor, number>

export const DEFAULT_SHRINKAGE: Readonly<Shrinkage> = { director: 3, writers: 3, cast: 3, label: 3 }

/** How many earlier films each track record averages, and how fast older ones fade. */
const TRACK_RECORD: Record<ShrunkFactor, { films: number; decay: number }> = {
  director: { films: 5, decay: 0.8 },
  writers: { films: 5, decay: 0.8 },
  cast: { films: 8, decay: 0.85 },
  label: { films: 20, decay: 0.9 },
}

/** Weights of each factor in `coverage`; franchise counts only for franchise films. */
const COVERAGE_WEIGHTS = { director: 0.4, writers: 0.2, cast: 0.25, label: 0.15, franchise: 0.2 }

const TOP_BILLED_CAST = 3
const GENRE_WINDOW_YEARS = 3
/** Pseudo-count pulling a thin genre baseline toward the all-genre average. */
const GENRE_BASELINE_PRIOR = 5
/** Starting point before any film is known: a 60% Tomatometer. */
const EMPTY_CORPUS_LOGIT = logit(0.6)
const REBOOT_GAP_YEARS = 10

export const FESTIVALS: Readonly<Record<string, string>> = {
  cannes: 'Cannes',
  venice: 'Venice',
  tiff: 'TIFF',
  sundance: 'Sundance',
  berlin: 'Berlin',
  telluride: 'Telluride',
  sxsw: 'SXSW',
}

export const KEYWORDS: Readonly<Record<string, string>> = {
  adaptation: 'Adaptation',
  remake: 'Remake',
  sequel: 'Sequel',
  true_story: 'Based on a true story',
}

/** TMDb movie genres. */
export const GENRES: Readonly<Record<number, string>> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}
const GENRE_IDS = Object.keys(GENRES).map(Number)
const GENRE_BIT = new Map(GENRE_IDS.map((id, i) => [id, 1 << i]))

const RATINGS = ['G', 'PG', 'PG-13', 'R', 'NC-17'] as const

const RELEASE_WINDOWS = {
  jan_feb: { months: [1, 2], label: 'January–February release' },
  summer: { months: [5, 6, 7, 8], label: 'Summer release' },
  oct_dec: { months: [10, 11, 12], label: 'October–December release' },
} as const

const REFERENCE_RUNTIME = 105
const REFERENCE_BUDGET = 30_000_000
const MIN_KNOWN_BUDGET = 100_000

/** A feature column. `group` is the factor its term is credited to in explanations. */
export interface FeatureSpec {
  key: string
  group: string
}

const TRACK_RECORD_SPECS: FeatureSpec[] = SHRUNK_FACTORS.flatMap((factor) => [
  { key: `${factor}_dev`, group: factor },
  { key: `${factor}_missing`, group: factor },
])

const FRANCHISE_SPECS: FeatureSpec[] = [
  'franchise_last',
  'franchise_trend',
  'franchise_years',
  'franchise_reboot',
  'franchise_no_history',
].map((key) => ({ key, group: 'franchise' }))

const PLAIN_SPECS: FeatureSpec[] = [
  ...Object.keys(FESTIVALS).map((f) => ({ key: `festival_${f}`, group: 'festival' })),
  ...Object.keys(RELEASE_WINDOWS).map((w) => ({ key: `window_${w}`, group: 'release_window' })),
  ...Object.keys(KEYWORDS).map((k) => ({ key: `kw_${k}`, group: `kw_${k}` })),
  ...GENRE_IDS.map((id) => ({ key: `genre_${id}`, group: 'genres' })),
  { key: 'runtime', group: 'runtime' },
  { key: 'runtime_missing', group: 'runtime' },
  ...RATINGS.map((r) => ({ key: `mpaa_${r.toLowerCase().replace('-', '')}`, group: 'mpaa' })),
  { key: 'log_budget', group: 'budget' },
  { key: 'budget_missing', group: 'budget' },
  { key: 'release_wide', group: 'release_type' },
  { key: 'release_digital', group: 'release_type' },
  { key: 'non_english', group: 'language' },
]

/** Every model column, in vector order. */
export const FEATURE_SPECS: readonly FeatureSpec[] = [...TRACK_RECORD_SPECS, ...FRANCHISE_SPECS, ...PLAIN_SPECS]
export const FEATURE_KEYS: readonly string[] = FEATURE_SPECS.map((s) => s.key)

// ---------------------------------------------------------------------------
// Corpus index
// ---------------------------------------------------------------------------

interface IndexedFilm {
  film: CorpusFilm
  day: number
  genreMask: number
  /** Logit target, when the film has a Tomatometer. */
  score: number | null
  /** Genre baseline as of the film's own release, for its deviation. */
  baseline: number
}

/** Everything feature building looks up, built once per corpus. */
export interface CorpusIndex {
  byId: Map<number, IndexedFilm>
  /** Films with a date and a Tomatometer, by release day. */
  scored: IndexedFilm[]
  scoredDays: number[]
  /** Scored films per `${role}:${person}`, by release day. */
  byPerson: Map<string, IndexedFilm[]>
  /** Every dated entry per collection (scored or not), by release day. */
  byCollection: Map<number, IndexedFilm[]>
  /** Scored films per curated label (never 'other'), by release day. */
  byLabel: Map<string, IndexedFilm[]>
  creditsByFilm: Map<number, CorpusCredit[]>
}

/** Bitmask of the TMDb genres, for "shares any genre" checks. */
export function genreMask(genreIds: readonly number[]): number {
  let mask = 0
  for (const id of genreIds) mask |= GENRE_BIT.get(id) ?? 0
  return mask
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** First index whose day is >= `day` in a list ascending by `dayOf`. */
function lowerBound<T>(list: readonly T[], day: number, dayOf: (item: T) => number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (dayOf(list[mid]) < day) lo = mid + 1
    else hi = mid
  }
  return lo
}

const identity = (day: number) => day
const filmDay = (f: IndexedFilm) => f.day

function isCuratedLabel(label: string | null): label is string {
  return label != null && label !== '' && label !== 'other'
}

/** Builds the lookup structures feature building needs. Films without any date are kept only for credits. */
export function buildCorpusIndex(films: readonly CorpusFilm[], credits: readonly CorpusCredit[]): CorpusIndex {
  const byId = new Map<number, IndexedFilm>()
  for (const film of films) {
    const date = effectiveUsDate(film)
    if (!date) continue
    byId.set(film.tmdb_id, {
      film,
      day: dayNumber(date),
      genreMask: genreMask(film.genre_ids),
      score: film.rt_critic == null ? null : rtToLogit(film.rt_critic, film.rt_critic_votes),
      baseline: 0,
    })
  }
  const dated = [...byId.values()].sort((a, b) => a.day - b.day || a.film.tmdb_id - b.film.tmdb_id)
  const scored = dated.filter((f) => f.score != null)
  const index: CorpusIndex = {
    byId,
    scored,
    scoredDays: scored.map((f) => f.day),
    byPerson: new Map(),
    byCollection: new Map(),
    byLabel: new Map(),
    creditsByFilm: new Map(),
  }
  for (const f of scored) f.baseline = genreBaseline(index, f.genreMask, f.day)

  for (const credit of credits) pushTo(index.creditsByFilm, credit.tmdb_id, credit)
  for (const f of dated) {
    if (f.film.collection_id != null) pushTo(index.byCollection, f.film.collection_id, f)
    if (f.score == null) continue
    if (isCuratedLabel(f.film.label_id)) pushTo(index.byLabel, f.film.label_id, f)
    const seen = new Set<string>()
    for (const credit of index.creditsByFilm.get(f.film.tmdb_id) ?? []) {
      const key = `${credit.role}:${credit.tmdb_person_id}`
      if (seen.has(key)) continue
      seen.add(key)
      pushTo(index.byPerson, key, f)
    }
  }
  return index
}

/**
 * Genre baseline b: the mean logit score of films sharing any of the genres,
 * released in the 3 years before `asOfDay`, pulled toward the all-genre mean
 * of that window by a few pseudo-films so a thin genre doesn't swing it.
 */
export function genreBaseline(index: CorpusIndex, mask: number, asOfDay: number): number {
  const hi = lowerBound(index.scoredDays, asOfDay, identity)
  if (hi === 0) return EMPTY_CORPUS_LOGIT
  const lo = lowerBound(index.scoredDays, asOfDay - Math.round(GENRE_WINDOW_YEARS * DAYS_PER_YEAR), identity)
  let sumAll = 0
  let sumShared = 0
  let shared = 0
  for (let i = lo; i < hi; i++) {
    const f = index.scored[i]
    sumAll += f.score!
    if (f.genreMask & mask) {
      sumShared += f.score!
      shared++
    }
  }
  const windowCount = hi - lo
  // A window with nothing in it falls back to the latest film before it.
  const allMean = windowCount > 0 ? sumAll / windowCount : index.scored[hi - 1].score!
  return (sumShared + GENRE_BASELINE_PRIOR * allMean) / (shared + GENRE_BASELINE_PRIOR)
}

// ---------------------------------------------------------------------------
// Raw features
// ---------------------------------------------------------------------------

/** A track record before shrinkage: recency-weighted mean deviation over `n` films. */
export interface TrackRecord {
  mean: number
  n: number
}

export interface FranchiseHistory {
  /** The film is in a TMDb collection. */
  applicable: boolean
  /** Scored earlier entries. */
  entries: number
  /** Last scored entry's deviation from its genre baseline. */
  last: number | null
  /** Last entry minus the mean of the entries before it (2+ entries). */
  trend: number | null
  /** Years from the latest earlier entry (scored or not) to this film. */
  yearsSince: number | null
}

/**
 * Features before per-factor shrinkage: everything the model needs about one
 * film, at one lead time. `featureVector` turns it into a model row.
 */
export interface RawFeatures {
  tmdb_id: number
  /** Effective US release day, or null when the film has no date. */
  day: number | null
  /** Genre baseline b (logit). */
  baseline: number
  trackRecords: Record<ShrunkFactor, TrackRecord | null>
  franchise: FranchiseHistory
  /** Columns after the track-record and franchise ones, in `FEATURE_SPECS` order. */
  plain: number[]
  /** For explanation labels. */
  context: {
    festival: string | null
    certification: string | null
    runtime: number | null
    releaseType: number | null
    budgetKnown: boolean
  }
}

/** Pooled, de-duplicated, most-recent-first track record over several lists. */
function trackRecord(
  lists: Array<IndexedFilm[] | undefined>,
  asOfDay: number,
  excludeId: number,
  factor: ShrunkFactor,
): TrackRecord | null {
  const { films, decay } = TRACK_RECORD[factor]
  const pooled = new Map<number, IndexedFilm>()
  for (const list of lists) {
    if (!list) continue
    // Lists are ascending by day: walk back from the cutoff and stop once
    // this list alone has contributed enough films.
    let taken = 0
    for (let i = lowerBound(list, asOfDay, filmDay) - 1; i >= 0 && taken < films; i--) {
      const f = list[i]
      if (f.film.tmdb_id === excludeId) continue
      pooled.set(f.film.tmdb_id, f)
      taken++
    }
  }
  if (pooled.size === 0) return null
  const recent = [...pooled.values()]
    .sort((a, b) => b.day - a.day || b.film.tmdb_id - a.film.tmdb_id)
    .slice(0, films)
  let weighted = 0
  let weights = 0
  recent.forEach((f, rank) => {
    const w = decay ** rank
    weighted += w * (f.score! - f.baseline)
    weights += w
  })
  return { mean: weighted / weights, n: recent.length }
}

function franchiseHistory(index: CorpusIndex, film: CorpusFilm, asOfDay: number, releaseDay: number): FranchiseHistory {
  if (film.collection_id == null) {
    return { applicable: false, entries: 0, last: null, trend: null, yearsSince: null }
  }
  const earlier = (index.byCollection.get(film.collection_id) ?? [])
    .filter((f) => f.day < asOfDay && f.film.tmdb_id !== film.tmdb_id)
  const scored = earlier.filter((f) => f.score != null)
  const deviations = scored.map((f) => f.score! - f.baseline)
  const last = deviations.length > 0 ? deviations[deviations.length - 1] : null
  const before = deviations.slice(0, -1)
  const trend = last != null && before.length > 0
    ? last - before.reduce((a, b) => a + b, 0) / before.length
    : null
  const latest = earlier[earlier.length - 1]
  return {
    applicable: true,
    entries: scored.length,
    last,
    trend,
    yearsSince: latest ? Math.max(0, (releaseDay - latest.day) / DAYS_PER_YEAR) : null,
  }
}

function plainFeatures(film: CorpusFilm, releaseDay: number | null): number[] {
  const month = releaseDay == null ? null : new Date(releaseDay * DAY_MS).getUTCMonth() + 1
  const keywords = new Set(film.keyword_flags)
  const genres = new Set(film.genre_ids)
  const rating = film.certification?.trim().toUpperCase() ?? null
  const knownBudget = film.budget != null && film.budget >= MIN_KNOWN_BUDGET
  const flag = (on: boolean) => (on ? 1 : 0)
  return [
    ...Object.keys(FESTIVALS).map((f) => flag(film.festival_premiere === f)),
    ...Object.values(RELEASE_WINDOWS).map((w) => flag(month != null && (w.months as readonly number[]).includes(month))),
    ...Object.keys(KEYWORDS).map((k) => flag(keywords.has(k))),
    ...GENRE_IDS.map((id) => flag(genres.has(id))),
    film.runtime != null && film.runtime > 0 ? (film.runtime - REFERENCE_RUNTIME) / 30 : 0,
    flag(film.runtime == null || film.runtime <= 0),
    ...RATINGS.map((r) => flag(rating === r)),
    knownBudget ? Math.log(film.budget! / REFERENCE_BUDGET) : 0,
    flag(!knownBudget),
    flag(film.us_release_type === 3),
    flag(film.us_release_type === 4),
    flag(film.original_language != null && film.original_language !== 'en'),
  ]
}

export interface RawFeatureOptions {
  /**
   * Only films released before this day count. Defaults to the film's own
   * effective release day; pass an earlier day to project from further out.
   */
  asOfDay?: number
  /** Credits for a film not in the index (a league movie fetched live). */
  credits?: readonly CorpusCredit[]
}

/** Raw features for one film, from earlier films in the index only. */
export function rawFeatures(index: CorpusIndex, film: CorpusFilm, options: RawFeatureOptions = {}): RawFeatures {
  const date = effectiveUsDate(film)
  const releaseDay = date ? dayNumber(date) : null
  const latestKnown = index.scoredDays.length > 0 ? index.scoredDays[index.scoredDays.length - 1] + 1 : 0
  const asOfDay = Math.min(options.asOfDay ?? Infinity, releaseDay ?? latestKnown)
  const credits = options.credits ?? index.creditsByFilm.get(film.tmdb_id) ?? []
  const people = (role: CorpusCredit['role'], list: readonly CorpusCredit[]) =>
    list.map((c) => index.byPerson.get(`${role}:${c.tmdb_person_id}`))
  const topCast = credits
    .filter((c) => c.role === 'cast')
    .sort((a, b) => (a.billing ?? Infinity) - (b.billing ?? Infinity))
    .slice(0, TOP_BILLED_CAST)

  return {
    tmdb_id: film.tmdb_id,
    day: releaseDay,
    baseline: genreBaseline(index, genreMask(film.genre_ids), asOfDay),
    trackRecords: {
      director: trackRecord(people('director', credits.filter((c) => c.role === 'director')), asOfDay, film.tmdb_id, 'director'),
      writers: trackRecord(people('writer', credits.filter((c) => c.role === 'writer')), asOfDay, film.tmdb_id, 'writers'),
      cast: trackRecord(people('cast', topCast), asOfDay, film.tmdb_id, 'cast'),
      label: isCuratedLabel(film.label_id)
        ? trackRecord([index.byLabel.get(film.label_id)], asOfDay, film.tmdb_id, 'label')
        : null,
    },
    franchise: franchiseHistory(index, film, asOfDay, releaseDay ?? asOfDay),
    plain: plainFeatures(film, releaseDay),
    context: {
      festival: film.festival_premiere,
      certification: film.certification,
      runtime: film.runtime,
      releaseType: film.us_release_type,
      budgetKnown: film.budget != null && film.budget >= MIN_KNOWN_BUDGET,
    },
  }
}

/** n / (n + k): how much of a track record's mean the model believes. */
export function shrinkFactor(n: number, k: number): number {
  return n / (n + k)
}

/** The model row for a film: shrunk track records, franchise terms, then plain features. */
export function featureVector(raw: RawFeatures, shrinkage: Shrinkage): number[] {
  const values: number[] = []
  for (const factor of SHRUNK_FACTORS) {
    const record = raw.trackRecords[factor]
    values.push(record ? shrinkFactor(record.n, shrinkage[factor]) * record.mean : 0, record ? 0 : 1)
  }
  const f = raw.franchise
  values.push(
    f.last ?? 0,
    f.trend ?? 0,
    f.yearsSince == null ? 0 : Math.min(f.yearsSince, 20) / 10,
    f.yearsSince != null && f.yearsSince >= REBOOT_GAP_YEARS ? 1 : 0,
    f.applicable && f.entries === 0 ? 1 : 0,
    ...raw.plain,
  )
  return values
}

/**
 * Coverage 0..1: how much track-record evidence the projection rests on, as
 * the weighted mean of each factor's shrink factor. Franchise counts only for
 * franchise films, so an original film is not penalized for having none.
 */
export function coverage(raw: RawFeatures, shrinkage: Shrinkage): number {
  let weighted = 0
  let total = 0
  for (const factor of SHRUNK_FACTORS) {
    const record = raw.trackRecords[factor]
    weighted += COVERAGE_WEIGHTS[factor] * (record ? shrinkFactor(record.n, shrinkage[factor]) : 0)
    total += COVERAGE_WEIGHTS[factor]
  }
  if (raw.franchise.applicable) {
    weighted += COVERAGE_WEIGHTS.franchise * Math.min(1, raw.franchise.entries / 2)
    total += COVERAGE_WEIGHTS.franchise
  }
  return weighted / total
}

/** The user-facing label for a factor group's term, given the film it explains. */
export function groupLabel(group: string, raw: RawFeatures): string {
  const missing = (factor: ShrunkFactor) => raw.trackRecords[factor] == null
  switch (group) {
    case 'director':
      return missing('director') ? 'Director (no track record)' : 'Director'
    case 'writers':
      return missing('writers') ? 'Writers (no track record)' : 'Writers'
    case 'cast':
      return missing('cast') ? 'Cast (no track record)' : 'Cast'
    case 'label':
      return missing('label') ? 'Distributor (no track record)' : 'Distributor'
    case 'franchise':
      return raw.franchise.entries === 0 ? 'Franchise (no earlier entries)' : 'Franchise'
    case 'festival':
      return `${FESTIVALS[raw.context.festival ?? ''] ?? 'Festival'} premiere`
    case 'release_window': {
      const month = raw.day == null ? null : new Date(raw.day * DAY_MS).getUTCMonth() + 1
      const window = Object.values(RELEASE_WINDOWS).find((w) => month != null && (w.months as readonly number[]).includes(month))
      return window?.label ?? 'Release month'
    }
    case 'genres':
      return 'Genre mix'
    case 'runtime':
      return raw.context.runtime ? `Runtime (${raw.context.runtime} min)` : 'Runtime unknown'
    case 'mpaa':
      return raw.context.certification ? `Rated ${raw.context.certification.trim().toUpperCase()}` : 'Rating'
    case 'budget':
      return raw.context.budgetKnown ? 'Budget' : 'Budget unknown'
    case 'release_type':
      return raw.context.releaseType === 4 ? 'Digital premiere' : 'Wide release'
    case 'language':
      return 'Non-English language'
    default:
      return group.startsWith('kw_') ? KEYWORDS[group.slice(3)] ?? group : group
  }
}
