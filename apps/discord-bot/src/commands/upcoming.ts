import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { requireLinkedLeague } from '../utils/channel-league.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const UPCOMING_WINDOW_DAYS = 30
const RECENT_WINDOW_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000

interface RosterRow {
  team_name: string | null
  title: string | null
  release_date: string
}

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0]
}

export const upcoming: Command = {
  data: new SlashCommandBuilder()
    .setName('upcoming')
    .setDescription('Show rostered movies releasing soon (or recently released)')
    .addStringOption((option) =>
      option
        .setName('scope')
        .setDescription('Which window to show')
        .addChoices(
          { name: 'Upcoming (next 30 days)', value: 'upcoming' },
          { name: 'Recent (last 14 days)', value: 'recent' }
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const scope = interaction.options.getString('scope') || 'upcoming'
    const supabase = getSupabase()
    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName } = linked

    const today = new Date()
    const gte = scope === 'recent' ? toDateString(new Date(today.getTime() - RECENT_WINDOW_DAYS * MS_PER_DAY)) : toDateString(today)
    const lte = scope === 'recent' ? toDateString(today) : toDateString(new Date(today.getTime() + UPCOMING_WINDOW_DAYS * MS_PER_DAY))

    // The range filter drops movies with no release date, so every row here has one.
    const { data: rows, error: rowsError } = await supabase
      .from('team_holdings')
      .select('team_name, title, release_date')
      .eq('league_id', leagueId)
      .gte('release_date', gte)
      .lte('release_date', lte)
      .order('release_date', { ascending: true })
      .returns<RosterRow[]>()

    if (rowsError || !rows) {
      console.error('Failed to fetch upcoming releases:', rowsError)
      await interaction.editReply('Failed to load upcoming releases. Please try again.')
      return
    }

    if (rows.length === 0) {
      const emptyMessage = scope === 'recent'
        ? 'No rostered movies released in the last 14 days.'
        : 'No rostered movies releasing in the next 30 days.'

      const embed = createBaseEmbed(leagueName, leagueId)
        .setTitle(scope === 'recent' ? 'Recent Releases' : 'Upcoming Releases')
        .setDescription(emptyMessage)
        .setColor(DISCORD_COLORS.blue)

      await interaction.editReply({ embeds: [embed] })
      return
    }

    const lines = rows.map((row) => {
      const title = truncate(row.title || 'Untitled', 40)
      const team = row.team_name || 'Unknown team'
      const date = new Date(row.release_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
      return `**${date}** -- ${title} (${team})`
    })

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle(scope === 'recent' ? 'Recent Releases' : 'Upcoming Releases')
      .setDescription(lines.join('\n').slice(0, 4096))
      .setColor(DISCORD_COLORS.blue)
      .setURL(leagueUrl(leagueId))

    await interaction.editReply({ embeds: [embed] })
  },
}
