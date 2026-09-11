import { assertEquals, assertRejects } from '@std/assert'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { deliverDraftNotification, processDraftNotifications, type DraftNotification } from './draft-notifications.ts'

const item: DraftNotification = {
  id: 'outbox-1', league_id: 'league-1', channel_id: 'channel-1',
  kind: 'draft_pick', payload: { pick_id: 'pick-1' }, lease_token: 'lease-1',
}

function deliveryClient(overrides: Record<string, unknown> = {}, rpcRows: Record<string, unknown> = {}, rpcCalls: string[] = []) {
  const rows: Record<string, unknown> = {
    discord_channels: { id: item.channel_id, enabled: true, notify_drafts: true },
    leagues: { name: 'Test league', status: 'drafting', draft_slots: 4, draft_counterpick_slots: 1 },
    teams: { name: 'Next team' },
    draft_picks: { round: 1, pick_number: 2, movies: { title: 'Test movie', poster_url: 'https://image.tmdb.org/t/p/w500/poster.jpg' }, teams: { name: 'Test team' } },
    ...overrides,
  }
  return {
    rpc(name: string) {
      rpcCalls.push(name)
      return Promise.resolve({ data: rpcRows[name] ?? [], error: null })
    },
    from(table: string) {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: rows[table], error: null }) }
      return query
    },
  } as unknown as SupabaseClient
}

Deno.test('outbox honors delivery preferences at delivery time and skips deleted picks', async () => {
  let sends = 0
  const send = async () => { sends++; return true }
  for (const overrides of [
    { discord_channels: null },
    { discord_channels: { enabled: false, notify_drafts: true } },
    { discord_channels: { enabled: true, notify_drafts: false } },
    { draft_picks: null },
  ]) {
    assertEquals(await deliverDraftNotification(deliveryClient(overrides), item, send), 'skipped')
  }
  assertEquals(sends, 0)
})

Deno.test('delivery failures request a durable retry without a second inline send', async () => {
  let sends = 0
  const outcome = await deliverDraftNotification(deliveryClient(), item, async (_client, _channel, message) => {
    sends++
    assertEquals(message.embeds?.[0].thumbnail?.url, 'https://image.tmdb.org/t/p/w500/poster.jpg')
    return false
  })
  assertEquals(outcome, 'retry')
  assertEquals(sends, 1)
  assertEquals(await deliverDraftNotification(deliveryClient(), item, async () => true), 'sent')
})

Deno.test('worker acknowledges each lease independently and surfaces failed or lost acknowledgements', async () => {
  const items = [item, { ...item, id: 'outbox-2', lease_token: 'lease-2' }, { ...item, id: 'outbox-3', lease_token: 'lease-3' }]
  const acknowledgements: Record<string, unknown>[] = []
  let claimed = false
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'claim_draft_notifications') {
        const data = claimed ? [] : items
        claimed = true
        return Promise.resolve({ data, error: null })
      }
      acknowledgements.push(args)
      return Promise.resolve({ data: args.p_id !== 'outbox-3', error: null })
    },
  } as unknown as SupabaseClient
  const result = await processDraftNotifications(client, async (_client, notification) => {
    if (notification.id === 'outbox-2') throw new Error('Stubbed provider outage')
    return 'sent'
  })
  assertEquals(result.processed, 3)
  assertEquals(result.failed, 2)
  assertEquals(acknowledgements.find(ack => ack.p_id === 'outbox-1')?.p_outcome, 'sent')
  assertEquals(acknowledgements.find(ack => ack.p_id === 'outbox-2')?.p_outcome, 'retry')
  assertEquals(acknowledgements.find(ack => ack.p_id === 'outbox-2')?.p_lease_token, 'lease-2')
  assertEquals(acknowledgements.some(ack => String(ack.p_error).includes('Stubbed provider')), false)
})

Deno.test('worker does not pretend a failed queue read was an empty successful run', async () => {
  const client = { rpc: () => Promise.resolve({ data: null, error: new Error('Queue unavailable') }) } as unknown as SupabaseClient
  await assertRejects(() => processDraftNotifications(client), Error, 'Queue unavailable')
})

Deno.test('queued next-player notification mentions only a team still on the clock', async () => {
  const notification = { ...item, payload: { ...item.payload, next_team_id: 'team-next' } }
  const rpcRows = {
    get_next_draft_pick: [{ team_id: 'team-next', user_id: 'user-next' }],
    get_discord_ids_by_user_ids: [{ user_id: 'user-next', discord_id: '123456789012345678' }],
  }
  let sends = 0
  assertEquals(await deliverDraftNotification(deliveryClient({}, rpcRows), notification, async (_client, _channel, message) => {
    sends++
    assertEquals(message.content, "<@123456789012345678>, you're on the clock.")
    assertEquals(message.embeds?.[0].fields, [{ name: 'Up Next', value: 'Next team', inline: true }])
    return true
  }), 'sent')
  assertEquals(sends, 1)
})

Deno.test('delayed turn notifications keep pick history without pinging a later player', async () => {
  for (const turns of [[{ team_id: 'later-team', user_id: 'later-user' }], []]) {
    const calls: string[] = []
    const notification = { ...item, payload: { ...item.payload, next_team_id: 'team-next' } }
    await deliverDraftNotification(deliveryClient({}, { get_next_draft_pick: turns }, calls), notification, async (_client, _channel, message) => {
      assertEquals(message.content, undefined)
      assertEquals(message.embeds?.[0].fields, undefined)
      assertEquals(message.embeds?.[0].title, 'Test team selects Test movie')
      return true
    })
    assertEquals(calls, ['get_next_draft_pick'])
  }
})

Deno.test('unlinked next player still appears by team name without a mention', async () => {
  const notification = { ...item, payload: { ...item.payload, next_team_id: 'team-next' } }
  await deliverDraftNotification(deliveryClient({}, {
    get_next_draft_pick: [{ team_id: 'team-next', user_id: 'user-next' }],
    get_discord_ids_by_user_ids: [{ user_id: 'user-next', discord_id: null }],
  }), notification, async (_client, _channel, message) => {
    assertEquals(message.content, undefined)
    assertEquals(message.embeds?.[0].fields?.[0].value, 'Next team')
    return true
  })
})

Deno.test('final normal pick announces available counterpicks in one delivery', async () => {
  const notification = { ...item, payload: { ...item.payload, draft_complete: true } }
  let sends = 0
  await deliverDraftNotification(deliveryClient(), notification, async (_client, _channel, message) => {
    sends++
    assertEquals(message.embeds?.length, 2)
    assertEquals(message.embeds?.[1].title, 'Draft Picks Complete')
    assertEquals(message.embeds?.[1].description?.includes('start the counterpick round'), true)
    return true
  })
  assertEquals(sends, 1)
})

Deno.test('later phases suppress stale turn pings and obsolete counterpick-start instructions', async () => {
  for (const status of ['counterpicking', 'active', 'completed']) {
    const calls: string[] = []
    await deliverDraftNotification(deliveryClient({ leagues: { name: 'Test league', status, draft_slots: 4, draft_counterpick_slots: 1 } }, {}, calls), {
      ...item, payload: { ...item.payload, next_team_id: 'team-next', draft_complete: true },
    }, async (_client, _channel, message) => {
      assertEquals(message.content, undefined)
      assertEquals(message.embeds?.length, 1)
      return true
    })
    assertEquals(calls, [])
  }
})
