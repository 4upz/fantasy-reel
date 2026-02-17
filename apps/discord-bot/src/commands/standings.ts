import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import type { Command } from './index.js'

export const standings: Command = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show league standings for this channel') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()

    // Look up league from channel
    const { data: channelLink, error: findError } = await supabase
      .from('discord_channels')
      .select('league_id, leagues(name, status)')
      .eq('channel_id', interaction.channelId)
      .maybeSingle()

    if (findError || !channelLink) {
      await interaction.editReply(
        'This channel is not linked to a league. Use /set-league first.'
      )
      return
    }

    const league = (channelLink as { leagues?: { name?: string; status?: string } }).leagues
    const leagueId = channelLink.league_id
    const leagueName = league?.name || 'League'

    // Resolve invoker's user ID for "(you)" indicator
    const { data: userId } = await supabase.rpc(
      'get_user_by_discord_id',
      { p_discord_id: interaction.user.id }
    )

    // Get standings: team_scores joined with teams, participants, and profiles
    const { data: scores, error: scoresError } = await supabase
      .from('team_scores')
      .select(`
        total_points,
        last_updated,
        teams(
          id,
          name,
          league_participants(
            user_id,
            profiles(display_name)
          )
        )
      `)
      .eq('teams.league_participants.league_id', leagueId)
      .order('total_points', { ascending: false })

    // Filter to only scores for teams in this league
    const leagueScores = (scores || []).filter((s) => {
      const team = s.teams as { id?: string; league_participants?: { user_id?: string } } | null
      return team?.league_participants != null
    })

    if (scoresError || leagueScores.length === 0) {
      const embed = createBaseEmbed(leagueName, leagueId)
        .setTitle('Standings')
        .setDescription(
          `No standings yet.\n\nLeague status: **${league?.status || 'unknown'}**`
        )
        .setColor(DISCORD_COLORS.blue)

      await interaction.editReply({ embeds: [embed] })
      return
    }

    // Find the invoker's team ID
    let invokerTeamId: string | null = null
    if (userId) {
      for (const score of leagueScores) {
        const team = score.teams as {
          id?: string
          league_participants?: { user_id?: string }
        } | null
        if (team?.league_participants?.user_id === userId) {
          invokerTeamId = team?.id || null
          break
        }
      }
    }

    // Format standings lines
    const lines = leagueScores.map((score, index) => {
      const rank = index + 1
      const team = score.teams as {
        id?: string
        name?: string
        league_participants?: {
          user_id?: string
          profiles?: { display_name?: string }
        }
      } | null

      const teamName = team?.name || 'Unknown Team'
      const ownerName = team?.league_participants?.profiles?.display_name || ''
      const points = score.total_points ?? 0
      const isYou = team?.id === invokerTeamId ? ' (you)' : ''

      const nameDisplay = ownerName ? `${teamName} -- ${ownerName}` : teamName
      const line = `${rank}. ${nameDisplay}${isYou} -- ${points} pts`

      // Bold top 3
      return rank <= 3 ? `**${line}**` : line
    })

    const lastUpdated = leagueScores[0]?.last_updated
    const footerTimestamp = lastUpdated
      ? `Last updated ${new Date(lastUpdated).toLocaleDateString()}`
      : 'Scores not yet calculated'

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle('Standings')
      .setDescription(lines.join('\n'))
      .setColor(DISCORD_COLORS.blue)
      .setURL(leagueUrl(leagueId, '/standings'))
      .setFooter({ text: `${footerTimestamp} -- ${leagueName}` })

    await interaction.editReply({ embeds: [embed] })
  },
}
