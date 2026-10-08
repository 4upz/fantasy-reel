/**
 * TMDb fetchers and pure mappers for the historical film corpus
 * (film_corpus / film_people / film_credits / film_collections).
 *
 * These payloads are consumed once and persisted, so they bypass tmdb_cache
 * and call `tmdbGetJson` directly. Every network function returns plain data
 * shaped for the corpus tables; the mappers are exported so they can be
 * tested without HTTP.
 */
import { tmdbGetJson, TMDbApiError } from './tmdb.ts'
import { labelForCompanies } from './film-labels.ts'

const TMDB = 'https://api.themoviedb.org/3'

/** Crew jobs that count as "writer" for the writer factor. */
const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Story'])
/** Cast billed below this order are stored as credits. */
const STORED_CAST_LIMIT = 5
/** Cast billed below this order are "leads" whose prior films are expanded. */
export const LEAD_CAST_LIMIT = 3

/** US release types the corpus samples: 2 limited, 3 wide theatrical, 4 digital premiere. */
export const CORPUS_RELEASE_TYPES = [2, 3, 4] as const
/** Seed rules: features a league could actually draft, minus junk rows. */
export const MIN_RUNTIME_MINUTES = 70

export type SeedSource = 'discover' | 'person' | 'collection' | 'league' | 'wishlist'

export interface CorpusStub {
  tmdb_id: number
  title: string
  release_date: string | null
  vote_count: number | null
  seed_source: SeedSource
  priority: number
}

export interface CorpusPerson {
  tmdb_person_id: number
  name: string
  role: 'director' | 'writer' | 'cast'
  billing: number | null
}

export type KeywordFlag = 'adaptation' | 'remake' | 'sequel' | 'true_story'

export interface CorpusMetadata {
  tmdb_id: number
  title: string
  release_date: string | null
  us_wide_date: string | null
  us_limited_date: string | null
  us_digital_date: string | null
  festival_premiere: string | null
  keyword_flags: KeywordFlag[]
  label_id: string | null
  original_language: string | null
  collection_id: number | null
  collection_name: string | null
  genre_ids: number[]
  company_ids: number[]
  budget: number | null
  runtime: number | null
  certification: string | null
  us_release_type: number | null
  vote_average: number | null
  vote_count: number | null
  people: CorpusPerson[]
}

interface TMDbReleaseDate {
  type: number
  release_date: string
  certification: string
  note?: string
}

export interface TMDbReleaseDates {
  results: Array<{ iso_3166_1: string; release_dates: TMDbReleaseDate[] }>
}

/** The `/movie/{id}?append_to_response=credits,release_dates,keywords` payload, the parts we read. */
export interface TMDbCorpusDetails {
  id: number
  title: string
  release_date?: string | null
  original_language?: string | null
  budget?: number | null
  runtime?: number | null
  vote_average?: number | null
  vote_count?: number | null
  belongs_to_collection?: { id: number; name: string } | null
  genres?: Array<{ id: number; name: string }>
  production_companies?: Array<{ id: number; name: string }>
  credits?: {
    cast?: Array<{ id: number; name: string; order: number }>
    crew?: Array<{ id: number; name: string; job: string }>
  }
  release_dates?: TMDbReleaseDates
  keywords?: { keywords?: Array<{ id: number; name: string }> }
}

interface TMDbListMovie {
  id: number
  title: string
  release_date?: string | null
  vote_count?: number | null
}

function stub(m: TMDbListMovie, seed_source: SeedSource, priority: number): CorpusStub {
  return {
    tmdb_id: m.id,
    title: m.title,
    release_date: m.release_date || null,
    vote_count: typeof m.vote_count === 'number' ? m.vote_count : null,
    seed_source,
    priority,
  }
}

function usReleases(releaseDates: TMDbReleaseDates | undefined): TMDbReleaseDate[] {
  return releaseDates?.results.find((r) => r.iso_3166_1 === 'US')?.release_dates ?? []
}

/** Wide (3) beats limited (2) beats digital (4); any other US type as-is; null when no US entry. */
export function usReleaseType(releaseDates: TMDbReleaseDates | undefined): number | null {
  const types = usReleases(releaseDates).map((r) => r.type)
  return [3, 2, 4].find((t) => types.includes(t)) ?? types[0] ?? null
}

