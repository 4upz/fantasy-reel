import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { configure } from './configure.js'

/** A fake `Message`-like reply that supports the button collector API used by /configure. */
function fakeReplyMessage() {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {}
  return {
    createMessageComponentCollector: vi.fn(() => ({
      on: vi.fn((event: string, cb: (...args: unknown[]) => unknown) => {
        handlers[event] = cb
      }),
    })),
    _handlers: handlers,
  }
}

const linkedChannel = {
  data: {
    id: 'channel-row-1',
    league_id: 'league-1',
    notify_drafts: true,
    notify_bids: true,
    notify_trades: false,
    notify_scores: true,
    notify_weekly_digest: true,
    notify_movie_news: false,
    bot_admin_role_id: null,
    created_by: 'linker-user',
    leagues: { name: 'Blockbusters', owner_id: 'owner-user' },
  },
}

describe('/configure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()
    interaction.editReply = vi.fn().mockResolvedValue(undefined)

    await configure.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('replies with a friendly error when the Discord account is not linked', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: null } },
    })
    const interaction = makeInteraction()
    interaction.editReply = vi.fn().mockResolvedValue(undefined)

    await configure.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Link your Discord account'))
  })

  it('denies members who are not the linker, an admin-role holder, Manage Server, or the owner', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: 'someone-else' } },
    })
    const interaction = makeInteraction()
    interaction.editReply = vi.fn().mockResolvedValue(undefined)

    await configure.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Manage Server'))
  })

  it('shows all six toggles, including the new Weekly Digest and Movie News buttons, for the linker', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: 'linker-user' } },
    })
    const interaction = makeInteraction()
    const reply = fakeReplyMessage()
    interaction.editReply = vi.fn().mockResolvedValue(reply)

    await configure.execute(interaction)

    const payload = interaction.editReply.mock.calls[0][0]
    const embed = payload.embeds[0].data
    expect(embed.description).toContain('Weekly Digest:** On')
    expect(embed.description).toContain('Movie News:** Off')

    // Row 1: drafts/bids/trades/scores. Row 2: weekly digest/movie news.
    expect(payload.components).toHaveLength(2)
    const row2Labels = payload.components[1].components.map((b: { data: { label: string } }) => b.data.label)
    expect(row2Labels).toEqual(['Weekly Digest: On', 'Movie News: Off'])
  })

  it('allows Manage Server holders even when they are not the linker or owner', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: 'someone-else' } },
    })
    const interaction = makeInteraction({ hasManageGuild: true })
    const reply = fakeReplyMessage()
    interaction.editReply = vi.fn().mockResolvedValue(reply)

    await configure.execute(interaction)

    expect(reply.createMessageComponentCollector).toHaveBeenCalled()
  })

  it('toggles Movie News on button click and persists the change', async () => {
    const client = mockSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: 'linker-user' } },
    })
    const interaction = makeInteraction()
    const reply = fakeReplyMessage()
    interaction.editReply = vi.fn().mockResolvedValue(reply)

    await configure.execute(interaction)

    const buttonInteraction = {
      customId: 'toggle_movie_news',
      user: { id: interaction.user.id },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    }

    await reply._handlers.collect(buttonInteraction)

    expect(buttonInteraction.deferUpdate).toHaveBeenCalled()
    expect(client.getBuilder('discord_channels', 1).update).toHaveBeenCalledWith({ notify_movie_news: true })

    const latestPayload = interaction.editReply.mock.calls.at(-1)?.[0]
    expect(latestPayload.embeds[0].data.description).toContain('Movie News:** On')
  })
})
