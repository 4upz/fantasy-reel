import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabaseClient, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { getSupabase } from '../supabase.js'
import { movie } from './movie.js'

function setSupabase(config: Parameters<typeof createMockSupabaseClient>[0]) {
  ;(getSupabase as unknown as Mock).mockReturnValue(createMockSupabaseClient(config))
}

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
  )
}

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

const searchResponse = {
  page: 1,
  total_pages: 1,
  total_results: 2,
  results: [
    { tmdb_id: 1, title: 'Movie One', overview: null, release_date: '2026-09-01', poster_url: null, vote_average: 7, popularity: 10, genre_ids: [] },
    { tmdb_id: 2, title: 'Movie One: Part Two', overview: null, release_date: '2027-01-01', poster_url: null, vote_average: 6, popularity: 5, genre_ids: [] },
  ],
}

describe('/movie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('looks up a movie by name and shows league roster context', async () => {
    setSupabase({
      tables: {
        discord_channels: linkedChannel,
        movies: {
          data: {
            id: 'movie-uuid-1',
            title: 'Movie One',
            release_date: '2026-09-01',
            poster_url: null,
            fantasy_points: 12.5,
            combined_score: 75,
            reviews: [{ source: 'rotten_tomatoes', score: 75 }],
          },
        },
        draft_picks: { data: { teams: { name: 'Team A' } } },
      },
    })
    mockFetchOk(searchResponse)
    const interaction = makeInteraction({ stringOptions: { name: 'Movie One' } })

    await movie.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.title).toContain('Movie One')
    expect(embed.description).toContain('Fantasy Points:** 12.5')
    expect(embed.description).toContain('Owned by Team A')
    expect(embed.description).toContain('Movie One: Part Two')
  })

  it('still resolves the movie when the channel is not linked, without roster context', async () => {
    setSupabase({ tables: { discord_channels: { data: null } } })
    mockFetchOk(searchResponse)
    const interaction = makeInteraction({ stringOptions: { name: 'Movie One' } })

    await movie.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.title).toContain('Movie One')
    expect(embed.description).toContain('Link this channel with /set-league')
  })

  it('shows an empty state when no movies match', async () => {
    setSupabase({ tables: { discord_channels: linkedChannel } })
    mockFetchOk({ page: 1, total_pages: 1, total_results: 0, results: [] })
    const interaction = makeInteraction({ stringOptions: { name: 'Nonexistent Movie' } })

    await movie.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No movies found matching'))
  })

  it('replies with a friendly error when the search fetch fails', async () => {
    setSupabase({ tables: { discord_channels: linkedChannel } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const interaction = makeInteraction({ stringOptions: { name: 'Movie One' } })

    await movie.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to search for movies'))
  })

  it('autocomplete returns up to 10 choices from search results', async () => {
    mockFetchOk(searchResponse)
    const interaction = makeInteraction({ focused: 'Movie O' })

    await movie.autocomplete!(interaction)

    expect(interaction.respond).toHaveBeenCalledTimes(1)
    const choices = interaction.respond.mock.calls[0][0]
    expect(choices.length).toBe(2)
    expect(choices[0]).toEqual({ name: 'Movie One (2026)', value: '1' })
  })

  it('autocomplete responds with an empty list on error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const interaction = makeInteraction({ focused: 'Movie O' })

    await movie.autocomplete!(interaction)

    expect(interaction.respond).toHaveBeenCalledWith([])
  })

  it('autocomplete responds with an empty list for very short queries', async () => {
    const interaction = makeInteraction({ focused: 'M' })

    await movie.autocomplete!(interaction)

    expect(interaction.respond).toHaveBeenCalledWith([])
  })
})
