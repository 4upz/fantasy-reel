/**
 * Core logic for release-day-announcements, kept in a module separate from
 * index.ts so unit tests can import it without triggering index.ts's
 * top-level Deno.serve() (which would open a real listener as a side
 * effect of the import).
 *
 * Daily cron job. For each league, finds rostered movies (active draft picks
 * or pickups) releasing today and sends one "releasing today" embed per
 * league listing them.
 *
 * Idempotency: each (league, movie) announcement is recorded in
 * discord_notification_log before the notification is dispatched, so a
 * same-day cron rerun (or a manual retry) never double-announces. A movie
 * only has one release day, so the log entry never needs to expire.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import { fetchRosterHoldings, groupHoldingsByLeague } from '../_shared/roster-holdings.ts'

const NOTIFICATION_TYPE = 'release_day'
const MAX_FIELDS = 25

export interface ReleaseDayResult {
  leagues_notified: number
  movies_announced: number
}

interface MovieRow {
  id: string
  title: string
  poster_url: string | null
}

export async function runReleaseDayAnnouncements(
  serviceClient: SupabaseClient
): Promise<ReleaseDayResult> {
  const today = new Date().toISOString().split('T')[0]

  const { data: movies, error: moviesError } = await serviceClient
    .from('movies')
    .select('id, title, poster_url')
    .eq('release_date', today)

  if (moviesError) {
    throw new Error(`Failed to fetch movies releasing today: ${moviesError.message}`)
  }

  if (!movies || movies.length === 0) {
    return { leagues_notified: 0, movies_announced: 0 }
  }

  const movieById = new Map((movies as MovieRow[]).map((m) => [m.id, m]))
  const movieIds = [...movieById.keys()]

  const byLeague = groupHoldingsByLeague(await fetchRosterHoldings(serviceClient, movieIds))

  let leaguesNotified = 0
  let moviesAnnounced = 0

  for (const [leagueId, holdings] of byLeague) {
    const { data: alreadyLogged, error: logError } = await serviceClient
      .from('discord_notification_log')
      .select('movie_id')
      .eq('league_id', leagueId)
      .eq('notification_type', NOTIFICATION_TYPE)
      .in('movie_id', holdings.map((h) => h.movieId))

    if (logError) {
      console.error(`Failed to check notification log for league ${leagueId}:`, logError)
      continue
    }

    const loggedMovieIds = new Set((alreadyLogged ?? []).map((r: { movie_id: string }) => r.movie_id))
    const unsent = holdings.filter((h) => !loggedMovieIds.has(h.movieId))
    if (unsent.length === 0) continue

    // Record before dispatching: sendDiscordNotification never throws, and a
    // rerun must not re-announce even if the webhook delivery itself fails.
    const { error: insertError } = await serviceClient
      .from('discord_notification_log')
      .insert(
        unsent.map((h) => ({
          league_id: leagueId,
          movie_id: h.movieId,
          notification_type: NOTIFICATION_TYPE,
        }))
      )

    if (insertError) {
      console.error(`Failed to record notification log for league ${leagueId}:`, insertError)
      continue
    }

    const leagueName = await getLeagueName(serviceClient, leagueId)
    const shown = unsent.slice(0, MAX_FIELDS)
    const fields = shown.map((h) => ({
      name: movieById.get(h.movieId)?.title ?? 'Unknown movie',
      value: `Picked by **${h.teamName}**`,
      inline: true,
    }))

    const firstPoster = unsent
      .map((h) => movieById.get(h.movieId)?.poster_url)
      .find((url): url is string => Boolean(url))

    await sendDiscordNotification(serviceClient, {
      leagueId,
      category: 'movie_news',
      embeds: [{
        author: buildEmbedAuthor(leagueName, leagueId),
        title: '🎬 Releasing today',
        description: `${unsent.length} rostered ${unsent.length === 1 ? 'movie' : 'movies'} out now`,
        thumbnail: firstPoster ? { url: `https://image.tmdb.org/t/p/w92${firstPoster}` } : undefined,
        fields,
        color: DISCORD_COLORS.gold,
        footer: { text: leagueName },
        url: buildLeagueUrl(leagueId, '/standings'),
      }],
    })

    leaguesNotified++
    moviesAnnounced += unsent.length
  }

  return { leagues_notified: leaguesNotified, movies_announced: moviesAnnounced }
}
