/**
 * Core logic for ingest-film-corpus, separate from index.ts so unit tests
 * can import it without triggering Deno.serve().
 *
 * Fills the historical film corpus the projection model learns from, in
 * three stages per run (three runs a day):
 *   A. seed     -- stub rows from the TMDb discover sweep (US limited, wide
 *                  and digital releases since 2012, resumable per year) and
 *                  from every movie on a roster or an active wishlist.
 *   B. metadata -- TMDb details for stubs; a weekly refresh of league movies
 *                  until they release; one level of predecessor expansion
 *                  (people and franchises behind league movies only); and a
 *                  weekly feature snapshot of each unreleased league movie.
 *                  TMDb only, so cheap.
 *   C. ratings  -- MDBList Tomatometers for released rows, reserved 25 calls
 *                  at a time and fetched 4 at a time. Recent films are
 *                  re-polled weekly until their score settles.
 *
 * Priority order (film_corpus.priority DESC) means league movies and their
 * predecessors are complete within a couple of days while the multi-year
 * sweep trickles in behind them.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createLogger, serializeError, type SerializedError } from '../_shared/logger.ts'
import {
  fetchDiscoverPage,
  fetchMovieMetadata,
  fetchPersonPriorFilms,
  fetchCollectionParts,
  LEAD_CAST_LIMIT,
  type CorpusMetadata,
  type CorpusStub,
} from '../_shared/tmdb-corpus.ts'
import { fetchMDBListRatings } from '../_shared/scoring.ts'
import {
  fetchMdblistUsage,
  reserveApiCalls,
  MDBLIST_PROJECTIONS_KEY,
  MDBLIST_SAFETY_RESERVE,
} from '../_shared/mdblist-budget.ts'

const log = createLogger('ingest-film-corpus')

/** Rows on a roster or an active wishlist. Only these are expanded and refreshed. */
export const LEAGUE_PRIORITY = 100
/** Predecessors of league movies. Never expanded themselves: expansion is one level deep. */
export const PREDECESSOR_PRIORITY = 50

/** League movies released longer ago than this are no longer seeded at league priority. */
const LEAGUE_SEED_RECENT_DAYS = 60
/** How often a league movie's TMDb metadata is refreshed until it releases. */
const METADATA_REFRESH_DAYS = 7
/** The current and previous discover years are re-swept this often: new films keep qualifying. */
const DISCOVER_RESWEEP_DAYS = 7
/** TMDb discover never serves past page 500. */
const DISCOVER_MAX_PAGE = 500

/** A Tomatometer is settled once it has this many reviews... */
export const SETTLED_MIN_REVIEWS = 20
/** ...and the film is this many days past its effective release date. */
export const SETTLED_AFTER_DAYS = 60
/** Unsettled films are re-polled this often... */
const REPOLL_DAYS = 7
/** ...until this long after release (one more poll after the settle line). */
const REPOLL_WINDOW_DAYS = SETTLED_AFTER_DAYS + 2 * REPOLL_DAYS
/** A row whose MDBList lookup failed transiently waits this long before a retry... */
const ERROR_RETRY_DAYS = 3
/** ...and stops being retried after this many consecutive failures. */
const MAX_RATINGS_ERRORS = 5

/** MDBList calls reserved per reservation: small, so a stopped run wastes little. */
export const RESERVE_CHUNK = 25
/** Concurrent MDBList lookups. */
export const MDBLIST_CONCURRENCY = 4

/** PostgREST page size (its max_rows) for reads that must see every row. */
const PAGE_SIZE = 1000
/** Ids per `.in()` filter, to keep request URLs short. */
const IN_CHUNK = 200

/**
 * Wall-clock slice each stage may spend, in ms.
 *
 * The cron proxy aborts the request at 55s, and an aborted run loses the whole
 * run's work -- including Stage C, which is last and is the only stage that
 * spends quota. Fixed per-stage slices (45s total, 10s of slack) mean a slow
 * TMDb or a wide discover sweep can only eat its own budget.
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
  /** Discover vote floor: drops junk rows only, never a quality filter. */
  minVotes: number
  discoverFromYear: number
  /** Max MDBList lookups per run. */
  perRunCap: number
  /** MDBList calls/day under the projections key (enforced by the ledger). */
  dailyBudget: number
  metadataPerRun: number
  /** Max people and max collections expanded per run (each). */
  expansionPerRun: number
  stageBudgetMs: StageBudgetMs
  /** YYYY-MM-DD; injected so tests are deterministic. */
  today: string
}

