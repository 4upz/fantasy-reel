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

/** A year counts as seeded once it has this many discover stubs. */
const SEEDED_YEAR_THRESHOLD = 50
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

  for (let year = config.discoverFromYear; year <= currentYear; year++) {
    if ((stubsPerYear.get(year) ?? 0) >= SEEDED_YEAR_THRESHOLD) continue
    try {
      let page = 1
      let totalPages = 1
      do {
        const result = await fetchDiscoverPage(year, page, deps.tmdbToken, config.minVotes)
        totalPages = result.totalPages
        seeded += await upsertStubs(client, result.stubs, { promote: false })
        page++
      } while (page <= totalPages)
    } catch (err) {
      log.warn('Discover sweep failed', { year, error: serializeError(err) })
      errors.push({ stage: 'seed:discover', id: year, error: String(err) })
    }
  }

  // A2: everything in a league now (upcoming, or released recently) at top priority.
  const { data: leagueMovies, error: moviesError } = await client
    .from('movies')
    .select('tmdb_id, title, release_date, status, vote_count')
    .neq('status', 'canceled')
    .gte('release_date', daysBefore(config.today, RECENT_RELEASE_DAYS))
  if (moviesError) throw moviesError

  const upcomingStubs: CorpusStub[] = ((leagueMovies ?? []) as Array<{
    tmdb_id: number; title: string; release_date: string | null; vote_count: number | null
  }>)
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
        await client.from('film_corpus')
          .update({ metadata_fetched_at: now, ratings_fetched_at: now, ratings_absent: true })
          .eq('tmdb_id', row.tmdb_id)
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
  const expansionCap = Math.floor(config.metadataPerRun / METADATA_MULTIPLIER)
  const { data: peopleRows, error: peopleRowsError } = await client
    .from('film_people')
    .select('tmdb_person_id, credits_fetched_at')
    .is('credits_fetched_at', null)
    .in('tmdb_person_id', [...expandPeople])
  if (peopleRowsError) throw peopleRowsError

  for (const person of ((peopleRows ?? []) as Array<{ tmdb_person_id: number }>).slice(0, expansionCap)) {
    try {
      const stubs = await fetchPersonPriorFilms(person.tmdb_person_id, deps.tmdbToken, 100)
      await upsertStubs(client, stubs, { promote: false })
      await client.from('film_people').update({ credits_fetched_at: now }).eq('tmdb_person_id', person.tmdb_person_id)
      people_expanded++
    } catch (err) {
      log.warn('Person expansion failed', { person_id: person.tmdb_person_id, error: serializeError(err) })
      errors.push({ stage: 'expand:person', id: person.tmdb_person_id, error: String(err) })
    }
  }

  const { data: collRows, error: collRowsError } = await client
    .from('film_collections')
    .select('collection_id, parts_fetched_at')
    .is('parts_fetched_at', null)
    .in('collection_id', [...expandCollections])
  if (collRowsError) throw collRowsError

  for (const coll of ((collRows ?? []) as Array<{ collection_id: number }>).slice(0, expansionCap)) {
    try {
      const { name, stubs } = await fetchCollectionParts(coll.collection_id, deps.tmdbToken)
      await upsertStubs(client, stubs, { promote: false })
      await client.from('film_collections').update({ name, parts_fetched_at: now }).eq('collection_id', coll.collection_id)
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
