/**
 * Core logic for sync-release-dates, kept in a module separate from
 * index.ts so unit tests can import it without triggering index.ts's
 * top-level Deno.serve() (which would open a real listener as a side
 * effect of the import).
 *
 * Nightly cron job over the movies rostered (active draft pick or pickup) in
 * leagues whose season is not over. For movies with a future or recent
 * release date it updates changed release dates and notifies each league
 * that rosters the movie; for those, and for any rostered movie still
 * missing a poster, it refreshes poster artwork from TMDb.
 *
 * The candidate set is bounded on purpose. Completed seasons stay in
 * team_holdings forever, so the job skips them (as score_update_candidates
 * does), and outside the release-date window it only looks up movies that
 * have no poster yet. The nightly workload therefore tracks the leagues in
 * play instead of growing with every season ever played. A time budget keeps
 * a slow TMDb from pushing a run past the cron proxy's timeout: release-date
 * checks go first, and whatever is left is reported as deferred.
 *
 * Deliberately a separate function from sync-movies: sync-movies is a broad
 * TMDb discovery/upsert pass over popularity-sorted upcoming movies for a
 * year+region, unrelated to what's actually rostered anywhere. This function
 * targets the much smaller, roster-derived set and keeps that contract
 * (year/page/region pagination vs. a plain nightly diff) from mixing.
 *
 * No new storage for idempotency: a rerun re-fetches the same movies and
 * only writes changed artwork/dates and notifies for date changes, so it is
 * naturally idempotent against the current state.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import { groupHoldingsByMovie } from '../_shared/roster-holdings.ts'
import { fetchWithRetry } from '../_shared/http.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('sync-release-dates')

/** How far in the past a stored release date can be and still get updated. */
const RECENT_DAYS = 14
const MAX_FIELDS = 25
const HOLDINGS_PAGE_SIZE = 1000
// UUID filters are sent in the URL; keep each request below the gateway limit.
const LEAGUE_ID_BATCH_SIZE = 150
/**
 * No new TMDb lookup starts after this long. The Vercel cron proxy aborts the
 * request at 55s; the rest covers the Discord sends plus the purges and
 * run.finish in index.ts.
 */
const TIME_BUDGET_MS = 40_000

export interface SyncMovieRef {
  movie_id: string
  tmdb_id: number
  title: string
}

export interface SyncError extends SyncMovieRef {
  error: string
}

export interface SyncReleaseDatesResult {
  /** TMDb lookups attempted this run. */
  movies_checked: number
  dates_changed: number
  posters_updated: number
  leagues_notified: number
  /** Genuine failures (TMDb errors, invalid responses, failed writes); these drive job_status. */
  errors: SyncError[]
  /** TMDb no longer has the movie (deleted or merged). Reported so it stays findable, not a failure. */
  not_found: SyncMovieRef[]
  /** Candidates left for the next run because the time budget ran out. */
  deferred: number
}

export interface SyncReleaseDatesOptions {
  /** Clock, injectable so tests can exhaust the time budget without waiting. */
  now?: () => number
  timeBudgetMs?: number
}

interface MovieRow {
  id: string
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url: string | null
}

interface HoldingRow {
  movie_id: string
  league_id: string
  team_name: string | null
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url: string | null
}

interface TmdbMovie {
  release_date?: string | null
  poster_path?: string | null
}

type TmdbLookup =
  | { kind: 'found'; movie: TmdbMovie }
  | { kind: 'not_found' }
  | { kind: 'failed'; error: string }

/**
 * Holdings whose movie has something to refresh: a release date still inside
 * the window, or no poster yet. team_holdings carries the movie columns, so
 * the filter runs in the same query and no second movies lookup is needed.
 */
async function fetchCandidateHoldings(serviceClient: SupabaseClient, cutoffDate: string): Promise<HoldingRow[]> {
  const holdings: HoldingRow[] = []
  for (let offset = 0; ; offset += HOLDINGS_PAGE_SIZE) {
    const { data, error } = await serviceClient
      .from('team_holdings')
      .select('movie_id, league_id, team_name, tmdb_id, title, release_date, poster_url')
      .gt('tmdb_id', 0)
      .or(`release_date.gte.${cutoffDate},poster_url.is.null`)
      .order('movie_id')
      .order('league_id')
      .range(offset, offset + HOLDINGS_PAGE_SIZE - 1)

    // This job must report a failed roster query instead of a successful empty run.
    if (error) throw new Error(`Failed to fetch roster holdings: ${error.message}`)
    holdings.push(...(data ?? []) as HoldingRow[])
    if (!data || data.length < HOLDINGS_PAGE_SIZE) return holdings
  }
}

