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
import { createLogger, serializeError, type SerializedError } from '../_shared/logger.ts'
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
/** Spec §5.3: TMDb is cheap, so expansion runs at a third of the metadata cap. */
const EXPANSION_DIVISOR = 3

/**
 * Wall-clock slice each stage may spend, in ms.
 *
 * The cron proxy aborts the request at 55s, and an aborted run loses the whole
 * run's work -- including Stage C, which is last and is the only stage that
 * spends money. Fixed per-stage slices (45s total, 10s of slack) mean a slow
 * TMDb or a wide discover sweep can only eat its own budget: Stage C is always
 * reached with its full share intact.
 */
export interface StageBudgetMs {
  seed: number
  metadata: number
  ratings: number
}

/** Which stages ran out of their slice this run; surfaced in job_runs metadata. */
export interface StageDeadlines {
  seed: boolean
  metadata: boolean
  ratings: boolean
}

export interface IngestConfig {
  minVotes: number
  discoverFromYear: number
  perRunCap: number
  dailyBudget: number
  metadataPerRun: number
  stageBudgetMs: StageBudgetMs
  /** YYYY-MM-DD; injected so tests are deterministic. */
  today: string
}

export const DEFAULT_INGEST_CONFIG: Omit<IngestConfig, 'today'> = {
  minVotes: 300,
  discoverFromYear: 2012,
  perRunCap: 300,
  dailyBudget: 500,
  metadataPerRun: 300,
  stageBudgetMs: { seed: 10_000, metadata: 18_000, ratings: 17_000 },
}

export interface IngestDeps {
  tmdbToken: string
  mdblistApiKey: string
  fetchUsage?: typeof fetchMdblistUsage
  /** Injectable clock so stage deadlines are testable without real waiting. */
  now?: () => number
}

export interface IngestError {
  stage: string
  id: number
  /** `serializeError` output, or the API's own message string. */
  error: SerializedError | string | unknown
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
  mdblist_auth_failed: boolean
  deadlines: StageDeadlines
  failed: number
  errors: IngestError[]
}

