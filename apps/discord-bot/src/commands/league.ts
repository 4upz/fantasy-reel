import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { championTeamIds, requireLinkedLeague, seasonLabel } from '../utils/channel-league.js'
import type { Command } from './index.js'

const STATUS_LABELS: Record<string, string> = {
  setup: 'Setup',
  drafting: 'Drafting',
  counterpicking: 'Counterpicking',
  active: 'Active',
  completed: 'Completed',
}

interface LeagueConfigRow {
  draft_slots: number | null
  total_slots: number | null
  drop_limit: number | null
  draft_counterpick_slots: number | null
  bidding_counterpick_slots: number | null
  faab_budget: number | null
}

interface StandingRow {
  total_points: number | null
  teams: { id?: string; name?: string } | null
}

function buildLinkButton(leagueId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View League')
      .setStyle(ButtonStyle.Link)
      .setURL(leagueUrl(leagueId))
  )
}

export const league: Command = {
  data: new SlashCommandBuilder()
    .setName('league')
    .setDescription('Show an overview of this channel\'s league') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()
    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName, leagueStatus, seasonYear } = linked
    const season = seasonLabel(seasonYear)

    const { data: config, error: configError } = await supabase
      .from('leagues')
      .select('draft_slots, total_slots, drop_limit, draft_counterpick_slots, bidding_counterpick_slots, faab_budget')
      .eq('id', leagueId)
      .maybeSingle<LeagueConfigRow>()

    if (configError) {
      console.error('Failed to fetch league config:', configError)
      await interaction.editReply('Failed to load league info. Please try again.')
      return
    }

    const { count: memberCount, error: memberError } = await supabase
      .from('league_participants')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('status', 'active')

    if (memberError) {
      console.error('Failed to fetch member count:', memberError)
      await interaction.editReply('Failed to load league info. Please try again.')
      return
    }

    const { data: scores } = await supabase
      .from('team_scores')
      .select('total_points, teams!inner(id, name, league_participants!inner(league_id))')
      .eq('teams.league_participants.league_id', leagueId)
      .order('total_points', { ascending: false })
      .returns<StandingRow[]>()

    const leagueScores = scores || []

    // A finished season names its champions from what it recorded; co-champions
    // each get the trophy. See the same reasoning in /standings.
    const champions = championTeamIds(linked)

    const topLines = leagueScores.slice(0, 3).map((s, index) => {
      const rank = index + 1
      const name = s.teams?.name || 'Unknown Team'
      const points = s.total_points ?? 0
      const trophy = s.teams?.id && champions?.has(s.teams.id) ? ' 🏆' : ''
      return `${rank}. ${name} -- ${points} pts${trophy}`
    })

    const counterpickSlots = (config?.draft_counterpick_slots ?? 0) + (config?.bidding_counterpick_slots ?? 0)

    const descriptionParts = [
      ...(season ? [`**Season:** ${season}`] : []),
      `**Status:** ${STATUS_LABELS[leagueStatus] || leagueStatus}`,
      `**Members:** ${memberCount ?? 0}`,
      `**Draft:** ${config?.draft_slots ?? '?'} rounds, ${config?.total_slots ?? '?'} roster slots, ${config?.drop_limit ?? '?'} drops allowed`,
      `**Counterpicks:** ${counterpickSlots} slot${counterpickSlots === 1 ? '' : 's'}`,
      `**Fantasy Budget:** $${config?.faab_budget ?? 100}`,
      '',
      leagueStatus === 'completed' ? '**Final Standings**' : '**Top Standings**',
      topLines.length > 0 ? topLines.join('\n') : 'No standings yet.',
    ]

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle('League Overview')
      .setDescription(descriptionParts.join('\n'))
      .setColor(DISCORD_COLORS.gold)
      .setURL(leagueUrl(leagueId))

    await interaction.editReply({
      embeds: [embed],
      // Type assertion: discord-api-types version mismatch between discord.js sub-packages
      components: [buildLinkButton(leagueId) as never],
    })
  },
}
