import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const COMPACT_THRESHOLD = 8

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

    // Look up league from channel
    const { data: channelLink, error: findError } = await supabase
      .from('discord_channels')
      .select('league_id, leagues(name)')
      .eq('channel_id', interaction.channelId)
      .maybeSingle()

    if (findError || !channelLink) {
      await interaction.editReply(
        'This channel is not linked to a league. Use /set-league first.'
      )
      return
    }

    const leagueId = channelLink.league_id
    const leagueName = (channelLink as { leagues?: { name?: string } }).leagues?.name || 'League'

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

    // Get draft picks with movie details
    const { data: picks, error: picksError } = await supabase
      .from('draft_picks')
      .select(`
        round,
        movies(
          title,
          release_date,
          fantasy_points,
          reviews(source, score)
        )
      `)
      .eq('team_id', team.id)
      .eq('league_id', leagueId)
      .order('round', { ascending: true })

    if (picksError) {
      console.error('Failed to fetch roster:', picksError)
      await interaction.editReply('Failed to load roster. Please try again.')
      return
    }

    if (!picks || picks.length === 0) {
      const embed = createBaseEmbed(leagueName, leagueId)
        .setTitle(team.name)
        .setDescription('No movies yet.')
        .setColor(DISCORD_COLORS.gold)

      await interaction.editReply({ embeds: [embed] })
      return
    }

    const isCompact = picks.length >= COMPACT_THRESHOLD

    const lines = picks.map((pick) => {
      const movie = pick.movies as {
        title?: string
        release_date?: string
        fantasy_points?: number | null
        reviews?: Array<{ source?: string; score?: number | null }>
      } | null

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
      .setDescription(lines.join('\n'))
      .setColor(DISCORD_COLORS.gold)
      .setURL(leagueUrl(leagueId))
      .setFooter({ text: `${picks.length} movies -- ${leagueName}` })

    await interaction.editReply({ embeds: [embed] })
  },
}
