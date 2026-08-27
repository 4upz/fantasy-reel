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

const TMDB = 'https://api.themoviedb.org/3'

/** Crew jobs that count as "writer" for the writer factor. */
const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Story'])
/** Cast billed at or above this order are "leads". */
const LEAD_BILLING_LIMIT = 5

export type SeedSource = 'discover' | 'person' | 'collection' | 'upcoming'

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

export interface CorpusMetadata {
  tmdb_id: number
  title: string
  release_date: string | null
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

export interface TMDbReleaseDates {
  results: Array<{
    iso_3166_1: string
    release_dates: Array<{ type: number; release_date: string; certification: string }>
  }>
}

/** The `/movie/{id}?append_to_response=credits,release_dates` payload, the parts we read. */
export interface TMDbCorpusDetails {
  id: number
  title: string
  release_date?: string | null
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

/** Wide (3) beats limited (2); any other US type is returned as-is; null when no US entry. */
export function usReleaseType(releaseDates: TMDbReleaseDates | undefined): number | null {
  const us = releaseDates?.results.find((r) => r.iso_3166_1 === 'US')
  if (!us || us.release_dates.length === 0) return null
  const types = us.release_dates.map((r) => r.type)
  if (types.includes(3)) return 3
  if (types.includes(2)) return 2
  return types[0] ?? null
}

function usCertification(releaseDates: TMDbReleaseDates | undefined): string | null {
  const us = releaseDates?.results.find((r) => r.iso_3166_1 === 'US')
  const certified = us?.release_dates.find((r) => r.certification)
  return certified?.certification || null
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
    if (c.order < LEAD_BILLING_LIMIT) push({ tmdb_person_id: c.id, name: c.name, role: 'cast', billing: c.order })
  }

  return {
    tmdb_id: d.id,
    title: d.title,
    release_date: d.release_date || null,
    collection_id: d.belongs_to_collection?.id ?? null,
    collection_name: d.belongs_to_collection?.name ?? null,
    genre_ids: (d.genres ?? []).map((g) => g.id),
    company_ids: (d.production_companies ?? []).map((c) => c.id),
    budget: typeof d.budget === 'number' && d.budget > 0 ? d.budget : null,
    runtime: typeof d.runtime === 'number' && d.runtime > 0 ? d.runtime : null,
    certification: usCertification(d.release_dates),
    us_release_type: usReleaseType(d.release_dates),
    vote_average: typeof d.vote_average === 'number' ? d.vote_average : null,
    vote_count: typeof d.vote_count === 'number' ? d.vote_count : null,
    people,
  }
}

export async function fetchDiscoverPage(
  year: number,
  page: number,
  token: string,
  minVotes: number
): Promise<{ stubs: CorpusStub[]; totalPages: number }> {
  const url = new URL(`${TMDB}/discover/movie`)
  url.searchParams.set('region', 'US')
  url.searchParams.set('with_release_type', '3')
  url.searchParams.set('primary_release_date.gte', `${year}-01-01`)
  url.searchParams.set('primary_release_date.lte', `${year}-12-31`)
  url.searchParams.set('vote_count.gte', String(minVotes))
  url.searchParams.set('sort_by', 'primary_release_date.asc')
  url.searchParams.set('language', 'en-US')
  url.searchParams.set('include_adult', 'false')
  url.searchParams.set('page', String(page))
  const data = await tmdbGetJson<{ total_pages: number; results: TMDbListMovie[] }>(url.toString(), token)
  return {
    totalPages: data.total_pages,
    stubs: data.results.map((m) => stub(m, 'discover', 0)),
  }
}

/** Full metadata for one film. Null when TMDb has no such movie (404). */
export async function fetchMovieMetadata(tmdbId: number, token: string): Promise<CorpusMetadata | null> {
  try {
    const data = await tmdbGetJson<TMDbCorpusDetails>(
      `${TMDB}/movie/${tmdbId}?language=en-US&append_to_response=credits,release_dates`,
      token
    )
    return toCorpusMetadata(data)
  } catch (err) {
    if (err instanceof TMDbApiError && err.status === 404) return null
    throw err
  }
}

/** Released films a person directed, wrote, or led (billing < 5), above the vote floor. */
export async function fetchPersonPriorFilms(personId: number, token: string, minVotes: number): Promise<CorpusStub[]> {
  const data = await tmdbGetJson<{
    cast?: Array<TMDbListMovie & { order?: number }>
    crew?: Array<TMDbListMovie & { job: string }>
  }>(`${TMDB}/person/${personId}/movie_credits?language=en-US`, token)

  const byId = new Map<number, CorpusStub>()
  const keep = (m: TMDbListMovie) => {
    if (!m.release_date) return
    if ((m.vote_count ?? 0) < minVotes) return
    if (!byId.has(m.id)) byId.set(m.id, stub(m, 'person', 50))
  }
  for (const c of data.crew ?? []) {
    if (c.job === 'Director' || WRITER_JOBS.has(c.job)) keep(c)
  }
  for (const c of data.cast ?? []) {
    if (typeof c.order === 'number' && c.order < LEAD_BILLING_LIMIT) keep(c)
  }
  return [...byId.values()]
}

export async function fetchCollectionParts(collectionId: number, token: string): Promise<{ name: string; stubs: CorpusStub[] }> {
  const data = await tmdbGetJson<{ name: string; parts: TMDbListMovie[] }>(
    `${TMDB}/collection/${collectionId}?language=en-US`,
    token
  )
  return {
    name: data.name,
    stubs: data.parts.filter((p) => p.release_date).map((p) => stub(p, 'collection', 50)),
  }
}
