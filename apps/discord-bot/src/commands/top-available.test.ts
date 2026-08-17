import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { topAvailable } from './top-available.js'

function mockFetchOk(results: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ page: 1, total_pages: 1, total_results: results.length, results }),
    })
  )
}

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

describe('/top-available', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await topAvailable.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('excludes rostered movies and shows the top available ones', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        team_holdings: { data: [{ tmdb_id: 100 }, { tmdb_id: 200 }] },
      },
    })
    mockFetchOk([
      { tmdb_id: 100, title: 'Already Rostered', release_date: '2026-09-01', poster_url: null },
      { tmdb_id: 300, title: 'Free Agent', release_date: '2026-09-05', poster_url: null },
    ])
    const interaction = makeInteraction()

    await topAvailable.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toContain('Free Agent')
    expect(embed.description).not.toContain('Already Rostered')
  })

  it('shows an empty state when nothing is available', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel, team_holdings: { data: [] } },
    })
    mockFetchOk([])
    const interaction = makeInteraction()

    await topAvailable.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toBe('No available movies found.')
  })

  it('replies with a friendly error when the movie data fetch fails', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel, team_holdings: { data: [] } },
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const interaction = makeInteraction()

    await topAvailable.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load movie data'))
  })
})
