import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { upcoming } from './upcoming.js'

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

describe('/upcoming', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await upcoming.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('lists rostered movies releasing soon, grouped with team names', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        team_holdings: {
          data: [
            { team_name: 'Team B', title: 'Movie Two', release_date: '2026-08-05' },
            { team_name: 'Team A', title: 'Movie One', release_date: '2026-08-10' },
          ],
        },
      },
    })
    const interaction = makeInteraction()

    await upcoming.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.title).toBe('Upcoming Releases')
    // Ordered ascending by date server-side: Movie Two (Aug 5) before Movie One (Aug 10)
    const twoIndex = embed.description.indexOf('Movie Two')
    const oneIndex = embed.description.indexOf('Movie One')
    expect(twoIndex).toBeGreaterThanOrEqual(0)
    expect(twoIndex).toBeLessThan(oneIndex)
    expect(embed.description).toContain('Team A')
    expect(embed.description).toContain('Team B')
  })

  it('shows an empty state when nothing is releasing in the window', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel, team_holdings: { data: [] } },
    })
    const interaction = makeInteraction()

    await upcoming.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toBe('No rostered movies releasing in the next 30 days.')
  })

  it('replies with a friendly error when Supabase fails', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        team_holdings: { data: null, error: { message: 'db down' } },
      },
    })
    const interaction = makeInteraction()

    await upcoming.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load upcoming releases'))
  })
})
