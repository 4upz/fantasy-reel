import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { requireLinkedLeague } from '../utils/channel-league.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const RESULT_LIMIT = 5

interface PickupRow {
  amount_paid: number
  picked_up_at: string
  teams: { name?: string } | null
  movies: { title?: string } | null
}

interface LostBidRow {
  amount: number
  tmdb_id: number
  movie_data: { title?: string } | null
  teams: { name?: string } | null
}

export const bidResults: Command = {
  data: new SlashCommandBuilder()
    .setName('bid-results')
    .setDescription('Show the most recently processed pickup bids') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()
    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName } = linked

    const { data: wins, error: winsError } = await supabase
      .from('pickups')
      .select('amount_paid, picked_up_at, teams(name), movies(title)')
      .eq('league_id', leagueId)
      .order('picked_up_at', { ascending: false })
      .limit(RESULT_LIMIT)
      .returns<PickupRow[]>()

    const { data: losses, error: lossesError } = await supabase
      .from('pickup_bids')
      .select('amount, tmdb_id, movie_data, teams(name)')
      .eq('league_id', leagueId)
      .eq('status', 'lost')
      .order('created_at', { ascending: false })
      .limit(RESULT_LIMIT)
      .returns<LostBidRow[]>()

    if (winsError || lossesError) {
      console.error('Failed to fetch bid results:', winsError || lossesError)
      await interaction.editReply('Failed to load bid results. Please try again.')
      return
    }

    const winLines = (wins || []).map((w) => {
      const title = truncate(w.movies?.title || 'Unknown movie', 40)
      const team = w.teams?.name || 'Unknown team'
      return `**${title}** -- won by ${team} for $${w.amount_paid}`
    })

    const lossLines = (losses || []).map((l) => {
      const title = truncate(l.movie_data?.title || `Movie #${l.tmdb_id}`, 40)
      const team = l.teams?.name || 'Unknown team'
      return `${title} -- ${team} ($${l.amount})`
    })

    if (winLines.length === 0 && lossLines.length === 0) {
      const embed = createBaseEmbed(leagueName, leagueId)
        .setTitle('Bid Results')
        .setDescription('No bids have been processed yet.')
        .setColor(DISCORD_COLORS.blue)

      await interaction.editReply({ embeds: [embed] })
      return
    }

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle('Bid Results')
      .setColor(DISCORD_COLORS.blue)
      .setURL(leagueUrl(leagueId, '/bidding'))

    if (winLines.length > 0) {
      embed.addFields({ name: 'Winning Bids', value: winLines.join('\n').slice(0, 1024) })
    }
    if (lossLines.length > 0) {
      embed.addFields({ name: 'Losing Bids', value: lossLines.join('\n').slice(0, 1024) })
    }

    await interaction.editReply({ embeds: [embed] })
  },
}