export const DEFAULT_INGEST_CONFIG: Omit<IngestConfig, 'today'> = {
  minVotes: 25,
  discoverFromYear: 2012,
  perRunCap: 160,
  dailyBudget: 460,
  metadataPerRun: 150,
  expansionPerRun: 40,
  stageBudgetMs: { seed: 8_000, metadata: 17_000, ratings: 20_000 },
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

/** Why the ratings stage stopped spending before its work ran out. */
export type RatingsStop = 'usage_unavailable' | 'rate_limited' | 'auth_failed' | 'budget_exhausted' | null

export interface IngestResult {
  seeded: number
  league_movies: number
  metadata_fetched: number
  metadata_refreshed: number
  people_expanded: number
  collections_expanded: number
  remaining_expansion: number
  snapshots_written: number
  ratings_fetched: number
  ratings_absent: number
  ratings_settled: number
  remaining_metadata: number
  remaining_ratings: number
  mdblist_used_today: number | null
  mdblist_granted: number
  mdblist_spent: number
  mdblist_stopped: RatingsStop
  deadlines: StageDeadlines
  failed: number
  errors: IngestError[]
}

/**
 * A PostgREST filter builder. Typed loosely on purpose: filters are shared
 * between head counts and row fetches, and the generated builder type cannot
 * be named without the table's row type.
 */
// deno-lint-ignore no-explicit-any
type Query = any

function daysBefore(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Monday (UTC) of the week containing `today`. */
export function weekOf(today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  return daysBefore(today, (d.getUTCDay() + 6) % 7)
}

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Every row a query matches, a PostgREST page at a time. `build` must order by a unique key. */
async function selectAll<T>(build: () => Query): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as T[]))
    if ((data ?? []).length < PAGE_SIZE) return rows
  }
}

/** `select` per id chunk, concatenated. */
async function selectIn<T>(ids: unknown[], build: (chunk: unknown[]) => Query): Promise<T[]> {
  const rows: T[] = []
  for (const chunk of chunks(ids)) {
    const { data, error } = await build(chunk)
    if (error) throw error
    rows.push(...((data ?? []) as T[]))
  }
  return rows
}

/** Runs `fn` over `items`, at most `limit` at a time. */
async function forEachConcurrently<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Inserts stubs, never touching an existing row. Returns how many were new. */
async function insertStubs(client: SupabaseClient, stubs: CorpusStub[]): Promise<number> {
  if (stubs.length === 0) return 0
  const { data, error } = await client
    .from('film_corpus')
    .upsert(stubs, { onConflict: 'tmdb_id', ignoreDuplicates: true })
    .select('tmdb_id')
  if (error) throw error
  return data?.length ?? 0
}

/**
 * Raises `priority` on rows already in the corpus, without writing any other
 * column (a merging upsert would overwrite the TMDb-sourced title and dates
 * with the stub's copy). `onlyFrom` limits it to rows at that priority, so an
 * expansion never demotes a league movie.
 */
async function promote(client: SupabaseClient, tmdbIds: number[], priority: number, onlyFrom?: number): Promise<void> {
  for (const chunk of chunks(tmdbIds)) {
    const query = client.from('film_corpus').update({ priority }).in('tmdb_id', chunk)
    const { error } = onlyFrom === undefined ? await query : await query.eq('priority', onlyFrom)
    if (error) throw error
  }
}

// ---------------------------------------------------------------------------
// Stage A: seed
// ---------------------------------------------------------------------------

interface SeedProgress {
  year: number
  next_page: number
  completed_at: string | null
}

/**
 * The historical sweep. Each year resumes at its stored page, so a sweep cut
 * off by the stage deadline continues where it stopped instead of re-reading
 * page 1 or trusting a row count (rows from person and franchise expansion
 * share the year but say nothing about which discover pages were read). A
 * finished year is skipped, except the current and previous year, which
 * re-sweep weekly as new films pass the vote floor.
 */
