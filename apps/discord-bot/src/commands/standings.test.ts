import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { standings } from './standings.js'

const linkedChannel = (status = 'active') => ({
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status } },
})

function participantRow(
  teamId: string,
  teamName: string,
  ownerName: string,
  userId: string,
  scores: {
    total_points?: number
    movies_scored?: number
    movies_pending?: number
    last_calculated_at?: string
  } | null
) {
  return {
    user_id: userId,
    profiles: { display_name: ownerName },
    teams: { id: teamId, name: teamName, team_scores: scores },
  }
}

describe('/standings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await standings.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not linked to a league')
    )
  })

  it('explains standings are unavailable before the draft completes', async () => {
    mockSupabase({ tables: { discord_channels: linkedChannel('drafting') } })
    const interaction = makeInteraction()

    await standings.execute(interaction)

    const payload = interaction.editReply.mock.calls[0][0]
    const embed = payload.embeds[0].data
    expect(embed.description).toContain('draft')
    expect(embed.description).toContain('Drafting')
  })

  it('reports a load failure distinctly from empty standings', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel(),
        league_participants: { data: null, error: { message: 'column does not exist' } },
      },
    })
    const interaction = makeInteraction()

    await standings.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load standings')
    )
  })

  it('ranks every team by points, including teams with no score row yet', async () => {
    const client = mockSupabase({
      tables: {
        discord_channels: linkedChannel(),
        league_participants: {
          data: [
            participantRow('team-1', 'Spielberg Studios', 'Alice Spielberg', 'user-1', {
              total_points: 331,
              movies_scored: 5,
              movies_pending: 0,
              last_calculated_at: '2026-08-06T02:26:31Z',
            }),
            participantRow('team-2', 'Nolan Pictures', 'Bob Nolan', 'user-2', {
              total_points: 345,
              movies_scored: 4,
              movies_pending: 1,
              last_calculated_at: '2026-08-06T02:26:31Z',
            }),
            participantRow('team-3', 'Coppola Films', 'Carol Coppola', 'user-3', null),
          ],
        },
      },
      rpc: { get_user_by_discord_id: { data: 'user-1' } },
    })
    const interaction = makeInteraction()

    await standings.execute(interaction)

    const payload = interaction.editReply.mock.calls[0][0]
    const embed = payload.embeds[0].data
    const description: string = embed.description

    // Ordered by points: Nolan (345) > Spielberg (331) > Coppola (unscored)
    const nolan = description.indexOf('Nolan Pictures')
    const spielberg = description.indexOf('Spielberg Studios')
    const coppola = description.indexOf('Coppola Films')
    expect(nolan).toBeGreaterThanOrEqual(0)
    expect(spielberg).toBeGreaterThan(nolan)
    expect(coppola).toBeGreaterThan(spielberg)

    // Fantasy Critic-style lines: rank, team (owner), points, movie counts
    expect(description).toContain('**1.**')
    expect(description).toContain('Bob Nolan')
    expect(description).toContain('**345 pts**')
    expect(description).toContain('4/5 movies scored')

    // Unscored team still appears, at zero
    expect(description).toContain('**3.**')
    expect(description).toContain('**0 pts**')

    // Invoker marker
    expect(description).toContain('(you)')
    const youIndex = description.indexOf('(you)')
    expect(youIndex).toBeGreaterThan(nolan)
    expect(youIndex).toBeLessThan(coppola)

    // Standings must be scoped to the linked league server-side
    expect(client.getBuilder('league_participants')?.eq).toHaveBeenCalledWith(
      'league_id',
      'league-1'
    )

    // Footer reflects when scores were last calculated
    expect(embed.footer.text).toContain('2026')
  })

  it('gives tied teams the same rank', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel(),
        league_participants: {
          data: [
            participantRow('team-1', 'Team A', 'Alice', 'user-1', {
              total_points: 100, movies_scored: 2, movies_pending: 0,
            }),
            participantRow('team-2', 'Team B', 'Bob', 'user-2', {
              total_points: 100, movies_scored: 2, movies_pending: 0,
            }),
            participantRow('team-3', 'Team C', 'Carol', 'user-3', {
              total_points: 50, movies_scored: 1, movies_pending: 1,
            }),
          ],
        },
      },
      rpc: { get_user_by_discord_id: { data: null } },
    })
    const interaction = makeInteraction()

    await standings.execute(interaction)

    const description: string = interaction.editReply.mock.calls[0][0].embeds[0].data.description
    expect(description.match(/\*\*1\.\*\*/g)).toHaveLength(2)
    expect(description).not.toContain('**2.**')
    expect(description).toContain('**3.**')
  })

  it('crowns the champion when the league is completed', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel('completed'),
        league_participants: {
          data: [
            participantRow('team-1', 'Winner', 'Alice', 'user-1', {
              total_points: 200, movies_scored: 5, movies_pending: 0,
            }),
            participantRow('team-2', 'Runner Up', 'Bob', 'user-2', {
              total_points: 150, movies_scored: 5, movies_pending: 0,
            }),
          ],
        },
      },
      rpc: { get_user_by_discord_id: { data: null } },
    })
    const interaction = makeInteraction()

    await standings.execute(interaction)

    const description: string = interaction.editReply.mock.calls[0][0].embeds[0].data.description
    const winnerLine = description.split('\n')[0]
    expect(winnerLine).toContain('🏆')
    expect(winnerLine).toContain('Winner')
    expect(description).not.toMatch(/Runner Up.*🏆/)
  })

  it('shows an empty-league message when there are no teams', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel(),
        league_participants: { data: [] },
      },
      rpc: { get_user_by_discord_id: { data: null } },
    })
    const interaction = makeInteraction()

    await standings.execute(interaction)

    const payload = interaction.editReply.mock.calls[0][0]
    const embed = payload.embeds[0].data
    expect(embed.description).toContain('No teams')
  })
})
