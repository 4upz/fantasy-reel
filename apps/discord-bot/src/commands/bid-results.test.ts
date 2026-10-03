import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { bidResults } from './bid-results.js'

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

const pickupBid = {
  amount: 15,
  tmdb_id: 42,
  movie_data: { title: 'Movie One' },
  teams: { name: 'Team A' },
  status: 'lost',
  resolution_reason: 'no_slots',
}

const counterpickBid = {
  amount: 20,
  movies: { title: 'Movie Two' },
  teams: { name: 'Team B' },
  status: 'cancelled',
  resolution_reason: 'movie_released',
}

const reasonLabels = [
  ['outbid', 'Another bid won'],
  ['no_slots', 'No slots available'],
  ['insufficient_budget', 'Insufficient budget'],
  ['movie_released', 'Movie already released'],
  ['movie_scored', 'Movie already has a score'],
  ['movie_dropped', 'Target movie was dropped'],
  ['target_owned', 'Team now owns the target movie'],
  ['target_missing', 'Target movie is no longer available'],
  ['user_cancelled', 'Cancelled by the bidder'],
  ['season_completed', 'Season completed'],
]

describe('/bid-results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('shows wins, losses, and cancellations for both bid types', async () => {
    const client = mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickup_bids: {
          data: [
            { ...pickupBid, status: 'won', resolution_reason: null },
            pickupBid,
            { ...pickupBid, status: 'cancelled', resolution_reason: 'user_cancelled' },
          ],
        },
        counterpick_bids: {
          data: [
            { ...counterpickBid, status: 'won', resolution_reason: null },
            { ...counterpickBid, status: 'lost', resolution_reason: 'no_slots' },
            counterpickBid,
          ],
        },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].toJSON()
    expect(embed.title).toBe('Bid Results')
    expect(embed.fields).toEqual([
      {
        name: 'Pickup Bids',
        value: [
          '**Movie One** — Team A ($15): Won',
          '**Movie One** — Team A ($15): Lost — No slots available',
          '**Movie One** — Team A ($15): Cancelled — Cancelled by the bidder',
        ].join('\n'),
      },
      {
        name: 'Counterpick Bids',
        value: [
          '**Movie Two** — Team B ($20): Won',
          '**Movie Two** — Team B ($20): Lost — No slots available',
          '**Movie Two** — Team B ($20): Cancelled — Movie already released',
        ].join('\n'),
      },
    ])
    // Pending sealed amounts must never be included in the result queries.
    for (const table of ['pickup_bids', 'counterpick_bids']) {
      const query = client.getBuilder(table)
      expect(query.eq).toHaveBeenCalledWith('league_id', 'league-1')
      expect(query.in).toHaveBeenCalledWith('status', ['won', 'lost', 'cancelled'])
      expect(query.limit).toHaveBeenCalledWith(5)
    }
    // Counterpicks also reference a target team: display the bidding team.
    expect(client.getBuilder('counterpick_bids').select).toHaveBeenCalledWith(
      expect.stringContaining('teams!counterpick_bids_team_id_fkey(name)')
    )
  })

  it.each(reasonLabels)('explains persisted %s outcomes', async (reason, expected) => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickup_bids: { data: [{ ...pickupBid, resolution_reason: reason }] },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].toJSON()
    expect(embed.fields[0].value).toContain(expected)
  })

  it.each([null, 'unknown_reason', 'constructor'])('does not guess why historical bids lost or were cancelled (%s)', async (reason) => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickup_bids: { data: [{ ...pickupBid, resolution_reason: reason }] },
        counterpick_bids: { data: [{ ...counterpickBid, resolution_reason: reason }] },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].toJSON()
    expect(embed.fields[0].value).toContain('Lost — Reason unavailable')
    expect(embed.fields[1].value).toContain('Cancelled — Reason unavailable')
    expect(embed.fields.map((field: { value: string }) => field.value).join('\n')).not.toContain('Another bid won')
  })

  it('keeps all five results and their reasons within Discord embed limits for long names', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickup_bids: {
          data: Array.from({ length: 5 }, () => ({
            ...pickupBid,
            teams: { name: 'T'.repeat(500) },
            movie_data: { title: 'M'.repeat(500) },
          })),
        },
        counterpick_bids: {
          data: Array.from({ length: 5 }, () => ({
            ...counterpickBid,
            teams: { name: 'T'.repeat(500) },
            movies: { title: 'M'.repeat(500) },
            resolution_reason: 'target_missing',
          })),
        },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    const builder = interaction.editReply.mock.calls[0][0].embeds[0]
    const embed = builder.toJSON()
    expect(builder.length).toBeLessThanOrEqual(6000)
    expect(embed.fields).toHaveLength(2)
    for (const field of embed.fields) {
      expect(field.value.length).toBeLessThanOrEqual(1024)
      expect(field.value.split('\n')).toHaveLength(5)
    }
    expect(embed.fields[0].value.match(/No slots available/g)).toHaveLength(5)
    expect(embed.fields[1].value.match(/Target movie is no longer available/g)).toHaveLength(5)
  })

  it('handles missing movie and team metadata', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickup_bids: { data: [{ ...pickupBid, movie_data: null, teams: null }] },
        counterpick_bids: { data: [{ ...counterpickBid, movies: null, teams: null }] },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].toJSON()
    expect(embed.fields[0].value).toContain('Movie #42** — Unknown team')
    expect(embed.fields[1].value).toContain('Unknown movie** — Unknown team')
  })

  it('shows an empty state when no bids have processed', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickup_bids: { data: [] },
        counterpick_bids: { data: [] },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toBe('No bids have been processed yet.')
  })

  it.each(['pickup_bids', 'counterpick_bids'])('replies with a friendly error when %s fails', async (table) => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        [table]: { data: null, error: { message: 'db down' } },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load bid results'))
  })
})
