/**
 * Core logic for sync-release-dates, kept in a module separate from
 * index.ts so unit tests can import it without triggering index.ts's
 * top-level Deno.serve() (which would open a real listener as a side
 * effect of the import).
 *
 * Nightly cron job. For every movie currently rostered in a league (active
 * draft pick or pickup), refreshes poster artwork from TMDb. For movies with
 * a future or recent release date, also updates changed release dates and
 * notifies each league that rosters the movie.
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
import { groupHoldingsByMovie, type RosterHolding } from '../_shared/roster-holdings.ts'
import { fetchWithRetry } from '../_shared/http.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('sync-release-dates')

/** How far in the past a release date can be and still get re-checked. */
const RECENT_DAYS = 14
const MAX_FIELDS = 25
const HOLDINGS_PAGE_SIZE = 1000
// UUID filters are sent in the URL; keep each request below the gateway limit.
const MOVIE_ID_BATCH_SIZE = 150

export interface SyncReleaseDatesResult {
  movies_checked: number
  dates_changed: number
  posters_updated: number
  leagues_notified: number
  failed: number
}

interface MovieRow {
  id: string
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url: string | null
}

interface TmdbMovie {
  release_date?: string | null
  poster_path?: string | null
}

async function fetchHoldings(serviceClient: SupabaseClient): Promise<RosterHolding[]> {
  const holdings: RosterHolding[] = []
  for (let offset = 0; ; offset += HOLDINGS_PAGE_SIZE) {
    const { data, error } = await serviceClient
      .from('team_holdings')
      .select('movie_id, league_id, team_name')
      .order('movie_id')
      .order('league_id')
      .range(offset, offset + HOLDINGS_PAGE_SIZE - 1)

    // This job must report a failed roster query instead of a successful empty run.
    if (error) throw new Error(`Failed to fetch roster holdings: ${error.message}`)
    for (const row of data ?? []) {
      holdings.push({ movieId: row.movie_id, leagueId: row.league_id, teamName: row.team_name ?? 'A team' })
    }
    if (!data || data.length < HOLDINGS_PAGE_SIZE) return holdings
  }
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

/** Fetches authoritative movie metadata; null means the lookup failed. */
async function fetchTmdbMovie(
  tmdbId: number,
  token: string,
  fetchImpl: typeof fetch
): Promise<TmdbMovie | null> {
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
    if (!response.ok) {
      log.warn('TMDb lookup failed', { tmdb_id: tmdbId, status: response.status })
      return null
    }
    const data = await response.json()
    if (!data || data.id !== tmdbId || typeof data.title !== 'string' || !data.title.trim()) {
      log.warn('Invalid TMDb movie response', { tmdb_id: tmdbId })
      return null
    }
    return data
  } catch (error) {
    log.warn('TMDb lookup error', { tmdb_id: tmdbId, error: serializeError(error) })
    return null
  }
}

export async function runSyncReleaseDates(
  serviceClient: SupabaseClient,
  tmdbToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<SyncReleaseDatesResult> {
  const recentCutoff = new Date()
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - RECENT_DAYS)
  const cutoffDate = recentCutoff.toISOString().split('T')[0]

  const holdingsByMovie = groupHoldingsByMovie(await fetchHoldings(serviceClient))
  const movieIds = [...holdingsByMovie.keys()]
  const rosteredMovies: MovieRow[] = []
  for (let i = 0; i < movieIds.length; i += MOVIE_ID_BATCH_SIZE) {
    const { data, error } = await serviceClient
      .from('movies')
      .select('id, tmdb_id, title, release_date, poster_url')
      .in('id', movieIds.slice(i, i + MOVIE_ID_BATCH_SIZE))
      .gt('tmdb_id', 0)
    if (error) throw new Error(`Failed to fetch rostered movies: ${error.message}`)
    rosteredMovies.push(...(data ?? []) as MovieRow[])
  }

  // leagueId -> changes to report in that league's embed
  const changesByLeague = new Map<
    string,
    Array<{ title: string; teamName: string; previousDate: string; newDate: string }>
  >()
  let datesChanged = 0
  let postersUpdated = 0
  let failed = 0

  for (const movie of rosteredMovies) {
    const metadata = await fetchTmdbMovie(movie.tmdb_id, tmdbToken, fetchImpl)
    // Keep the existing pause between sequential TMDb lookups.
    await new Promise((resolve) => setTimeout(resolve, 50))

    if (!metadata) {
      failed++
      continue
    }

    const previousDate = movie.release_date
    const newDate = metadata.release_date
    const dateChanged = previousDate !== null && previousDate >= cutoffDate
      && typeof newDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(newDate) && newDate !== previousDate
    const posterPath = metadata.poster_path
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
      failed++
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
    movies_checked: rosteredMovies.length,
    dates_changed: datesChanged,
    posters_updated: postersUpdated,
    leagues_notified: leaguesNotified,
    failed,
  }
}
