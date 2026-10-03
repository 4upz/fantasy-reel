import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { requireLinkedLeague } from '../utils/channel-league.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const RESULT_LIMIT = 5

const RESOLUTION_REASONS: Record<string, string> = {
  outbid: 'Another bid won',
  no_slots: 'No slots available',
  insufficient_budget: 'Insufficient budget',
  movie_released: 'Movie already released',
  movie_scored: 'Movie already has a score',
  movie_dropped: 'Target movie was dropped',
  target_owned: 'Team now owns the target movie',
  target_missing: 'Target movie is no longer available',
  user_cancelled: 'Cancelled by the bidder',
  season_completed: 'Season completed',
}

interface BidRow {
  amount: number
  status: 'won' | 'lost' | 'cancelled'
  resolution_reason: string | null
  teams: { name?: string } | null
}

interface PickupBidRow extends BidRow {
  tmdb_id: number
  movie_data: { title?: string } | null
}

interface CounterpickBidRow extends BidRow {
  movies: { title?: string } | null
}

function resultLine(bid: BidRow, movieTitle: string): string {
  const title = truncate(movieTitle, 40)
  const team = truncate(bid.teams?.name || 'Unknown team', 40)
  const reason = bid.resolution_reason && Object.hasOwn(RESOLUTION_REASONS, bid.resolution_reason)
    ? RESOLUTION_REASONS[bid.resolution_reason]
    : 'Reason unavailable'
  const outcome = bid.status === 'won'
    ? 'Won'
    : `${bid.status === 'lost' ? 'Lost' : 'Cancelled'} — ${reason}`

  return `**${title}** — ${team} ($${bid.amount}): ${outcome}`
}

export const bidResults: Command = {
  data: new SlashCommandBuilder()
    .setName('bid-results')
    .setDescription('Show recent pickup and counterpick bid results with resolution reasons') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()
    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName } = linked

    const [pickups, counterpicks] = await Promise.all([
      supabase
        .from('pickup_bids')
        .select('amount, status, resolution_reason, tmdb_id, movie_data, teams(name)')
        .eq('league_id', leagueId)
        .in('status', ['won', 'lost', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(RESULT_LIMIT)
        .returns<PickupBidRow[]>(),
      supabase
        .from('counterpick_bids')
        .select('amount, status, resolution_reason, teams!counterpick_bids_team_id_fkey(name), movies(title)')
        .eq('league_id', leagueId)
        .in('status', ['won', 'lost', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(RESULT_LIMIT)
        .returns<CounterpickBidRow[]>(),
    ])

    if (pickups.error || counterpicks.error) {
      console.error('Failed to fetch bid results:', pickups.error || counterpicks.error)
      await interaction.editReply('Failed to load bid results. Please try again.')
      return
    }

    const pickupLines = (pickups.data || []).map((bid) =>
      resultLine(bid, bid.movie_data?.title || `Movie #${bid.tmdb_id}`)
    )
    const counterpickLines = (counterpicks.data || []).map((bid) =>
      resultLine(bid, bid.movies?.title || 'Unknown movie')
    )

    if (pickupLines.length === 0 && counterpickLines.length === 0) {
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
      .setFooter({ text: `Up to ${RESULT_LIMIT} recent results per bid type` })

    if (pickupLines.length > 0) {
      embed.addFields({ name: 'Pickup Bids', value: pickupLines.join('\n') })
    }
    if (counterpickLines.length > 0) {
      embed.addFields({ name: 'Counterpick Bids', value: counterpickLines.join('\n') })
    }

    await interaction.editReply({ embeds: [embed] })
  },
}
