import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { resolveLinkedLeague, UNLINKED_CHANNEL_MESSAGE } from '../utils/channel-league.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const UPCOMING_WINDOW_DAYS = 30
const RECENT_WINDOW_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000

interface RosterRow {
  teams: { name?: string } | null
  movies: { title?: string; release_date?: string } | null
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
    const linked = await resolveLinkedLeague(supabase, interaction.channelId)

    if (!linked) {
      await interaction.editReply(UNLINKED_CHANNEL_MESSAGE)
      return
    }

    const { leagueId, leagueName } = linked

    const today = new Date()
    const gte = scope === 'recent' ? toDateString(new Date(today.getTime() - RECENT_WINDOW_DAYS * MS_PER_DAY)) : toDateString(today)
    const lte = scope === 'recent' ? toDateString(today) : toDateString(new Date(today.getTime() + UPCOMING_WINDOW_DAYS * MS_PER_DAY))

    const { data: draftRows, error: draftError } = await supabase
      .from('draft_picks')
      .select('teams!draft_picks_team_id_fkey(name), movies!inner(title, release_date)')
      .eq('league_id', leagueId)
      .is('dropped_at', null)
      .gte('movies.release_date', gte)
      .lte('movies.release_date', lte)
      .returns<RosterRow[]>()

    const { data: pickupRows, error: pickupError } = await supabase
      .from('pickups')
      .select('teams(name), movies!inner(title, release_date)')
      .eq('league_id', leagueId)
      .is('dropped_at', null)
      .gte('movies.release_date', gte)
      .lte('movies.release_date', lte)
      .returns<RosterRow[]>()

    if (draftError || pickupError) {
      console.error('Failed to fetch upcoming releases:', draftError || pickupError)
      await interaction.editReply('Failed to load upcoming releases. Please try again.')
      return
    }

    const rows = [...(draftRows || []), ...(pickupRows || [])].filter((r) => r.movies?.release_date)
    rows.sort((a, b) => (a.movies!.release_date! < b.movies!.release_date! ? -1 : 1))

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
      const title = truncate(row.movies?.title || 'Untitled', 40)
      const team = row.teams?.name || 'Unknown team'
      const date = new Date(row.movies!.release_date!).toLocaleDateString('en-US', {
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