/** Earliest US date (YYYY-MM-DD) of one release type, or null. */
function earliestUsDate(releaseDates: TMDbReleaseDates | undefined, type: number): string | null {
  const dates = usReleases(releaseDates)
    .filter((r) => r.type === type && r.release_date)
    .map((r) => r.release_date.slice(0, 10))
    .sort()
  return dates[0] ?? null
}

function usCertification(releaseDates: TMDbReleaseDates | undefined): string | null {
  return usReleases(releaseDates).find((r) => r.certification)?.certification || null
}

/** Festival keys and the TMDb release-date note patterns that name them. */
const FESTIVALS: ReadonlyArray<readonly [string, RegExp]> = [
  ['cannes', /cannes/i],
  ['venice', /venice|venezia/i],
  ['tiff', /toronto international film festival|\btiff\b/i],
  ['sundance', /sundance/i],
  ['berlin', /berlin|berlinale/i],
  ['telluride', /telluride/i],
  ['sxsw', /sxsw|south by southwest/i],
]

/**
 * The festival a film premiered at before its US release, from any
 * country's release-date notes ("Cannes Film Festival", "Sundance"...).
 * The earliest matching festival screening wins; one on or after the US
 * release date is a later stop, not a premiere, and is ignored.
 */
export function festivalPremiere(releaseDates: TMDbReleaseDates | undefined, usDate: string | null): string | null {
  let earliest: { key: string; date: string } | null = null
  for (const country of releaseDates?.results ?? []) {
    for (const r of country.release_dates) {
      if (!r.note || !r.release_date) continue
      const date = r.release_date.slice(0, 10)
      if (usDate && date >= usDate) continue
      const key = FESTIVALS.find(([, pattern]) => pattern.test(r.note!))?.[0]
      if (key && (!earliest || date < earliest.date)) earliest = { key, date }
    }
  }
  return earliest?.key ?? null
}

const TRUE_STORY_KEYWORDS = new Set(['based on true story', 'based on real person', 'biography', 'true story'])

/** Pre-release content flags from TMDb keywords, in a fixed order. */
export function keywordFlags(keywords: ReadonlyArray<{ name: string }>): KeywordFlag[] {
  const names = keywords.map((k) => k.name.trim().toLowerCase())
  const flags: KeywordFlag[] = []
  if (names.some((n) => n.startsWith('based on ') && !TRUE_STORY_KEYWORDS.has(n))) flags.push('adaptation')
  if (names.includes('remake')) flags.push('remake')
  if (names.includes('sequel')) flags.push('sequel')
  if (names.some((n) => TRUE_STORY_KEYWORDS.has(n))) flags.push('true_story')
  return flags
}

export function toCorpusMetadata(d: TMDbCorpusDetails): CorpusMetadata {
  const people: CorpusPerson[] = []
  const seen = new Set<string>()
  const push = (p: CorpusPerson) => {
    const key = `${p.tmdb_person_id}:${p.role}`
    if (seen.has(key)) return
    seen.add(key)
    people.push(p)
  }
  for (const c of d.credits?.crew ?? []) {
    if (c.job === 'Director') push({ tmdb_person_id: c.id, name: c.name, role: 'director', billing: null })
  }
  for (const c of d.credits?.crew ?? []) {
    if (WRITER_JOBS.has(c.job)) push({ tmdb_person_id: c.id, name: c.name, role: 'writer', billing: null })
  }
  for (const c of d.credits?.cast ?? []) {
    if (c.order < STORED_CAST_LIMIT) push({ tmdb_person_id: c.id, name: c.name, role: 'cast', billing: c.order })
  }

  const us_wide_date = earliestUsDate(d.release_dates, 3)
  const us_limited_date = earliestUsDate(d.release_dates, 2)
  const us_digital_date = earliestUsDate(d.release_dates, 4)
  const companies = d.production_companies ?? []

  return {
    tmdb_id: d.id,
    title: d.title,
    release_date: d.release_date || null,
    us_wide_date,
    us_limited_date,
    us_digital_date,
    festival_premiere: festivalPremiere(
      d.release_dates,
      [us_limited_date, us_wide_date, us_digital_date].filter((x): x is string => x !== null).sort()[0] ?? null
    ),
    keyword_flags: keywordFlags(d.keywords?.keywords ?? []),
    label_id: labelForCompanies(companies),
    original_language: d.original_language || null,
    collection_id: d.belongs_to_collection?.id ?? null,
    collection_name: d.belongs_to_collection?.name ?? null,
    genre_ids: (d.genres ?? []).map((g) => g.id),
    company_ids: companies.map((c) => c.id),
    budget: typeof d.budget === 'number' && d.budget > 0 ? d.budget : null,
    runtime: typeof d.runtime === 'number' && d.runtime > 0 ? d.runtime : null,
    certification: usCertification(d.release_dates),
    us_release_type: usReleaseType(d.release_dates),
    vote_average: typeof d.vote_average === 'number' ? d.vote_average : null,
    vote_count: typeof d.vote_count === 'number' ? d.vote_count : null,
    people,
  }
}

