/**
 * Core logic for sync-release-dates, kept in a module separate from
 * index.ts so unit tests can import it without triggering index.ts's
 * top-level Deno.serve() (which would open a real listener as a side
 * effect of the import).
 *
 * Nightly cron job. For every movie currently rostered in a league (active
 * draft pick or pickup) with a future or recent release date, re-fetches the
 * release date from TMDb. When it has moved, updates movies.release_date and
 * notifies each league that rosters the movie.
 *
 * Deliberately a separate function from sync-movies: sync-movies is a broad
 * TMDb discovery/upsert pass over popularity-sorted upcoming movies for a
 * year+region, unrelated to what's actually rostered anywhere. This function
 * targets the much smaller, roster-derived set and keeps that contract
 * (year/page/region pagination vs. a plain nightly diff) from mixing.
 *
 * No new storage for idempotency: a rerun re-fetches the same movies and
 * only writes/notifies when the stored date differs from TMDb's, so it is
 * naturally idempotent against the current state.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import { fetchRosterHoldings, groupHoldingsByMovie } from '../_shared/roster-holdings.ts'
import { fetchWithRetry } from '../_shared/http.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('sync-release-dates')

/** How far in the past a release date can be and still get re-checked. */
const RECENT_DAYS = 14
const MAX_FIELDS = 25

export interface SyncReleaseDatesResult {
  movies_checked: number
  dates_changed: number
  leagues_notified: number
}

interface MovieRow {
  id: string
  tmdb_id: number
  title: string
  release_date: string
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
}

/** Fetches the current release_date for a movie from TMDb. Returns null on any failure. */
async function fetchTmdbReleaseDate(
  tmdbId: number,
  token: string,
  fetchImpl: typeof fetch
): Promise<string | null> {
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
    const data: { release_date?: string } = await response.json()
    return data.release_date || null
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

  const { data: movies, error: moviesError } = await serviceClient
    .from('movies')
    .select('id, tmdb_id, title, release_date')
    .gte('release_date', cutoffDate)
    .gt('tmdb_id', 0)

  if (moviesError) {
    throw new Error(`Failed to fetch candidate movies: ${moviesError.message}`)
  }

  if (!movies || movies.length === 0) {
    return { movies_checked: 0, dates_changed: 0, leagues_notified: 0 }
  }

  // Restrict to movies that are actually rostered somewhere -- this is what
  // makes the job small; sync-movies' discover feed populates far more
  // movies than any league ever drafts or picks up. Holdings are fetched
  // unfiltered (rosters are inherently small) rather than passing thousands
  // of candidate IDs through a URI-length-limited `in` filter.
  const holdingsByMovie = groupHoldingsByMovie(await fetchRosterHoldings(serviceClient))

  const rosteredMovies = (movies as MovieRow[]).filter((m) => holdingsByMovie.has(m.id))

  if (rosteredMovies.length === 0) {
    return { movies_checked: 0, dates_changed: 0, leagues_notified: 0 }
  }

  // leagueId -> changes to report in that league's embed
  const changesByLeague = new Map<
    string,
    Array<{ title: string; teamName: string; previousDate: string; newDate: string }>
  >()

  for (const movie of rosteredMovies) {
    const newDate = await fetchTmdbReleaseDate(movie.tmdb_id, tmdbToken, fetchImpl)
    // Small delay to respect TMDb rate limits (40 requests / 10s), matching sync-movies.
    await new Promise((resolve) => setTimeout(resolve, 50))

    if (!newDate || newDate === movie.release_date) continue

    const { error: updateError } = await serviceClient
      .from('movies')
      .update({ release_date: newDate })
      .eq('id', movie.id)

    if (updateError) {
      log.error('Failed to update release_date', { movie_title: movie.title, error: serializeError(updateError) })
      continue
    }

    for (const holding of holdingsByMovie.get(movie.id) ?? []) {
      const bucket = changesByLeague.get(holding.leagueId) ?? []
      bucket.push({
        title: movie.title,
        teamName: holding.teamName,
        previousDate: movie.release_date,
        newDate,
      })
      changesByLeague.set(holding.leagueId, bucket)
    }
  }

  let leaguesNotified = 0
  let datesChanged = 0

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
    datesChanged += changes.length
  }

  return {
    movies_checked: rosteredMovies.length,
    dates_changed: datesChanged,
    leagues_notified: leaguesNotified,
  }
}
