import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { requireLinkedLeague } from '../utils/channel-league.js'
import { fetchTeamHoldings } from '../utils/roster.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const COMPACT_THRESHOLD = 8

const MOVIE_FIELDS = 'movies(title, release_date, fantasy_points, reviews(source, score))'

interface RosterRow {
  movies: {
    title?: string
    release_date?: string | null
    fantasy_points?: number | null
    reviews?: Array<{ source?: string; score?: number | null }>
  } | null
}

export const roster: Command = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('View a team\'s movie roster')
    .addStringOption((option) =>
      option
        .setName('team')
        .setDescription('Team name')
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const teamNameInput = interaction.options.getString('team', true)
    const supabase = getSupabase()

    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName } = linked

    // Find team by name (case-insensitive) within this league
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, name, league_participants!inner(league_id)')
      .eq('league_participants.league_id', leagueId)
      .ilike('name', teamNameInput)

    if (teamsError || !teams || teams.length === 0) {
      await interaction.editReply(
        `Team "${teamNameInput}" not found in this league.`
      )
      return
    }

    const team = teams[0]

    const { data: rosterRows, error: rosterError } = await fetchTeamHoldings<RosterRow>(
      supabase,
      team.id,
      MOVIE_FIELDS
    )

    if (rosterError) {
      console.error('Failed to fetch roster:', rosterError)
      await interaction.editReply('Failed to load roster. Please try again.')
      return
    }

    if (rosterRows.length === 0) {
      const embed = createBaseEmbed(leagueName, leagueId)
        .setTitle(team.name)
        .setDescription('No movies yet.')
        .setColor(DISCORD_COLORS.gold)

      await interaction.editReply({ embeds: [embed] })
      return
    }

    const isCompact = rosterRows.length >= COMPACT_THRESHOLD

    const lines = rosterRows.map((row) => {
      const movie = row.movies

      if (!movie) return '- Unknown movie'

      const title = truncate(movie.title || 'Untitled', 40)
      const points = movie.fantasy_points
      const pointsStr = points != null ? `${points} pts` : 'Unreleased'

      if (isCompact) {
        return `**${title}** -- ${pointsStr}`
      }

      // Full format: two lines
      const releaseDate = movie.release_date
        ? new Date(movie.release_date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : 'TBD'

      const reviews = movie.reviews || []
      const scoreDetails = reviews
        .filter((r) => r.score != null)
        .map((r) => `${r.source}: ${r.score}`)
        .join(' | ')

      const secondLine = scoreDetails
        ? `  Opens ${releaseDate} -- ${scoreDetails}`
        : `  Opens ${releaseDate}`

      return `**${title}** -- ${pointsStr}\n${secondLine}`
    })

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle(team.name)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setColor(DISCORD_COLORS.gold)
      .setURL(leagueUrl(leagueId))
      .setFooter({ text: `${rosterRows.length} movies -- ${leagueName}` })

    await interaction.editReply({ embeds: [embed] })
  },
}
