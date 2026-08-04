import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { requireLinkedLeague } from '../utils/channel-league.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

interface PendingBidRow {
  tmdb_id: number
  team_id: string
  movie_data: { title?: string } | null
}

export const currentBids: Command = {
  data: new SlashCommandBuilder()
    .setName('current-bids')
    .setDescription('Show movies with active pickup bids (sealed -- no amounts)') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()
    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName } = linked

    const { data: bids, error } = await supabase
      .from('pickup_bids')
      .select('tmdb_id, team_id, movie_data')
      .eq('league_id', leagueId)
      .in('status', ['active', 'outbid'])
      .returns<PendingBidRow[]>()

    if (error) {
      console.error('Failed to fetch current bids:', error)
      await interaction.editReply('Failed to load current bids. Please try again.')
      return
    }

    if (!bids || bids.length === 0) {
      const embed = createBaseEmbed(leagueName, leagueId)
        .setTitle('Current Bids')
        .setDescription('No active bids right now.')
        .setColor(DISCORD_COLORS.blue)

      await interaction.editReply({ embeds: [embed] })
      return
    }

    const byMovie = new Map<number, { title: string; teamIds: Set<string> }>()
    for (const bid of bids) {
      const existing = byMovie.get(bid.tmdb_id)
      if (existing) {
        existing.teamIds.add(bid.team_id)
      } else {
        byMovie.set(bid.tmdb_id, {
          title: bid.movie_data?.title || `Movie #${bid.tmdb_id}`,
          teamIds: new Set([bid.team_id]),
        })
      }
    }

    const lines = Array.from(byMovie.values())
      .sort((a, b) => b.teamIds.size - a.teamIds.size)
      .map((movie) => {
        const title = truncate(movie.title, 40)
        const bidders = movie.teamIds.size
        return `**${title}** -- ${bidders} bidder${bidders === 1 ? '' : 's'}`
      })

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle('Current Bids')
      .setDescription(lines.join('\n'))
      .setColor(DISCORD_COLORS.blue)
      .setURL(leagueUrl(leagueId, '/bidding'))
      .setFooter({ text: 'Bids are sealed -- amounts are hidden until processed' })

    await interaction.editReply({ embeds: [embed] })
  },
}
