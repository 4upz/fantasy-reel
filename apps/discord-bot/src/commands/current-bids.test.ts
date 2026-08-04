import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { currentBids } from './current-bids.js'

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

describe('/current-bids', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await currentBids.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('shows the sealed presentation -- movie and bidder count, never amounts', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        pickup_bids: {
          data: [
            { tmdb_id: 1, team_id: 'team-a', movie_data: { title: 'Movie One' } },
            { tmdb_id: 1, team_id: 'team-b', movie_data: { title: 'Movie One' } },
            { tmdb_id: 2, team_id: 'team-c', movie_data: { title: 'Movie Two' } },
          ],
        },
      },
    })
    const interaction = makeInteraction()

    await currentBids.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toContain('Movie One** -- 2 bidders')
    expect(embed.description).toContain('Movie Two** -- 1 bidder')
    expect(embed.description).not.toMatch(/\$\d/)
  })

  it('shows an empty state when there are no active bids', async () => {
    mockSupabase({ tables: { discord_channels: linkedChannel, pickup_bids: { data: [] } } })
    const interaction = makeInteraction()

    await currentBids.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toBe('No active bids right now.')
  })

  it('replies with a friendly error when Supabase fails', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel, pickup_bids: { data: null, error: { message: 'db down' } } },
    })
    const interaction = makeInteraction()

    await currentBids.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load current bids'))
  })
})