/** The subset of `leagueIds` whose season is over; their rosters are frozen. */
async function fetchCompletedLeagueIds(serviceClient: SupabaseClient, leagueIds: string[]): Promise<Set<string>> {
  const completed = new Set<string>()
  for (let i = 0; i < leagueIds.length; i += LEAGUE_ID_BATCH_SIZE) {
    const { data, error } = await serviceClient
      .from('leagues')
      .select('id')
      .in('id', leagueIds.slice(i, i + LEAGUE_ID_BATCH_SIZE))
      .eq('status', 'completed')
    if (error) throw new Error(`Failed to fetch league statuses: ${error.message}`)
    for (const row of data ?? []) completed.add(row.id)
  }
  return completed
}

function storedPosterPath(posterUrl: string | null): string | null {
  return posterUrl?.match(/^https?:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)(\/[^?#]+)(?:[?#].*)?$/)?.[1]
    ?? posterUrl
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
}

/** Fetches authoritative movie metadata. A 404 means TMDb no longer has the movie, not a failed lookup. */
async function fetchTmdbMovie(
  tmdbId: number,
  token: string,
  fetchImpl: typeof fetch
): Promise<TmdbLookup> {
  try {
    const response = await fetchWithRetry(
      `https://api.themoviedb.org/3/movie/${tmdbId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      { timeoutMs: 10_000, retries: 1 },
      fetchImpl
    )
    if (response.status === 404) {
      await response.body?.cancel().catch(() => {})
      log.warn('TMDb movie not found', { tmdb_id: tmdbId })
      return { kind: 'not_found' }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      log.warn('TMDb lookup failed', { tmdb_id: tmdbId, status: response.status })
      return { kind: 'failed', error: `TMDb lookup failed with status ${response.status}` }
    }
    const data = await response.json()
    if (!data || data.id !== tmdbId || typeof data.title !== 'string' || !data.title.trim()) {
      log.warn('Invalid TMDb movie response', { tmdb_id: tmdbId })
      return { kind: 'failed', error: 'Invalid TMDb movie response' }
    }
    return { kind: 'found', movie: data }
  } catch (error) {
    log.warn('TMDb lookup error', { tmdb_id: tmdbId, error: serializeError(error) })
    return { kind: 'failed', error: `TMDb lookup error: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function runSyncReleaseDates(
  serviceClient: SupabaseClient,
  tmdbToken: string,
  fetchImpl: typeof fetch = fetch,
  options: SyncReleaseDatesOptions = {}
): Promise<SyncReleaseDatesResult> {
  const now = options.now ?? Date.now
  const timeBudgetMs = options.timeBudgetMs ?? TIME_BUDGET_MS
  const startedAt = now()

  const recentCutoff = new Date()
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - RECENT_DAYS)
  const cutoffDate = recentCutoff.toISOString().split('T')[0]

  const candidateHoldings = await fetchCandidateHoldings(serviceClient, cutoffDate)
  const completedLeagueIds = await fetchCompletedLeagueIds(
    serviceClient,
    [...new Set(candidateHoldings.map((row) => row.league_id))]
  )
  const activeHoldings = candidateHoldings.filter((row) => !completedLeagueIds.has(row.league_id))

  const holdingsByMovie = groupHoldingsByMovie(activeHoldings.map((row) => ({
    movieId: row.movie_id,
    leagueId: row.league_id,
    teamName: row.team_name ?? 'A team',
  })))
  const moviesById = new Map<string, MovieRow>()
  for (const row of activeHoldings) {
    moviesById.set(row.movie_id, {
      id: row.movie_id,
      tmdb_id: row.tmdb_id,
      title: row.title,
      release_date: row.release_date,
      poster_url: row.poster_url,
    })
  }

  // Release-date checks go first so a run that hits the time budget only
  // defers poster repairs, which can wait a night.
  const inDateWindow = (movie: MovieRow) => movie.release_date !== null && movie.release_date >= cutoffDate
  const candidates = [...moviesById.values()]
    .sort((a, b) => Number(inDateWindow(b)) - Number(inDateWindow(a)))

  // leagueId -> changes to report in that league's embed
  const changesByLeague = new Map<
    string,
    Array<{ title: string; teamName: string; previousDate: string; newDate: string }>
  >()
  let moviesChecked = 0
  let datesChanged = 0
  let postersUpdated = 0
  const errors: SyncError[] = []
  const notFound: SyncMovieRef[] = []

  for (const movie of candidates) {
    if (now() - startedAt >= timeBudgetMs) break
    moviesChecked++

    const movieRef = { movie_id: movie.id, tmdb_id: movie.tmdb_id, title: movie.title }
    const lookup = await fetchTmdbMovie(movie.tmdb_id, tmdbToken, fetchImpl)
    // Small delay between sequential TMDb lookups, matching sync-movies.
    await new Promise((resolve) => setTimeout(resolve, 50))

    if (lookup.kind === 'not_found') {
      notFound.push(movieRef)
      continue
    }
    if (lookup.kind === 'failed') {
      errors.push({ ...movieRef, error: lookup.error })
      continue
    }

    const previousDate = movie.release_date
    const newDate = lookup.movie.release_date
    const dateChanged = previousDate !== null && previousDate >= cutoffDate
      && typeof newDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(newDate) && newDate !== previousDate
    const posterPath = lookup.movie.poster_path
    const posterChanged = typeof posterPath === 'string' && /^\/[^/?#\s]+\.(?:jpg|jpeg|png|webp)$/i.test(posterPath)
      && posterPath !== storedPosterPath(movie.poster_url)

    // A missing upstream poster never erases usable artwork. Poster changes
    // are independent of release dates, including older or undated movies.
    if (!dateChanged && !posterChanged) continue
    const patch: { release_date?: string; poster_url?: string } = {}
    if (dateChanged) patch.release_date = newDate
    if (posterChanged) patch.poster_url = `https://image.tmdb.org/t/p/w500${posterPath}`

    const { error: updateError } = await serviceClient
      .from('movies')
      .update(patch)
      .eq('id', movie.id)
      .select('id')
      .single()

    if (updateError) {
      errors.push({ ...movieRef, error: `Failed to update movie metadata: ${updateError.message}` })
      log.error('Failed to update movie metadata', { movie_id: movie.id, error: serializeError(updateError) })
      continue
    }

    if (posterChanged) postersUpdated++
    if (!dateChanged) continue
    datesChanged++

    for (const holding of holdingsByMovie.get(movie.id) ?? []) {
      const bucket = changesByLeague.get(holding.leagueId) ?? []
      bucket.push({
        title: movie.title,
        teamName: holding.teamName,
        previousDate,
        newDate,
      })
      changesByLeague.set(holding.leagueId, bucket)
    }
  }

  const deferred = candidates.length - moviesChecked
  if (deferred > 0) {
    log.warn('Time budget reached; remaining movies deferred to the next run', {
      checked: moviesChecked,
      deferred,
      time_budget_ms: timeBudgetMs,
    })
  }

  let leaguesNotified = 0

  for (const [leagueId, changes] of changesByLeague) {
    const leagueName = await getLeagueName(serviceClient, leagueId)
    const fields = changes.slice(0, MAX_FIELDS).map((c) => ({
      name: c.title,
      value: `Moved from **${formatDate(c.previousDate)}** to **${formatDate(c.newDate)}** -- picked by **${c.teamName}**`,
      inline: false,
    }))

    await sendDiscordNotification(serviceClient, {
      leagueId,
      category: 'movie_news',
      embeds: [{
        author: buildEmbedAuthor(leagueName, leagueId),
        title: '📅 Release date change',
        description: `${changes.length} rostered ${changes.length === 1 ? 'movie has' : 'movies have'} a new release date`,
        fields,
        color: DISCORD_COLORS.yellow,
        footer: { text: leagueName },
        url: buildLeagueUrl(leagueId, '/standings'),
      }],
    })

    leaguesNotified++
  }

  return {
    movies_checked: moviesChecked,
    dates_changed: datesChanged,
    posters_updated: postersUpdated,
    leagues_notified: leaguesNotified,
    errors,
    not_found: notFound,
    deferred,
  }
}
