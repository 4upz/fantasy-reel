/**
 * Core logic for ingest-film-corpus, separate from index.ts so unit tests
 * can import it without triggering Deno.serve().
 *
 * Fills the historical film corpus the projection model learns from, in
 * three stages per daily run:
 *   A. seed     -- stub rows from TMDb discover (historical wide releases)
 *                  and from every movie currently in a league.
 *   B. metadata -- TMDb details + credits for stubs, expanding each
 *                  credited person's and franchise's prior films into new
 *                  stubs (TMDb only; cheap).
 *   C. ratings  -- MDBList ratings for rows that have metadata, paced by
 *                  the shared daily budget (_shared/mdblist-budget.ts).
 *
 * Priority order (film_corpus.priority DESC) means movies in leagues right
 * now, and their predecessors, are complete within a couple of runs while
 * the multi-year sweep trickles in behind them.
 *
 * Spec: docs/superpowers/specs/2026-08-26-movie-projections-design.md §5
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createLogger, serializeError } from '../_shared/logger.ts'
import {
  fetchDiscoverPage,
  fetchMovieMetadata,
  fetchPersonPriorFilms,
  fetchCollectionParts,
  type CorpusStub,
} from '../_shared/tmdb-corpus.ts'
import { fetchMDBListRatings } from '../_shared/scoring.ts'
import {
  fetchMdblistUsage,
  reserveApiCalls,
  MDBLIST_PROJECTIONS_KEY,
  MDBLIST_ACCOUNT_CAP,
  MDBLIST_SCORING_RESERVE,
} from '../_shared/mdblist-budget.ts'

const log = createLogger('ingest-film-corpus')

/** League movies released within this many days are still worth projecting/freezing. */
const RECENT_RELEASE_DAYS = 60
/** Spec §5.3: TMDb is cheap, so metadata runs at 3× the ratings cap. */
const METADATA_MULTIPLIER = 3

export interface IngestConfig {
  minVotes: number
  discoverFromYear: number
  perRunCap: number
  dailyBudget: number
  metadataPerRun: number
  /** YYYY-MM-DD; injected so tests are deterministic. */
  today: string
}

export const DEFAULT_INGEST_CONFIG: Omit<IngestConfig, 'today'> = {
  minVotes: 300,
  discoverFromYear: 2012,
  perRunCap: 300,
  dailyBudget: 500,
  metadataPerRun: 300 * METADATA_MULTIPLIER,
}

export interface IngestDeps {
  tmdbToken: string
  mdblistApiKey: string
  fetchUsage?: typeof fetchMdblistUsage
}

export interface IngestError {
  stage: string
  id: number
  error: string
}

export interface IngestResult {
  seeded: number
  metadata_fetched: number
  people_expanded: number
  ratings_fetched: number
  ratings_absent: number
  remaining_metadata: number
  remaining_ratings: number
  mdblist_used_today: number | null
  mdblist_granted: number
  mdblist_429: boolean
  failed: number
  errors: IngestError[]
}

interface CorpusRow {
  tmdb_id: number
  seed_source: string
  release_date: string | null
  priority: number
}

