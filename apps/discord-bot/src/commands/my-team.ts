import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { config } from '../config.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { requireLinkedLeague } from '../utils/channel-league.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

interface TeamRosterRow {
  movies: { title?: string; release_date?: string | null; fantasy_points?: number | null } | null
}

interface TeamScoreRow {
  total_points: number | null
  teams: { id?: string; league_participants?: { league_id?: string; user_id?: string } } | null
}

export const myTeam: Command = {
  data: new SlashCommandBuilder()
    .setName('my-team')
    .setDescription('View your own roster in this league (only visible to you)') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true })

    const supabase = getSupabase()
    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName } = linked

    const { data: userId, error: userError } = await supabase.rpc('get_user_by_discord_id', {
      p_discord_id: interaction.user.id,
    })

    if (userError) {
      console.error('Failed to resolve Discord user:', userError)
      await interaction.editReply('Failed to look up your account. Please try again.')
      return
    }

    if (!userId) {
      await interaction.editReply(
        `Your Discord account isn't linked to Fantasy Reel yet. Connect it at ${config.appUrl}/settings`
      )
      return
    }

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('id, name, league_participants!inner(league_id, user_id)')
      .eq('league_participants.league_id', leagueId)
      .eq('league_participants.user_id', userId)
      .maybeSingle<{ id: string; name: string }>()

    if (teamError) {
      console.error('Failed to fetch team:', teamError)
      await interaction.editReply('Failed to load your team. Please try again.')
      return
    }

    if (!team) {
      await interaction.editReply(`You don't have a team in **${leagueName}**.`)
      return
    }

    const { data: scores, error: scoresError } = await supabase
      .from('team_scores')
      .select('total_points, teams!inner(id, league_participants!inner(league_id, user_id))')
      .eq('teams.league_participants.league_id', leagueId)
      .order('total_points', { ascending: false })
      .returns<TeamScoreRow[]>()

    if (scoresError) {
      console.error('Failed to fetch standings:', scoresError)
      await interaction.editReply('Failed to load your team. Please try again.')
      return
    }

    const leagueScores = scores || []
    const rank = leagueScores.findIndex((s) => s.teams?.id === team.id) + 1
    const myScore = leagueScores.find((s) => s.teams?.id === team.id)
    const totalPoints = myScore?.total_points ?? 0

    const { data: draftRows } = await supabase
      .from('draft_picks')
      .select('movies(title, release_date, fantasy_points)')
      .eq('team_id', team.id)
      .is('dropped_at', null)
      .returns<TeamRosterRow[]>()

    const { data: pickupRows } = await supabase
      .from('pickups')
      .select('movies(title, release_date, fantasy_points)')
      .eq('team_id', team.id)
      .is('dropped_at', null)
      .returns<TeamRosterRow[]>()

    const roster = [...(draftRows || []), ...(pickupRows || [])]

    const rosterLines = roster.length > 0
      ? roster.map((r) => {
          const title = truncate(r.movies?.title || 'Unknown movie', 40)
          const points = r.movies?.fantasy_points != null ? `${r.movies.fantasy_points} pts` : 'Unreleased'
          return `**${title}** -- ${points}`
        }).join('\n')
      : 'No movies yet.'

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle(team.name)
      .setDescription(rosterLines.slice(0, 4096))
      .setColor(DISCORD_COLORS.gold)
      .setURL(leagueUrl(leagueId))
      .addFields(
        { name: 'Total Points', value: `${totalPoints}`, inline: true },
        { name: 'Rank', value: rank > 0 ? `${rank} of ${leagueScores.length}` : 'Unranked', inline: true }
      )

    await interaction.editReply({ embeds: [embed] })
  },
}