async function sweepDiscover(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig,
  deadline: number
): Promise<{ seeded: number; deadline_hit: boolean; errors: IngestError[] }> {
  const now = deps.now ?? Date.now
  const errors: IngestError[] = []
  let seeded = 0

  const { data, error } = await client.from('film_corpus_seed_progress').select('year, next_page, completed_at')
  if (error) {
    log.warn('Seed progress read failed; skipping discover sweep', { error: serializeError(error) })
    return { seeded, deadline_hit: false, errors: [{ stage: 'seed:discover', id: 0, error: serializeError(error) }] }
  }
  const progress = new Map(((data ?? []) as SeedProgress[]).map((p) => [p.year, p]))

  const currentYear = Number(config.today.slice(0, 4))
  const resweepBefore = daysBefore(config.today, DISCOVER_RESWEEP_DAYS)
  for (let year = config.discoverFromYear; year <= currentYear; year++) {
    const p = progress.get(year)
    const recent = year >= currentYear - 1
    if (p?.completed_at && !(recent && p.completed_at < resweepBefore)) continue

    let page = p?.completed_at ? 1 : p?.next_page ?? 1
    try {
      while (true) {
        if (now() >= deadline) {
          log.info('seed deadline reached', { stopped_at_year: year, stopped_at_page: page })
          return { seeded, deadline_hit: true, errors }
        }
        const result = await fetchDiscoverPage(year, page, deps.tmdbToken, config.minVotes)
        seeded += await insertStubs(client, result.stubs)
        const done = page >= Math.min(result.totalPages, DISCOVER_MAX_PAGE)
        const { error: saveError } = await client.from('film_corpus_seed_progress').upsert(
          {
            year,
            next_page: done ? 1 : page + 1,
            total_pages: result.totalPages,
            total_results: result.totalResults,
            completed_at: done ? new Date().toISOString() : null,
          },
          { onConflict: 'year' }
        )
        if (saveError) throw saveError
        if (done) break
        page++
      }
    } catch (err) {
      log.warn('Discover sweep failed', { year, page, error: serializeError(err) })
      errors.push({ stage: 'seed:discover', id: year, error: serializeError(err) })
    }
  }
  return { seeded, deadline_hit: false, errors }
}

interface HoldingRow {
  tmdb_id: number
  title: string
  release_date: string | null
}

/**
 * Every movie on a roster (released recently or not yet) and every movie on
 * the wishlist of a player in a season that is still running. These are the
 * films projections will be asked about. Wishlists contribute only TMDb ids:
 * nothing about who wished for them reaches the corpus.
 */
async function leagueStubs(client: SupabaseClient, config: IngestConfig): Promise<CorpusStub[]> {
  const byId = new Map<number, CorpusStub>()
  const recentCutoff = daysBefore(config.today, LEAGUE_SEED_RECENT_DAYS)

  const holdings = await selectAll<HoldingRow>(() =>
    client.from('team_holdings').select('tmdb_id, title, release_date').order('holding_id')
  )
  for (const h of holdings) {
    if (!(h.tmdb_id > 0) || (h.release_date && h.release_date < recentCutoff)) continue
    byId.set(h.tmdb_id, {
      tmdb_id: h.tmdb_id, title: h.title, release_date: h.release_date, vote_count: null,
      seed_source: 'league', priority: LEAGUE_PRIORITY,
    })
  }

  const leagues = await selectAll<{ id: string }>(() =>
    client.from('leagues').select('id').neq('status', 'completed').order('id')
  )
  const participants = await selectIn<{ user_id: string }>(leagues.map((l) => l.id), (chunk) =>
    client.from('league_participants').select('user_id').eq('status', 'active').in('league_id', chunk)
  )
  const userIds = [...new Set(participants.map((p) => p.user_id))]
  const wished = await selectIn<{ tmdb_id: number; title: string }>(userIds, (chunk) =>
    client.from('wishlisted_movies').select('tmdb_id, title').in('user_id', chunk)
  )
  for (const w of wished) {
    if (!(w.tmdb_id > 0) || byId.has(w.tmdb_id)) continue
    byId.set(w.tmdb_id, {
      tmdb_id: w.tmdb_id, title: w.title, release_date: null, vote_count: null,
      seed_source: 'wishlist', priority: LEAGUE_PRIORITY,
    })
  }
  return [...byId.values()]
}