/**
 * One page of the historical sweep: films with a US limited, wide or digital
 * release in `year`, at least MIN_RUNTIME_MINUTES long, above a low vote
 * floor that only drops junk rows. Selection uses nothing a film earns after
 * release beyond that floor, so the corpus is not skewed toward hits.
 *
 * Sorted by primary release date so a page number means the same films from
 * one run to the next, which is what lets the sweep resume mid-year.
 */
export async function fetchDiscoverPage(
  year: number,
  page: number,
  token: string,
  minVotes: number
): Promise<{ stubs: CorpusStub[]; totalPages: number; totalResults: number }> {
  const url = new URL(`${TMDB}/discover/movie`)
  url.searchParams.set('region', 'US')
  url.searchParams.set('with_release_type', CORPUS_RELEASE_TYPES.join('|'))
  url.searchParams.set('release_date.gte', `${year}-01-01`)
  url.searchParams.set('release_date.lte', `${year}-12-31`)
  url.searchParams.set('with_runtime.gte', String(MIN_RUNTIME_MINUTES))
  url.searchParams.set('vote_count.gte', String(minVotes))
  url.searchParams.set('sort_by', 'primary_release_date.asc')
  url.searchParams.set('language', 'en-US')
  url.searchParams.set('include_adult', 'false')
  url.searchParams.set('page', String(page))
  const data = await tmdbGetJson<{ total_pages: number; total_results: number; results: TMDbListMovie[] }>(url.toString(), token)
  return {
    totalPages: data.total_pages,
    totalResults: data.total_results,
    stubs: data.results.map((m) => stub(m, 'discover', 0)),
  }
}

/** Full metadata for one film. Null when TMDb has no such movie (404). */
export async function fetchMovieMetadata(tmdbId: number, token: string): Promise<CorpusMetadata | null> {
  try {
    const data = await tmdbGetJson<TMDbCorpusDetails>(
      `${TMDB}/movie/${tmdbId}?language=en-US&append_to_response=credits,release_dates,keywords`,
      token
    )
    return toCorpusMetadata(data)
  } catch (err) {
    if (err instanceof TMDbApiError && err.status === 404) return null
    throw err
  }
}

/**
 * Films a person directed, wrote, or led (billing < LEAD_CAST_LIMIT) that
 * have released by `today`, above the vote floor.
 */
export async function fetchPersonPriorFilms(
  personId: number,
  token: string,
  minVotes: number,
  today: string,
  priority: number
): Promise<CorpusStub[]> {
  const data = await tmdbGetJson<{
    cast?: Array<TMDbListMovie & { order?: number }>
    crew?: Array<TMDbListMovie & { job: string }>
  }>(`${TMDB}/person/${personId}/movie_credits?language=en-US`, token)

  const byId = new Map<number, CorpusStub>()
  const keep = (m: TMDbListMovie) => {
    if (!m.release_date || m.release_date > today) return
    if ((m.vote_count ?? 0) < minVotes) return
    if (!byId.has(m.id)) byId.set(m.id, stub(m, 'person', priority))
  }
  for (const c of data.crew ?? []) {
    if (c.job === 'Director' || WRITER_JOBS.has(c.job)) keep(c)
  }
  for (const c of data.cast ?? []) {
    if (typeof c.order === 'number' && c.order < LEAD_CAST_LIMIT) keep(c)
  }
  return [...byId.values()]
}

/** A franchise's released entries (by `today`), as stubs. */
export async function fetchCollectionParts(
  collectionId: number,
  token: string,
  today: string,
  priority: number
): Promise<{ name: string; stubs: CorpusStub[] }> {
  const data = await tmdbGetJson<{ name: string; parts: TMDbListMovie[] }>(
    `${TMDB}/collection/${collectionId}?language=en-US`,
    token
  )
  return {
    name: data.name,
    stubs: data.parts
      .filter((p) => p.release_date && p.release_date <= today)
      .map((p) => stub(p, 'collection', priority)),
  }
}
