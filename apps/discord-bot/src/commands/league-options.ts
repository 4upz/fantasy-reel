import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { requireLinkedLeague } from '../utils/channel-league.js'
import type { Command } from './index.js'

interface LeagueSettingsRow {
  invite_only: boolean | null
  max_participants: number | null
  draft_slots: number | null
  total_slots: number | null
  drop_limit: number | null
  counterbid_hours: number | null
  draft_counterpick_slots: number | null
  bidding_counterpick_slots: number | null
  counterpicks_block_drops: boolean | null
  faab_budget: number | null
  trades_enabled: boolean | null
  trade_review_enabled: boolean | null
  trade_veto_hours: number | null
  trade_deadline: string | null
}

const onOff = (value: boolean | null | undefined) => (value ? 'On' : 'Off')

export const leagueOptions: Command = {
  data: new SlashCommandBuilder()
    .setName('league-options')
    .setDescription('Show this league\'s full settings') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()
    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName } = linked

    const { data: settings, error } = await supabase
      .from('leagues')
      .select(
        'invite_only, max_participants, draft_slots, total_slots, drop_limit, counterbid_hours, ' +
        'draft_counterpick_slots, bidding_counterpick_slots, counterpicks_block_drops, faab_budget, ' +
        'trades_enabled, trade_review_enabled, trade_veto_hours, trade_deadline'
      )
      .eq('id', leagueId)
      .maybeSingle<LeagueSettingsRow>()

    if (error || !settings) {
      console.error('Failed to fetch league settings:', error)
      await interaction.editReply('Failed to load league settings. Please try again.')
      return
    }

    const description = [
      '**Membership**',
      `Invite only: ${onOff(settings.invite_only)}`,
      `Max participants: ${settings.max_participants ?? 'Unlimited'}`,
      '',
      '**Draft**',
      `Rounds: ${settings.draft_slots ?? '?'}`,
      `Roster size: ${settings.total_slots ?? '?'} (draft + pickups)`,
      `Drop limit: ${settings.drop_limit ?? '?'} per season`,
      '',
      '**Bidding**',
      `Fantasy budget: $${settings.faab_budget ?? 100}`,
      `Counter window: ${settings.counterbid_hours ?? '?'} hours`,
      '',
      '**Counterpicks**',
      `Draft phase slots: ${settings.draft_counterpick_slots ?? 0}`,
      `Bidding phase slots: ${settings.bidding_counterpick_slots ?? 0}`,
      `Blocks drops: ${onOff(settings.counterpicks_block_drops)}`,
      '',
      '**Trades**',
      `Trades enabled: ${onOff(settings.trades_enabled)}`,
      `Review before execution: ${onOff(settings.trade_review_enabled)}`,
      `Veto window: ${settings.trade_veto_hours ?? '?'} hours`,
      settings.trade_deadline ? `Trade deadline: ${new Date(settings.trade_deadline).toLocaleDateString()}` : null,
    ].filter((line): line is string => line !== null)

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle('League Settings')
      .setDescription(description.join('\n'))
      .setColor(DISCORD_COLORS.blue)
      .setURL(leagueUrl(leagueId, '/settings'))

    await interaction.editReply({ embeds: [embed] })
  },
}
