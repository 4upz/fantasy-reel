import { AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, FANTASY_REEL_ICON, leagueUrl } from '../utils/embeds.js'
import { resolveLinkedLeague } from '../utils/channel-league.js'
import { getMovieDetails, searchMovies, TMDbSearchResult } from '../utils/functions-client.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const AUTOCOMPLETE_LIMIT = 10
const ALTERNATE_LIMIT = 4

const REVIEW_LABELS: Record<string, string> = {
  imdb: 'IMDb',
  rotten_tomatoes: 'RT',
  metacritic: 'Metacritic',
}

interface DbMovieRow {
  id: string
  title: string
  release_date: string | null
  poster_url: string | null
  fantasy_points: number | null
  combined_score: number | null
  reviews: Array<{ source: string; score: number | null }>
}

function releaseYear(releaseDate: string | null | undefined): string {
  return releaseDate ? new Date(releaseDate).getFullYear().toString() : 'TBD'
}

/**
 * Name of the team currently holding `movieId` in this league, or null if it is
 * unowned. `team_holdings` already excludes dropped picks and pickups, and a
 * movie can be held by at most one team at a time.
 */
async function findRosterStatus(
  supabase: ReturnType<typeof getSupabase>,
  leagueId: string,
  movieId: string
): Promise<string | null> {
  const { data: holding } = await supabase
    .from('team_holdings')
    .select('team_name')
    .eq('league_id', leagueId)
    .eq('movie_id', movieId)
    .maybeSingle<{ team_name: string | null }>()

  return holding?.team_name || null
}

export const movie: Command = {
  data: new SlashCommandBuilder()
    .setName('movie')
    .setDescription('Look up a movie')
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Movie title')
        .setRequired(true)
        .setAutocomplete(true)
    ) as SlashCommandBuilder,

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused()

    if (!focused || focused.trim().length < 2) {
      await interaction.respond([]).catch(() => {})
      return
    }

    try {
      const { data } = await searchMovies(focused)
      const choices = (data?.results || []).slice(0, AUTOCOMPLETE_LIMIT).map((r) => ({
        name: truncate(`${r.title} (${releaseYear(r.release_date)})`, 100),
        value: r.tmdb_id.toString(),
      }))
      await interaction.respond(choices)
    } catch (err) {
      console.error('Movie autocomplete failed:', err)
      await interaction.respond([]).catch(() => {})
    }
  },

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const input = interaction.options.getString('name', true).trim()
    const supabase = getSupabase()
    const linked = await resolveLinkedLeague(supabase, interaction.channelId)

    const isTmdbId = /^\d+$/.test(input)
    let tmdbId: number
    let title: string
    let releaseDate: string | null
    let posterUrl: string | null
    let alternates: TMDbSearchResult[] = []

    if (isTmdbId) {
      tmdbId = parseInt(input, 10)
      const { data: details, error } = await getMovieDetails(tmdbId)
      if (error || !details) {
        await interaction.editReply('Failed to look up that movie. Please try again.')
        return
      }
      title = details.title
      releaseDate = details.release_date
      posterUrl = details.poster_url
    } else {
      const { data: searchData, error } = await searchMovies(input)
      if (error) {
        console.error('Movie search failed:', error)
        await interaction.editReply('Failed to search for movies. Please try again.')
        return
      }
      if (!searchData || searchData.results.length === 0) {
        await interaction.editReply(`No movies found matching "${input}".`)
        return
      }
      const [best, ...rest] = searchData.results
      tmdbId = best.tmdb_id
      title = best.title
      releaseDate = best.release_date
      posterUrl = best.poster_url
      alternates = rest.slice(0, ALTERNATE_LIMIT)
    }

    const { data: dbMovie } = await supabase
      .from('movies')
      .select('id, title, release_date, poster_url, fantasy_points, combined_score, reviews(source, score)')
      .eq('tmdb_id', tmdbId)
      .maybeSingle<DbMovieRow>()

    const descriptionParts: string[] = []
    descriptionParts.push(`**Release:** ${releaseDate ? new Date(releaseDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'TBD'}`)

    if (dbMovie) {
      const reviewLines = (dbMovie.reviews || [])
        .filter((r) => r.score != null)
        .map((r) => `${REVIEW_LABELS[r.source] || r.source}: ${r.score}`)
      if (reviewLines.length > 0) {
        descriptionParts.push(`**Critic Scores:** ${reviewLines.join(' | ')}`)
      }
      if (dbMovie.fantasy_points != null) {
        descriptionParts.push(`**Fantasy Points:** ${dbMovie.fantasy_points}`)
      }
    }

    if (linked) {
      const rosterTeam = dbMovie ? await findRosterStatus(supabase, linked.leagueId, dbMovie.id) : null
      descriptionParts.push(rosterTeam ? `**Roster Status:** Owned by ${rosterTeam}` : '**Roster Status:** Available')
    } else {
      descriptionParts.push('_Link this channel with /set-league to see roster status._')
    }

    if (alternates.length > 0) {
      const altLines = alternates.map((a) => `${a.title} (${releaseYear(a.release_date)})`).join('\n')
      descriptionParts.push('', '**Other matches:**', altLines)
    }

    const embed = linked
      ? createBaseEmbed(linked.leagueName, linked.leagueId).setURL(leagueUrl(linked.leagueId))
      : new EmbedBuilder().setAuthor({ name: 'Fantasy Reel', iconURL: FANTASY_REEL_ICON })

    embed
      .setTitle(`${title} (${releaseYear(releaseDate)})`)
      .setDescription(descriptionParts.join('\n').slice(0, 4096))
      .setColor(DISCORD_COLORS.gold)
      .setThumbnail(posterUrl)

    await interaction.editReply({ embeds: [embed] })
  },
}
