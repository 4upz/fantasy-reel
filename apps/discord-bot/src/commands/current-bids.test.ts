import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabaseClient, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { getSupabase } from '../supabase.js'
import { currentBids } from './current-bids.js'

function setSupabase(config: Parameters<typeof createMockSupabaseClient>[0]) {
  ;(getSupabase as unknown as Mock).mockReturnValue(createMockSupabaseClient(config))
}

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

describe('/current-bids', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    setSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await currentBids.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('shows the sealed presentation -- movie and bidder count, never amounts', async () => {
    setSupabase({
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
    setSupabase({ tables: { discord_channels: linkedChannel, pickup_bids: { data: [] } } })
    const interaction = makeInteraction()

    await currentBids.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toBe('No active bids right now.')
  })

  it('replies with a friendly error when Supabase fails', async () => {
    setSupabase({
      tables: { discord_channels: linkedChannel, pickup_bids: { data: null, error: { message: 'db down' } } },
    })
    const interaction = makeInteraction()

    await currentBids.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load current bids'))
  })
})
