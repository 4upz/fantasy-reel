/**
 * Core logic for weekly-releases-digest, kept in a module separate from
 * index.ts so unit tests can import it without triggering index.ts's
 * top-level Deno.serve() (which would open a real listener as a side
 * effect of the import).
 *
 * Monday cron job. For each league, finds rostered movies releasing during
 * the current calendar week (Monday-Sunday, computed from today regardless
 * of the exact day this runs) and sends one grouped-by-day digest embed.
 * Leagues with nothing releasing this week receive no message.
 *
 * No idempotency tracking -- unlike release-day-announcements, a rerun in
 * the same week resending the same digest is an acceptable duplicate, not a
 * correctness bug, and the plan does not require guarding it.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import { fetchRosterHoldings, groupHoldingsByLeague } from '../_shared/roster-holdings.ts'

const MAX_FIELDS = 25

export interface WeeklyDigestResult {
  leagues_notified: number
  movies_included: number
  week_start: string
  week_end: string
}

interface MovieRow {
  id: string
  title: string
  release_date: string
}

/** Monday..Sunday (UTC) of the week containing `date`. */
export function weekBounds(date: Date): { start: string; end: string } {
  const day = date.getUTCDay() // 0 = Sunday
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setUTCDate(date.getUTCDate() + mondayOffset)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  const toISODate = (d: Date) => d.toISOString().split('T')[0]
  return { start: toISODate(monday), end: toISODate(sunday) }
}

function formatDayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export async function runWeeklyReleasesDigest(serviceClient: SupabaseClient): Promise<WeeklyDigestResult> {
  const { start, end } = weekBounds(new Date())

  const { data: movies, error: moviesError } = await serviceClient
    .from('movies')
    .select('id, title, release_date')
    .gte('release_date', start)
    .lte('release_date', end)

  if (moviesError) {
    throw new Error(`Failed to fetch movies releasing this week: ${moviesError.message}`)
  }

  if (!movies || movies.length === 0) {
    return { leagues_notified: 0, movies_included: 0, week_start: start, week_end: end }
  }

  const movieById = new Map((movies as MovieRow[]).map((m) => [m.id, m]))
  const movieIds = [...movieById.keys()]

  const byLeague = groupHoldingsByLeague(await fetchRosterHoldings(serviceClient, movieIds))

  let leaguesNotified = 0
  let moviesIncluded = 0

  for (const [leagueId, holdings] of byLeague) {
    // Group by release day, in date order
    const byDay = new Map<string, Array<{ title: string; teamName: string }>>()
    for (const h of holdings) {
      const movie = movieById.get(h.movieId)
      if (!movie) continue
      const bucket = byDay.get(movie.release_date) ?? []
      bucket.push({ title: movie.title, teamName: h.teamName })
      byDay.set(movie.release_date, bucket)
    }

    const sortedDays = [...byDay.keys()].sort()
    const fields = sortedDays.slice(0, MAX_FIELDS).map((day) => ({
      name: formatDayLabel(day),
      value: byDay.get(day)!.map((m) => `${m.title} (${m.teamName})`).join('\n'),
      inline: false,
    }))

    const leagueName = await getLeagueName(serviceClient, leagueId)
    const movieCount = holdings.length

    await sendDiscordNotification(serviceClient, {
      leagueId,
      category: 'weekly_digest',
      embeds: [{
        author: buildEmbedAuthor(leagueName, leagueId),
        title: '📅 This week in your league',
        description: `${movieCount} rostered ${movieCount === 1 ? 'movie releases' : 'movies release'} this week`,
        fields,
        color: DISCORD_COLORS.blue,
        footer: { text: leagueName },
        url: buildLeagueUrl(leagueId, '/standings'),
      }],
    })

    leaguesNotified++
    moviesIncluded += movieCount
  }

  return { leagues_notified: leaguesNotified, movies_included: moviesIncluded, week_start: start, week_end: end }
}