function daysBefore(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Inserts stubs, never touching a column an existing row already filled. */
async function upsertStubs(client: SupabaseClient, stubs: CorpusStub[]): Promise<number> {
  if (stubs.length === 0) return 0
  const { error } = await client
    .from('film_corpus')
    .upsert(stubs, { onConflict: 'tmdb_id', ignoreDuplicates: true })
  if (error) throw error
  return stubs.length
}

/**
 * Raises `priority` on rows that are already in the corpus, without writing any
 * other column. An upsert cannot do this: its payload is stub-shaped, so
 * merging it would overwrite the richer TMDb-sourced title/date/vote_count an
 * existing row may already carry.
 */
async function promoteExisting(
  client: SupabaseClient,
  tmdbIds: number[],
  priority: number,
  onlyUnprioritized: boolean
): Promise<void> {
  if (tmdbIds.length === 0) return
  const query = client.from('film_corpus').update({ priority }).in('tmdb_id', tmdbIds)
  // Priorities are only ever 0, 50 or 100, so eq(0) is a safe "below 50" and
  // keeps an expansion from demoting a league movie already at 100.
  const { error } = onlyUnprioritized ? await query.eq('priority', 0) : await query
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Stage A: seed
// ---------------------------------------------------------------------------

export async function seedCorpus(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{ seeded: number; deadline_hit: boolean; errors: IngestError[] }> {
  const errors: IngestError[] = []
  const now = deps.now ?? Date.now
  const deadline = now() + config.stageBudgetMs.seed
  let deadline_hit = false
  let seeded = 0

  // A1: historical wide releases, one discover sweep per un-seeded year.
  //
  // Always fetch page 1 for every year, even one already marked complete --
  // it's one cheap TMDb call and is how a year's completeness gets
  // re-verified (TMDb's total_results is the source of truth, not a
  // hardcoded stub-count heuristic). Only page past it while this year's
  // existing row count hasn't caught up to that total; a year that falls
  // short keeps retrying on subsequent runs since its count stays below
  // total_results until it does.
  const currentYear = Number(config.today.slice(0, 4))
  yearSweep: for (let year = config.discoverFromYear; year <= currentYear; year++) {
    if (now() >= deadline) {
      deadline_hit = true
      log.info('seed deadline reached', { stopped_at_year: year })
      break
    }
    try {
      // An exact head count of every row dated in this year, whatever seeded
      // it -- a film first seen as a person's prior work still covers its
      // year. Counted server-side and never fetched: PostgREST caps a select
      // at max_rows (1000), so counting returned rows would call a year with
      // more than that complete when it isn't.
      const { count: existingForYear, error: countError } = await client
        .from('film_corpus')
        .select('tmdb_id', { count: 'exact', head: true })
        .gte('release_date', `${year}-01-01`)
        .lte('release_date', `${year}-12-31`)
      if (countError) throw countError

      const page1 = await fetchDiscoverPage(year, 1, deps.tmdbToken, config.minVotes)
      seeded += await upsertStubs(client, page1.stubs)
      if ((existingForYear ?? 0) >= page1.totalResults) continue
      for (let page = 2; page <= page1.totalPages; page++) {
        if (now() >= deadline) {
          deadline_hit = true
          log.info('seed deadline reached', { stopped_at_year: year, stopped_at_page: page })
          break yearSweep
        }
        const result = await fetchDiscoverPage(year, page, deps.tmdbToken, config.minVotes)
        seeded += await upsertStubs(client, result.stubs)
      }
    } catch (err) {
      log.warn('Discover sweep failed', { year, error: serializeError(err) })
      errors.push({ stage: 'seed:discover', id: year, error: serializeError(err) })
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
  // Insert the ones we've never seen, then raise priority on all of them. Two
  // steps, because a merging upsert would write the whole stub payload over an
  // existing row -- replacing a title, release_date and vote_count already
  // refreshed from TMDb's details endpoint with the movies table's copy.
  seeded += await upsertStubs(client, upcomingStubs)
  await promoteExisting(client, upcomingStubs.map((s) => s.tmdb_id), 100, false)

  return { seeded, deadline_hit, errors }
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
): Promise<{ metadata_fetched: number; people_expanded: number; remaining_metadata: number; deadline_hit: boolean; errors: IngestError[] }> {
  const errors: IngestError[] = []
  const clock = deps.now ?? Date.now
  const deadline = clock() + config.stageBudgetMs.metadata
  let deadline_hit = false
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
    if (clock() >= deadline) {
      deadline_hit = true
      log.info('metadata deadline reached', { fetched: metadata_fetched, stopped_at: row.tmdb_id })
      break
    }
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
      errors.push({ stage: 'metadata', id: row.tmdb_id, error: serializeError(err) })
    }
  }

  // Expansion: prior films of the people/franchises behind priority rows.
  // Skip the query entirely on an empty set rather than calling `.in()`
  // with `[]` -- harmless against the mock, but the real client sends a
  // malformed filter for an empty IN list.
  const expansionCap = Math.floor(config.metadataPerRun / EXPANSION_DIVISOR)
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
    if (clock() >= deadline) {
      deadline_hit = true
      log.info('metadata deadline reached during person expansion', { expanded: people_expanded })
      break
    }
    try {
      const stubs = await fetchPersonPriorFilms(person.tmdb_person_id, deps.tmdbToken, 100)
      await upsertStubs(client, stubs)
      // A predecessor already in the corpus at priority 0 (from the discover
      // sweep) is worth as much as a newly inserted one: promote it too, or a
      // league movie's history stays stuck behind the whole backlog.
      await promoteExisting(client, stubs.map((s) => s.tmdb_id), EXPAND_PRIORITY, true)
      const { error: stampError } = await client.from('film_people').update({ credits_fetched_at: now }).eq('tmdb_person_id', person.tmdb_person_id)
      if (stampError) throw stampError
      people_expanded++
    } catch (err) {
      log.warn('Person expansion failed', { person_id: person.tmdb_person_id, error: serializeError(err) })
      errors.push({ stage: 'expand:person', id: person.tmdb_person_id, error: serializeError(err) })
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
    if (clock() >= deadline) {
      deadline_hit = true
      log.info('metadata deadline reached during collection expansion', { expanded: people_expanded })
      break
    }
    try {
      const { name, stubs } = await fetchCollectionParts(coll.collection_id, deps.tmdbToken)
      await upsertStubs(client, stubs)
      await promoteExisting(client, stubs.map((s) => s.tmdb_id), EXPAND_PRIORITY, true)
      const { error: stampError } = await client.from('film_collections').update({ name, parts_fetched_at: now }).eq('collection_id', coll.collection_id)
      if (stampError) throw stampError
      people_expanded++
    } catch (err) {
      log.warn('Collection expansion failed', { collection_id: coll.collection_id, error: serializeError(err) })
      errors.push({ stage: 'expand:collection', id: coll.collection_id, error: serializeError(err) })
    }
  }

  const { count } = await client
    .from('film_corpus')
    .select('tmdb_id', { count: 'exact', head: true })
    .is('metadata_fetched_at', null)

  return { metadata_fetched, people_expanded, remaining_metadata: count ?? 0, deadline_hit, errors }
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
  mdblist_auth_failed: boolean
  deadline_hit: boolean
  errors: IngestError[]
}> {
  const errors: IngestError[] = []
  const clock = deps.now ?? Date.now
  const deadline = clock() + config.stageBudgetMs.ratings
  let deadline_hit = false
  let ratings_fetched = 0
  let ratings_absent = 0
  let mdblist_429 = false
  let mdblist_auth_failed = false

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
      if (clock() >= deadline) {
        deadline_hit = true
        log.info('ratings deadline reached', { fetched: ratings_fetched + ratings_absent, stopped_at: row.tmdb_id })
        break
      }
      const result = await fetchMDBListRatings(row.tmdb_id, deps.mdblistApiKey)
      // 429 and 401 are both whole-run conditions, not per-row ones: the rest
      // of the grant would fail identically, and a stopped stage retries
      // tomorrow with nothing stamped.
      if (result.status === 429 || result.status === 401) {
        if (result.status === 429) mdblist_429 = true
        else mdblist_auth_failed = true
        log.warn('MDBList refused the request; stopping ratings stage for this run', { status: result.status })
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
        errors.push({ stage: 'ratings', id: row.tmdb_id, error: serializeError(updateError) })
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
    mdblist_auth_failed,
    deadline_hit,
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
    mdblist_auth_failed: ratings.mdblist_auth_failed,
    deadlines: {
      seed: seed.deadline_hit,
      metadata: metadata.deadline_hit,
      ratings: ratings.deadline_hit,
    },
    failed: errors.length,
    errors,
  }
}
