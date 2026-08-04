import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { bidResults } from './bid-results.js'

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

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

  it('shows winning and losing bids', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickups: {
          data: [
            { amount_paid: 25, picked_up_at: '2026-08-01T00:00:00Z', teams: { name: 'Team A' }, movies: { title: 'Movie One' } },
          ],
        },
        pickup_bids: {
          data: [
            { amount: 15, tmdb_id: 42, movie_data: { title: 'Movie Two' }, teams: { name: 'Team B' } },
          ],
        },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.title).toBe('Bid Results')
    const fieldValues = embed.fields.map((f: { value: string }) => f.value).join('\n')
    expect(fieldValues).toContain('Movie One')
    expect(fieldValues).toContain('Team A')
    expect(fieldValues).toContain('Movie Two')
  })

  it('shows an empty state when no bids have processed', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickups: { data: [] },
        pickup_bids: { data: [] },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toBe('No bids have been processed yet.')
  })

  it('replies with a friendly error when Supabase fails', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickups: { data: null, error: { message: 'db down' } },
        pickup_bids: { data: [] },
      },
    })
    const interaction = makeInteraction()

    await bidResults.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load bid results'))
  })
})