function daysBefore(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function upsertStubs(client: SupabaseClient, stubs: CorpusStub[], opts: { promote: boolean }): Promise<number> {
  if (stubs.length === 0) return 0
  const { error } = await client
    .from('film_corpus')
    .upsert(stubs, { onConflict: 'tmdb_id', ignoreDuplicates: !opts.promote })
  if (error) throw error
  return stubs.length
}

// ---------------------------------------------------------------------------
// Stage A: seed
// ---------------------------------------------------------------------------

export async function seedCorpus(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{ seeded: number; errors: IngestError[] }> {
  const errors: IngestError[] = []
  let seeded = 0

  // A1: historical wide releases, one discover sweep per un-seeded year.
  const currentYear = Number(config.today.slice(0, 4))
  const { data: discoverRows, error: rowsError } = await client
    .from('film_corpus')
    .select('tmdb_id, seed_source, release_date, priority')
    .eq('seed_source', 'discover')
  if (rowsError) throw rowsError
  const stubsPerYear = new Map<number, number>()
  for (const row of (discoverRows ?? []) as CorpusRow[]) {
    if (!row.release_date) continue
    const year = Number(row.release_date.slice(0, 4))
    stubsPerYear.set(year, (stubsPerYear.get(year) ?? 0) + 1)
  }

  // Always fetch page 1 for every year, even one already marked complete --
  // it's one cheap TMDb call and is how a year's completeness gets
  // re-verified (TMDb's total_results is the source of truth, not a
  // hardcoded stub-count heuristic). Only page past it while this year's
  // existing stub count hasn't caught up to that total; a year that falls
  // short keeps retrying on subsequent runs since its count stays below
  // total_results until it does.
  for (let year = config.discoverFromYear; year <= currentYear; year++) {
    try {
      const page1 = await fetchDiscoverPage(year, 1, deps.tmdbToken, config.minVotes)
      seeded += await upsertStubs(client, page1.stubs, { promote: false })
      if ((stubsPerYear.get(year) ?? 0) >= page1.totalResults) continue
      for (let page = 2; page <= page1.totalPages; page++) {
        const result = await fetchDiscoverPage(year, page, deps.tmdbToken, config.minVotes)
        seeded += await upsertStubs(client, result.stubs, { promote: false })
      }
    } catch (err) {
      log.warn('Discover sweep failed', { year, error: serializeError(err) })
      errors.push({ stage: 'seed:discover', id: year, error: String(err) })
    }
  }

  // A2: everything in a league now (upcoming, or released recently) at top priority.
  // Two queries, unioned by tmdb_id, because the shared mock has no `.or()`:
  // status='upcoming' catches undated upcoming movies that a release_date
  // filter would silently drop (undated upcoming is a real draftable state
  // in this app), and the second query catches recent/near-term releases
  // that already carry a status other than 'upcoming'.
  type LeagueMovieRow = { tmdb_id: number; title: string; release_date: string | null; vote_count: number | null }
  const { data: upcomingMovies, error: upcomingError } = await client
    .from('movies')
    .select('tmdb_id, title, release_date, status, vote_count')
    .eq('status', 'upcoming')
  if (upcomingError) throw upcomingError
  const { data: recentMovies, error: recentError } = await client
    .from('movies')
    .select('tmdb_id, title, release_date, status, vote_count')
    .neq('status', 'canceled')
    .gte('release_date', daysBefore(config.today, RECENT_RELEASE_DAYS))
  if (recentError) throw recentError

  const leagueMoviesById = new Map<number, LeagueMovieRow>()
  for (const m of [...(upcomingMovies ?? []), ...(recentMovies ?? [])] as LeagueMovieRow[]) {
    leagueMoviesById.set(m.tmdb_id, m)
  }

  const upcomingStubs: CorpusStub[] = [...leagueMoviesById.values()]
    .filter((m) => m.tmdb_id > 0)
    .map((m) => ({
      tmdb_id: m.tmdb_id,
      title: m.title,
      release_date: m.release_date,
      vote_count: m.vote_count,
      seed_source: 'upcoming' as const,
      priority: 100,
    }))
  // Promote: an existing row keeps its metadata but moves to the front of the queue.
  // Only stub columns are in the payload, so nothing fetched is overwritten.
  seeded += await upsertStubs(client, upcomingStubs, { promote: true })

  return { seeded, errors }
}

// ---------------------------------------------------------------------------
// Stage B: metadata + expansion
// ---------------------------------------------------------------------------

/** Rows at or above this priority get their people and franchise expanded. */
const EXPAND_PRIORITY = 50

interface PendingMetadataRow {
  tmdb_id: number
  priority: number
}

export async function fetchMetadataStage(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{ metadata_fetched: number; people_expanded: number; remaining_metadata: number; errors: IngestError[] }> {
  const errors: IngestError[] = []
  let metadata_fetched = 0
  let people_expanded = 0
  const now = new Date().toISOString()

  const { data: pending, error: pendingError } = await client
    .from('film_corpus')
    .select('tmdb_id, priority')
    .is('metadata_fetched_at', null)
    .order('priority', { ascending: false })
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(config.metadataPerRun)
  if (pendingError) throw pendingError

  const expandPeople = new Set<number>()
  const expandCollections = new Set<number>()

  for (const row of (pending ?? []) as PendingMetadataRow[]) {
    try {
      const meta = await fetchMovieMetadata(row.tmdb_id, deps.tmdbToken)
      if (!meta) {
        // Gone from TMDb: never fetch again, and don't spend MDBList on it.
        const { error: deadEndError } = await client.from('film_corpus')
          .update({ metadata_fetched_at: now, ratings_fetched_at: now, ratings_absent: true })
          .eq('tmdb_id', row.tmdb_id)
        if (deadEndError) throw deadEndError
        continue
      }

      const { error: updateError } = await client.from('film_corpus').update({
        title: meta.title,
        release_date: meta.release_date,
        collection_id: meta.collection_id,
        genre_ids: meta.genre_ids,
        company_ids: meta.company_ids,
        budget: meta.budget,
        runtime: meta.runtime,
        certification: meta.certification,
        us_release_type: meta.us_release_type,
        vote_average: meta.vote_average,
        vote_count: meta.vote_count,
        metadata_fetched_at: now,
      }).eq('tmdb_id', row.tmdb_id)
      if (updateError) throw updateError

      if (meta.people.length > 0) {
        const { error: peopleError } = await client.from('film_people').upsert(
          meta.people.map((p) => ({ tmdb_person_id: p.tmdb_person_id, name: p.name, credits_fetched_at: null })),
          { onConflict: 'tmdb_person_id', ignoreDuplicates: true }
        )
        if (peopleError) throw peopleError
        const { error: creditsError } = await client.from('film_credits').upsert(
          meta.people.map((p) => ({ tmdb_id: meta.tmdb_id, tmdb_person_id: p.tmdb_person_id, role: p.role, billing: p.billing })),
          { onConflict: 'tmdb_id,tmdb_person_id,role', ignoreDuplicates: true }
        )
        if (creditsError) throw creditsError
      }
      if (meta.collection_id !== null) {
        const { error: collError } = await client.from('film_collections').upsert(
          { collection_id: meta.collection_id, name: meta.collection_name ?? '', parts_fetched_at: null },
          { onConflict: 'collection_id', ignoreDuplicates: true }
        )
        if (collError) throw collError
      }

      if (row.priority >= EXPAND_PRIORITY) {
        for (const p of meta.people) expandPeople.add(p.tmdb_person_id)
        if (meta.collection_id !== null) expandCollections.add(meta.collection_id)
      }
      metadata_fetched++
    } catch (err) {
      log.warn('Metadata fetch failed', { tmdb_id: row.tmdb_id, error: serializeError(err) })
      errors.push({ stage: 'metadata', id: row.tmdb_id, error: String(err) })
    }
  }

  // Expansion: prior films of the people/franchises behind priority rows.
  // Skip the query entirely on an empty set rather than calling `.in()`
  // with `[]` -- harmless against the mock, but the real client sends a
  // malformed filter for an empty IN list.
  const expansionCap = Math.floor(config.metadataPerRun / METADATA_MULTIPLIER)
  let peopleRows: Array<{ tmdb_person_id: number }> = []
  if (expandPeople.size > 0) {
    const { data, error: peopleRowsError } = await client
      .from('film_people')
      .select('tmdb_person_id, credits_fetched_at')
      .is('credits_fetched_at', null)
      .in('tmdb_person_id', [...expandPeople])
    if (peopleRowsError) throw peopleRowsError
    peopleRows = (data ?? []) as Array<{ tmdb_person_id: number }>
  }

  for (const person of peopleRows.slice(0, expansionCap)) {
    try {
      const stubs = await fetchPersonPriorFilms(person.tmdb_person_id, deps.tmdbToken, 100)
      await upsertStubs(client, stubs, { promote: false })
      const { error: stampError } = await client.from('film_people').update({ credits_fetched_at: now }).eq('tmdb_person_id', person.tmdb_person_id)
      if (stampError) throw stampError
      people_expanded++
    } catch (err) {
      log.warn('Person expansion failed', { person_id: person.tmdb_person_id, error: serializeError(err) })
      errors.push({ stage: 'expand:person', id: person.tmdb_person_id, error: String(err) })
    }
  }

  let collRows: Array<{ collection_id: number }> = []
  if (expandCollections.size > 0) {
    const { data, error: collRowsError } = await client
      .from('film_collections')
      .select('collection_id, parts_fetched_at')
      .is('parts_fetched_at', null)
      .in('collection_id', [...expandCollections])
    if (collRowsError) throw collRowsError
    collRows = (data ?? []) as Array<{ collection_id: number }>
  }

  for (const coll of collRows.slice(0, expansionCap)) {
    try {
      const { name, stubs } = await fetchCollectionParts(coll.collection_id, deps.tmdbToken)
      await upsertStubs(client, stubs, { promote: false })
      const { error: stampError } = await client.from('film_collections').update({ name, parts_fetched_at: now }).eq('collection_id', coll.collection_id)
      if (stampError) throw stampError
      people_expanded++
    } catch (err) {
      log.warn('Collection expansion failed', { collection_id: coll.collection_id, error: serializeError(err) })
      errors.push({ stage: 'expand:collection', id: coll.collection_id, error: String(err) })
    }
  }

  const { count } = await client
    .from('film_corpus')
    .select('tmdb_id', { count: 'exact', head: true })
    .is('metadata_fetched_at', null)

  return { metadata_fetched, people_expanded, remaining_metadata: count ?? 0, errors }
}

// ---------------------------------------------------------------------------
// Stage C: ratings (MDBList, budget-paced)
// ---------------------------------------------------------------------------

interface PendingRatingsRow {
  tmdb_id: number
  budget: number | null
  certification: string | null
  company_ids: number[] | null
}

export async function fetchRatingsStage(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{
  ratings_fetched: number
  ratings_absent: number
  remaining_ratings: number
  mdblist_used_today: number | null
  mdblist_granted: number
  mdblist_429: boolean
  errors: IngestError[]
}> {
  const errors: IngestError[] = []
  let ratings_fetched = 0
  let ratings_absent = 0
  let mdblist_429 = false

  // One /user call to reconcile against MDBList's own counter (it counts too).
  // Whatever the flag allows, always leave MDBLIST_SCORING_RESERVE calls on
  // the account for the evening score sync.
  const usage = await (deps.fetchUsage ?? fetchMdblistUsage)(deps.mdblistApiKey)
  const headroom = usage
    ? Math.max(0, Math.min(
        config.perRunCap,
        config.dailyBudget - 1,
        MDBLIST_ACCOUNT_CAP - usage.used - MDBLIST_SCORING_RESERVE - 1
      ))
    : config.perRunCap
  const granted = await reserveApiCalls(client, MDBLIST_PROJECTIONS_KEY, headroom, config.dailyBudget)

  if (granted > 0) {
    const { data: pending, error: pendingError } = await client
      .from('film_corpus')
      .select('tmdb_id, budget, certification, company_ids')
      .is('ratings_fetched_at', null)
      .not('metadata_fetched_at', 'is', null)
      .order('priority', { ascending: false })
      .order('release_date', { ascending: false, nullsFirst: false })
      .limit(granted)
    if (pendingError) throw pendingError

    for (const row of (pending ?? []) as PendingRatingsRow[]) {
      const result = await fetchMDBListRatings(row.tmdb_id, deps.mdblistApiKey)
      if (result.status === 429) {
        mdblist_429 = true
        log.warn('MDBList 429; stopping ratings stage for this run')
        break
      }
      if (result.error && result.status !== 404) {
        errors.push({ stage: 'ratings', id: row.tmdb_id, error: result.error })
        continue
      }

      const now = new Date().toISOString()
      const bySource = new Map(result.ratings.map((r) => [r.source, r.score]))
      const rt = bySource.get('rotten_tomatoes') ?? null
      const patch: Record<string, unknown> = {
        ratings_fetched_at: now,
        ratings_absent: rt === null,
        rt_critic: rt,
        rt_critic_votes: result.details?.rt_critic_votes ?? null,
        metacritic: bySource.get('metacritic') ?? null,
        imdb: bySource.has('imdb') ? Math.round(bySource.get('imdb')!) / 10 : null,
      }
      if (result.details) {
        if (row.budget == null && result.details.budget !== null) patch.budget = result.details.budget
        if (!row.certification && result.details.certification) patch.certification = result.details.certification
        if ((row.company_ids ?? []).length === 0 && result.details.company_ids.length > 0) patch.company_ids = result.details.company_ids
      }
      const { error: updateError } = await client.from('film_corpus').update(patch).eq('tmdb_id', row.tmdb_id)
      if (updateError) {
        errors.push({ stage: 'ratings', id: row.tmdb_id, error: String(updateError) })
        continue
      }
      if (rt === null) ratings_absent++
      else ratings_fetched++
    }
  }

  const { count } = await client
    .from('film_corpus')
    .select('tmdb_id', { count: 'exact', head: true })
    .is('ratings_fetched_at', null)
    .not('metadata_fetched_at', 'is', null)

  return {
    ratings_fetched,
    ratings_absent,
    remaining_ratings: count ?? 0,
    mdblist_used_today: usage?.used ?? null,
    mdblist_granted: granted,
    mdblist_429,
    errors,
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runIngestFilmCorpus(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<IngestResult> {
  const seed = await seedCorpus(client, deps, config)
  const metadata = await fetchMetadataStage(client, deps, config)
  const ratings = await fetchRatingsStage(client, deps, config)
  const errors = [...seed.errors, ...metadata.errors, ...ratings.errors]
  return {
    seeded: seed.seeded,
    metadata_fetched: metadata.metadata_fetched,
    people_expanded: metadata.people_expanded,
    ratings_fetched: ratings.ratings_fetched,
    ratings_absent: ratings.ratings_absent,
    remaining_metadata: metadata.remaining_metadata,
    remaining_ratings: ratings.remaining_ratings,
    mdblist_used_today: ratings.mdblist_used_today,
    mdblist_granted: ratings.mdblist_granted,
    mdblist_429: ratings.mdblist_429,
    failed: errors.length,
    errors,
  }
}