export async function seedCorpus(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{ seeded: number; league_movies: number; deadline_hit: boolean; errors: IngestError[] }> {
  const now = deps.now ?? Date.now
  const sweep = await sweepDiscover(client, deps, config, now() + config.stageBudgetMs.seed)
  const errors = [...sweep.errors]
  let seeded = sweep.seeded
  let league_movies = 0

  // League seeding is DB-only and must not be starved by a slow sweep.
  try {
    const stubs = await leagueStubs(client, config)
    league_movies = stubs.length
    seeded += await insertStubs(client, stubs)
    await promote(client, stubs.map((s) => s.tmdb_id), LEAGUE_PRIORITY)
  } catch (err) {
    log.warn('League seeding failed', { error: serializeError(err) })
    errors.push({ stage: 'seed:league', id: 0, error: serializeError(err) })
  }

  return { seeded, league_movies, deadline_hit: sweep.deadline_hit, errors }
}

// ---------------------------------------------------------------------------
// Stage B: metadata, snapshots, expansion
// ---------------------------------------------------------------------------

interface DueMetadataRow {
  tmdb_id: number
  priority: number
  metadata_fetched_at: string | null
}

const DUE_METADATA_COLUMNS = 'tmdb_id, priority, metadata_fetched_at'

/** Never-fetched rows by priority, plus league movies whose metadata is a week old and unreleased. */
async function dueMetadata(client: SupabaseClient, config: IngestConfig): Promise<DueMetadataRow[]> {
  const limit = config.metadataPerRun
  const staleBefore = daysBefore(config.today, METADATA_REFRESH_DAYS)
  const stale = () =>
    client.from('film_corpus').select(DUE_METADATA_COLUMNS)
      .gte('priority', LEAGUE_PRIORITY)
      .lt('metadata_fetched_at', staleBefore)

  const [{ data: fresh, error: freshError }, { data: upcoming, error: upcomingError }, { data: undated, error: undatedError }] =
    await Promise.all([
      client.from('film_corpus').select(DUE_METADATA_COLUMNS)
        .is('metadata_fetched_at', null)
        .order('priority', { ascending: false })
        .order('effective_release_date', { ascending: false, nullsFirst: false })
        .limit(limit),
      stale().gte('effective_release_date', config.today).limit(limit),
      stale().is('effective_release_date', null).limit(limit),
    ])
  const error = freshError ?? upcomingError ?? undatedError
  if (error) throw error

  const neverFetched = (fresh ?? []) as DueMetadataRow[]
  return [
    ...neverFetched.filter((r) => r.priority >= LEAGUE_PRIORITY),
    ...((upcoming ?? []) as DueMetadataRow[]),
    ...((undated ?? []) as DueMetadataRow[]),
    ...neverFetched.filter((r) => r.priority < LEAGUE_PRIORITY),
  ].slice(0, limit)
}

/**
 * Writes one film's metadata. People, credits and collection go first and the
 * corpus row (which stamps metadata_fetched_at) last, so a failure part-way
 * leaves the row due for the next run. Credits are replaced, not merged: a
 * refreshed league movie's cast can change before release.
 */
async function storeMetadata(client: SupabaseClient, meta: CorpusMetadata, fetchedAt: string): Promise<void> {
  if (meta.people.length > 0) {
    const { error: peopleError } = await client.from('film_people').upsert(
      meta.people.map((p) => ({ tmdb_person_id: p.tmdb_person_id, name: p.name })),
      { onConflict: 'tmdb_person_id', ignoreDuplicates: true }
    )
    if (peopleError) throw peopleError
  }
  const { error: clearError } = await client.from('film_credits').delete().eq('tmdb_id', meta.tmdb_id)
  if (clearError) throw clearError
  if (meta.people.length > 0) {
    const { error: creditsError } = await client.from('film_credits').upsert(
      meta.people.map((p) => ({ tmdb_id: meta.tmdb_id, tmdb_person_id: p.tmdb_person_id, role: p.role, billing: p.billing })),
      { onConflict: 'tmdb_id,tmdb_person_id,role', ignoreDuplicates: true }
    )
    if (creditsError) throw creditsError
  }
  if (meta.collection_id !== null) {
    const { error: collError } = await client.from('film_collections').upsert(
      { collection_id: meta.collection_id, name: meta.collection_name ?? '' },
      { onConflict: 'collection_id', ignoreDuplicates: true }
    )
    if (collError) throw collError
  }

  const { error: updateError } = await client.from('film_corpus').update({
    title: meta.title,
    release_date: meta.release_date,
    us_wide_date: meta.us_wide_date,
    us_limited_date: meta.us_limited_date,
    us_digital_date: meta.us_digital_date,
    festival_premiere: meta.festival_premiere,
    keyword_flags: meta.keyword_flags,
    label_id: meta.label_id,
    original_language: meta.original_language,
    collection_id: meta.collection_id,
    genre_ids: meta.genre_ids,
    company_ids: meta.company_ids,
    budget: meta.budget,
    runtime: meta.runtime,
    certification: meta.certification,
    us_release_type: meta.us_release_type,
    vote_average: meta.vote_average,
    vote_count: meta.vote_count,
    metadata_fetched_at: fetchedAt,
  }).eq('tmdb_id', meta.tmdb_id)
  if (updateError) throw updateError
}

/** The pre-release columns a feature snapshot records. */
const SNAPSHOT_COLUMNS = [
  'release_date', 'us_wide_date', 'us_limited_date', 'us_digital_date', 'us_release_type',
  'festival_premiere', 'keyword_flags', 'label_id', 'original_language', 'collection_id',
  'genre_ids', 'company_ids', 'budget', 'runtime', 'certification',
] as const

type LeagueRow = { tmdb_id: number; effective_release_date: string | null; metadata_fetched_at: string | null } &
  Record<(typeof SNAPSHOT_COLUMNS)[number], unknown>

interface CreditRow {
  tmdb_id: number
  tmdb_person_id: number
  role: 'director' | 'writer' | 'cast'
  billing: number | null
}

/** One snapshot per unreleased league movie per week; the week's first capture wins. */
async function writeSnapshots(
  client: SupabaseClient,
  config: IngestConfig,
  leagueRows: LeagueRow[],
  credits: CreditRow[]
): Promise<number> {
  const unreleased = leagueRows.filter(
    (r) => r.metadata_fetched_at && (r.effective_release_date === null || r.effective_release_date > config.today)
  )
  if (unreleased.length === 0) return 0
  const creditsByFilm = new Map<number, CreditRow[]>()
  for (const c of credits) {
    const list = creditsByFilm.get(c.tmdb_id)
    if (list) list.push(c)
    else creditsByFilm.set(c.tmdb_id, [c])
  }
  const week = weekOf(config.today)
  const snapshots = unreleased.map((r) => ({
    tmdb_id: r.tmdb_id,
    week,
    effective_release_date: r.effective_release_date,
    features: {
      ...Object.fromEntries(SNAPSHOT_COLUMNS.map((c) => [c, r[c]])),
      credits: (creditsByFilm.get(r.tmdb_id) ?? []).map(({ tmdb_person_id, role, billing }) => ({ tmdb_person_id, role, billing })),
    },
  }))
  let written = 0
  for (const chunk of chunks(snapshots)) {
    const { data, error } = await client
      .from('film_feature_snapshots')
      .upsert(chunk, { onConflict: 'tmdb_id,week', ignoreDuplicates: true })
      .select('tmdb_id')
    if (error) throw error
    written += data?.length ?? 0
  }
  return written
}

export async function fetchMetadataStage(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{
  metadata_fetched: number
  metadata_refreshed: number
  people_expanded: number
  collections_expanded: number
  remaining_expansion: number
  snapshots_written: number
  remaining_metadata: number
  deadline_hit: boolean
  errors: IngestError[]
}> {
  const errors: IngestError[] = []
  const clock = deps.now ?? Date.now
  const deadline = clock() + config.stageBudgetMs.metadata
  let deadline_hit = false
  let metadata_fetched = 0
  let metadata_refreshed = 0
  const fetchedAt = new Date().toISOString()

  // B1: metadata for new rows, and the weekly refresh of league movies.
  for (const row of await dueMetadata(client, config)) {
    if (clock() >= deadline) {
      deadline_hit = true
      log.info('metadata deadline reached', { fetched: metadata_fetched, stopped_at: row.tmdb_id })
      break
    }
    const isRefresh = row.metadata_fetched_at !== null
    try {
      const meta = await fetchMovieMetadata(row.tmdb_id, deps.tmdbToken)
      if (!meta) {
        // Gone from TMDb: never fetch again, and don't spend MDBList on it.
        const { error: deadEndError } = await client.from('film_corpus')
          .update({ metadata_fetched_at: fetchedAt, ratings_fetched_at: fetchedAt, ratings_absent: true })
          .eq('tmdb_id', row.tmdb_id)
        if (deadEndError) throw deadEndError
        continue
      }
      await storeMetadata(client, meta, fetchedAt)
      if (isRefresh) metadata_refreshed++
      else metadata_fetched++
    } catch (err) {
      log.warn('Metadata fetch failed', { tmdb_id: row.tmdb_id, error: serializeError(err) })
      errors.push({ stage: 'metadata', id: row.tmdb_id, error: serializeError(err) })
    }
  }

  // B2: what league movies look like this week, and who is behind them.
  // Driven entirely by stored rows, so expansion a run did not reach (or a
  // movie promoted to league priority after its metadata was fetched) is
  // picked up on the next run rather than forgotten.
  let snapshots_written = 0
  let people_expanded = 0
  let collections_expanded = 0
  let remaining_expansion = 0
  try {
    const leagueRows = await selectAll<LeagueRow>(() =>
      client.from('film_corpus')
        .select(['tmdb_id', 'effective_release_date', 'metadata_fetched_at', ...SNAPSHOT_COLUMNS].join(', '))
        .gte('priority', LEAGUE_PRIORITY)
        .order('tmdb_id')
    )
    const credits = await selectIn<CreditRow>(leagueRows.map((r) => r.tmdb_id), (chunk) =>
      client.from('film_credits').select('tmdb_id, tmdb_person_id, role, billing').in('tmdb_id', chunk)
    )

    try {
      snapshots_written = await writeSnapshots(client, config, leagueRows, credits)
    } catch (err) {
      log.warn('Feature snapshots failed', { error: serializeError(err) })
      errors.push({ stage: 'snapshots', id: 0, error: serializeError(err) })
    }

    // B3: one level of predecessors -- directors, writers and top-billed cast
    // of league movies, and their franchises. Predecessors land at
    // PREDECESSOR_PRIORITY and are never expanded themselves.
    const leadIds = [...new Set(
      credits.filter((c) => c.role !== 'cast' || (c.billing ?? Infinity) < LEAD_CAST_LIMIT).map((c) => c.tmdb_person_id)
    )]
    const collectionIds = [...new Set(leagueRows.map((r) => r.collection_id).filter((id): id is number => typeof id === 'number'))]
    const people = await selectIn<{ tmdb_person_id: number }>(leadIds, (chunk) =>
      client.from('film_people').select('tmdb_person_id').is('credits_fetched_at', null).in('tmdb_person_id', chunk)
    )
    const collections = await selectIn<{ collection_id: number }>(collectionIds, (chunk) =>
      client.from('film_collections').select('collection_id').is('parts_fetched_at', null).in('collection_id', chunk)
    )
    remaining_expansion = people.length + collections.length

    /** `fetchParts` returns the predecessors and the write that marks the source expanded. */
    const expand = async (
      stage: string,
      id: number,
      fetchParts: () => Promise<{ stubs: CorpusStub[]; stamp: () => PromiseLike<{ error: unknown }> }>
    ): Promise<boolean> => {
      try {
        const { stubs, stamp } = await fetchParts()
        await insertStubs(client, stubs)
        await promote(client, stubs.map((s) => s.tmdb_id), PREDECESSOR_PRIORITY, 0)
        const { error } = await stamp()
        if (error) throw error
        remaining_expansion--
        return true
      } catch (err) {
        log.warn('Expansion failed', { stage, id, error: serializeError(err) })
        errors.push({ stage, id, error: serializeError(err) })
        return false
      }
    }

    for (const { tmdb_person_id } of people.slice(0, config.expansionPerRun)) {
      if (clock() >= deadline) {
        deadline_hit = true
        break
      }
      const ok = await expand('expand:person', tmdb_person_id, async () => ({
        stubs: await fetchPersonPriorFilms(tmdb_person_id, deps.tmdbToken, config.minVotes, config.today, PREDECESSOR_PRIORITY),
        stamp: () => client.from('film_people').update({ credits_fetched_at: fetchedAt }).eq('tmdb_person_id', tmdb_person_id),
      }))
      if (ok) people_expanded++
    }
    for (const { collection_id } of collections.slice(0, config.expansionPerRun)) {
      if (clock() >= deadline) {
        deadline_hit = true
        break
      }
      const ok = await expand('expand:collection', collection_id, async () => {
        const { name, stubs } = await fetchCollectionParts(collection_id, deps.tmdbToken, config.today, PREDECESSOR_PRIORITY)
        return {
          stubs,
          stamp: () => client.from('film_collections').update({ name, parts_fetched_at: fetchedAt }).eq('collection_id', collection_id),
        }
      })
      if (ok) collections_expanded++
    }
  } catch (err) {
    log.warn('League expansion read failed', { error: serializeError(err) })
    errors.push({ stage: 'expand', id: 0, error: serializeError(err) })
  }

  const { count, error: countError } = await client
    .from('film_corpus')
    .select('tmdb_id', { count: 'exact', head: true })
    .is('metadata_fetched_at', null)
  if (countError) errors.push({ stage: 'metadata:count', id: 0, error: serializeError(countError) })

  return {
    metadata_fetched,
    metadata_refreshed,
    people_expanded,
    collections_expanded,
    remaining_expansion,
    snapshots_written,
    remaining_metadata: count ?? 0,
    deadline_hit,
    errors,
  }
}

// ---------------------------------------------------------------------------
// Stage C: ratings (MDBList, budget-paced)
// ---------------------------------------------------------------------------

interface DueRatingsRow {
  tmdb_id: number
  priority: number
  effective_release_date: string | null
  budget: number | null
  certification: string | null
  company_ids: number[] | null
  rt_critic: number | null
  ratings_error_count: number
}

const RATINGS_COLUMNS =
  'tmdb_id, priority, effective_release_date, budget, certification, company_ids, rt_critic, ratings_error_count'

/**
 * The three ways a row is due for an MDBList lookup. `.lte(effective date,
 * today)` also drops undated rows: there is nothing to ask MDBList about
 * until a movie is out.
 */
function ratingsQueues(config: IngestConfig): Array<(query: Query) => Query> {
  const released = (q: Query) => q.not('metadata_fetched_at', 'is', null).lte('effective_release_date', config.today)
  return [
    // Never asked.
    (q) => released(q).is('ratings_fetched_at', null),
    // Asked, but the score may still move: re-poll weekly until it settles,
    // for up to REPOLL_WINDOW_DAYS after release. A release-day 95% on 40
    // reviews must not become the permanent training label.
    (q) =>
      released(q)
        .is('rt_settled_at', null)
        .eq('ratings_error_count', 0)
        .lt('ratings_fetched_at', daysBefore(config.today, REPOLL_DAYS))
        .gte('effective_release_date', daysBefore(config.today, REPOLL_WINDOW_DAYS)),
    // The last lookup failed transiently: retry every few days, a few times.
    (q) =>
      released(q)
        .gt('ratings_error_count', 0)
        .lt('ratings_error_count', MAX_RATINGS_ERRORS)
        .lt('ratings_fetched_at', daysBefore(config.today, ERROR_RETRY_DAYS)),
  ]
}

async function countDueRatings(client: SupabaseClient, config: IngestConfig): Promise<number> {
  const counts = await Promise.all(ratingsQueues(config).map((queue) =>
    queue(client.from('film_corpus').select('tmdb_id', { count: 'exact', head: true }))
  ))
  let total = 0
  for (const { count, error } of counts) {
    if (error) throw error
    total += count ?? 0
  }
  return total
}

async function dueRatings(client: SupabaseClient, config: IngestConfig, limit: number): Promise<DueRatingsRow[]> {
  // Filters first, then order/limit: the shared mock applies each call eagerly.
  const results = await Promise.all(ratingsQueues(config).map((queue) =>
    queue(client.from('film_corpus').select(RATINGS_COLUMNS))
      .order('priority', { ascending: false })
      .order('effective_release_date', { ascending: false, nullsFirst: false })
      .limit(limit)
  ))
  const byId = new Map<number, DueRatingsRow>()
  for (const { data, error } of results) {
    if (error) throw error
    for (const row of (data ?? []) as DueRatingsRow[]) byId.set(row.tmdb_id, row)
  }
  return [...byId.values()]
    .sort((a, b) => b.priority - a.priority || (b.effective_release_date ?? '').localeCompare(a.effective_release_date ?? ''))
    .slice(0, limit)
}

export async function fetchRatingsStage(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{
  ratings_fetched: number
  ratings_absent: number
  ratings_settled: number
  remaining_ratings: number
  mdblist_used_today: number | null
  mdblist_granted: number
  mdblist_spent: number
  mdblist_stopped: RatingsStop
  deadline_hit: boolean
  errors: IngestError[]
}> {
  const errors: IngestError[] = []
  const clock = deps.now ?? Date.now
  const deadline = clock() + config.stageBudgetMs.ratings
  let deadline_hit = false
  let ratings_fetched = 0
  let ratings_absent = 0
  let ratings_settled = 0
  let mdblist_granted = 0
  let mdblist_spent = 0
  let stopped: RatingsStop = null
  let usage: Awaited<ReturnType<typeof fetchMdblistUsage>> = null

  // How much work there is, before claiming any of the day's budget.
  const pendingCount = await countDueRatings(client, config)

  if (pendingCount > 0) {
    // MDBList's own counter sees every consumer (scoring, franchise history,
    // anything outside the ledger). Without it there is no way to honour the
    // safety reserve, so spend nothing.
    usage = await (deps.fetchUsage ?? fetchMdblistUsage)(deps.mdblistApiKey)
    if (!usage) {
      stopped = 'usage_unavailable'
      errors.push({ stage: 'ratings:usage', id: 0, error: 'MDBList usage counter unavailable; spent nothing' })
    }
  }

  if (usage) {
    const headroom = Math.max(0, Math.min(config.perRunCap, usage.cap - usage.used - MDBLIST_SAFETY_RESERVE))
    const pending = headroom > 0 ? await dueRatings(client, config, headroom) : []
    const settleBy = daysBefore(config.today, SETTLED_AFTER_DAYS)

    const lookUp = async (row: DueRatingsRow): Promise<void> => {
      if (stopped) return
      if (clock() >= deadline) {
        deadline_hit = true
        return
      }
      mdblist_spent++
      const result = await fetchMDBListRatings(row.tmdb_id, deps.mdblistApiKey)
      // 429 and 401 are whole-run conditions: the rest would fail the same
      // way, and a stopped stage retries next run with nothing stamped.
      if (result.status === 429 || result.status === 401) {
        if (!stopped) log.warn('MDBList refused the request; stopping ratings stage for this run', { status: result.status })
        stopped = result.status === 429 ? 'rate_limited' : 'auth_failed'
        return
      }

      const fetchedAt = new Date().toISOString()
      let patch: Record<string, unknown>
      if (result.error && result.status !== 404) {
        // Transient (5xx, network): back off instead of retrying every run.
        errors.push({ stage: 'ratings', id: row.tmdb_id, error: result.error })
        patch = { ratings_fetched_at: fetchedAt, ratings_error_count: row.ratings_error_count + 1 }
      } else {
        const bySource = new Map(result.ratings.map((r) => [r.source, r.score]))
        const rt = bySource.get('rotten_tomatoes') ?? null
        const votes = result.details?.rt_critic_votes ?? null
        if (rt === null && row.rt_critic !== null) {
          // A Tomatometer we already hold went missing upstream: keep it.
          patch = { ratings_fetched_at: fetchedAt, ratings_error_count: 0 }
        } else {
          const settled = rt !== null && (votes ?? 0) >= SETTLED_MIN_REVIEWS &&
            row.effective_release_date !== null && row.effective_release_date <= settleBy
          patch = {
            ratings_fetched_at: fetchedAt,
            ratings_error_count: 0,
            ratings_absent: rt === null,
            rt_critic: rt,
            rt_critic_votes: votes,
            rt_settled_at: settled ? fetchedAt : null,
            metacritic: bySource.get('metacritic') ?? null,
            imdb: bySource.has('imdb') ? Math.round(bySource.get('imdb')!) / 10 : null,
          }
          if (result.details) {
            if (row.budget == null && result.details.budget !== null) patch.budget = result.details.budget
            if (!row.certification && result.details.certification) patch.certification = result.details.certification
            if ((row.company_ids ?? []).length === 0 && result.details.company_ids.length > 0) {
              patch.company_ids = result.details.company_ids
            }
          }
          if (rt === null) ratings_absent++
          else ratings_fetched++
          if (settled) ratings_settled++
        }
      }

      const { error: updateError } = await client.from('film_corpus').update(patch).eq('tmdb_id', row.tmdb_id)
      if (updateError) errors.push({ stage: 'ratings', id: row.tmdb_id, error: serializeError(updateError) })
    }

    // Reserve in small chunks as the work proceeds: a reservation is charged
    // whether or not it is spent, so one that outlives the stage deadline or
    // a 429 should strand at most a chunk, not the run's whole allowance.
    for (let i = 0; i < pending.length && !stopped && !deadline_hit; ) {
      if (clock() >= deadline) {
        deadline_hit = true
        break
      }
      const granted = await reserveApiCalls(
        client, MDBLIST_PROJECTIONS_KEY, Math.min(RESERVE_CHUNK, pending.length - i), config.dailyBudget
      )
      if (granted === 0) {
        stopped = 'budget_exhausted'
        break
      }
      mdblist_granted += granted
      await forEachConcurrently(pending.slice(i, i + granted), MDBLIST_CONCURRENCY, lookUp)
      i += granted
    }
    if (deadline_hit) log.info('ratings deadline reached', { spent: mdblist_spent })
  }

  // What is due now, on the same rules -- an unreleased row is not backlog.
  const remaining_ratings = await countDueRatings(client, config)

  return {
    ratings_fetched,
    ratings_absent,
    ratings_settled,
    remaining_ratings,
    mdblist_used_today: usage?.used ?? null,
    mdblist_granted,
    mdblist_spent,
    mdblist_stopped: stopped,
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
    league_movies: seed.league_movies,
    metadata_fetched: metadata.metadata_fetched,
    metadata_refreshed: metadata.metadata_refreshed,
    people_expanded: metadata.people_expanded,
    collections_expanded: metadata.collections_expanded,
    remaining_expansion: metadata.remaining_expansion,
    snapshots_written: metadata.snapshots_written,
    ratings_fetched: ratings.ratings_fetched,
    ratings_absent: ratings.ratings_absent,
    ratings_settled: ratings.ratings_settled,
    remaining_metadata: metadata.remaining_metadata,
    remaining_ratings: ratings.remaining_ratings,
    mdblist_used_today: ratings.mdblist_used_today,
    mdblist_granted: ratings.mdblist_granted,
    mdblist_spent: ratings.mdblist_spent,
    mdblist_stopped: ratings.mdblist_stopped,
    deadlines: {
      seed: seed.deadline_hit,
      metadata: metadata.deadline_hit,
      ratings: ratings.deadline_hit,
    },
    failed: errors.length,
    errors,
  }
}
