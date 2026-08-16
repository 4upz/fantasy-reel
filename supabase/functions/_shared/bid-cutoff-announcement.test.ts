/**
 * Unit tests for the new-bid cutoff Discord announcement.
 *
 * Drives runBidCutoffAnnouncement() directly with a mock Supabase client
 * (see _mock-client.ts) and a stubbed global fetch, so the real
 * sendDiscordNotification webhook path is exercised rather than duplicated.
 * No running Supabase or Edge Function runtime required.
 *
 * Run with: deno task test:unit
 */
import { assertEquals } from '@std/assert'
import { runBidCutoffAnnouncement, buildCutoffEmbed } from '../bid-cutoff-announcement/handler.ts'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'

const LEAGUE_ID = 'league-1'
const PROCESSING_DEADLINE = '2026-08-15T20:00:00.000Z' // Saturday 8pm UTC

const BEFORE_CUTOFF = new Date('2026-08-12T12:00:00.000Z') // Wednesday
const AFTER_CUTOFF = new Date('2026-08-14T09:00:00.000Z') // Friday

const RPC = { get_next_processing_deadline: PROCESSING_DEADLINE }
const UNIQUE = { bid_cutoff_announcements: ['league_id', 'processing_deadline'] }

function baseDb(): MockDb {
  return {
    leagues: [{ id: LEAGUE_ID, name: 'The League', status: 'active', new_bid_cutoff_hours: 48 }],
    pickup_bids: [
      { league_id: LEAGUE_ID, tmdb_id: 101, amount: 12, status: 'active', movie_data: { title: 'Dune 3' } },
      { league_id: LEAGUE_ID, tmdb_id: 101, amount: 8, status: 'outbid', movie_data: { title: 'Dune 3' } },
      { league_id: LEAGUE_ID, tmdb_id: 202, amount: 30, status: 'active', movie_data: { title: 'Wicked 2' } },
      { league_id: LEAGUE_ID, tmdb_id: 303, amount: 5, status: 'cancelled', movie_data: { title: 'Ignored' } },
    ],
    counterpick_bids: [
      { league_id: LEAGUE_ID, movie_id: 'm-9', amount: 7, status: 'active', movies: { title: 'Flopbuster' } },
    ],
    bid_cutoff_announcements: [],
    discord_channels: [
      {
        id: 'ch-1',
        league_id: LEAGUE_ID,
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        thread_id: null,
        bid_alert_role_id: null,
        enabled: true,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        notify_weekly_digest: true,
        notify_movie_news: true,
        consecutive_failures: 0,
      },
    ],
  }
}

/** The single embed sent through the stubbed webhook. */
function sentEmbed(calls: Array<{ body: Record<string, unknown> }>) {
  const embeds = calls[0].body.embeds as Array<{
    title?: string
    description?: string
    fields?: Array<{ name: string; value: string }>
  }>
  return embeds[0]
}

Deno.test('bid-cutoff-announcement', async (t) => {
  await t.step('says nothing before the cutoff has passed', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      const result = await runBidCutoffAnnouncement(client, BEFORE_CUTOFF)

      assertEquals(result.leagues_announced, 0)
      assertEquals(result.leagues_skipped, 1)
      assertEquals(calls.length, 0)
      assertEquals(db.bid_cutoff_announcements.length, 0)
    } finally {
      restore()
    }
  })

  await t.step('announces once the cutoff has passed', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      const result = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)

      assertEquals(result.leagues_announced, 1)
      assertEquals(result.failed, 0)
      assertEquals(calls.length, 1)
      assertEquals(sentEmbed(calls).title, '🔒 New bids are closed')
    } finally {
      restore()
    }
  })

  await t.step('one embed carries the summary and the close reminder together', async () => {
    const { calls, restore } = stubFetch()
    try {
      const client = createMockDbClient(baseDb(), { rpc: RPC, unique: UNIQUE })
      await runBidCutoffAnnouncement(client, AFTER_CUTOFF)

      // Everything in a single embed, as specified -- not three messages.
      assertEquals((calls[0].body.embeds as unknown[]).length, 1)

      const fields = sentEmbed(calls).fields ?? []
      const names = fields.map((f) => f.name)

      // Pickup and counterpick contests share the list; the counterpick is marked.
      assertEquals(names.includes('Wicked 2'), true)
      assertEquals(names.includes('Dune 3'), true)
      assertEquals(names.includes('🎯 Flopbuster'), true)
      // A cancelled bid is not a live contest.
      assertEquals(names.includes('Ignored'), false)

      // Highest pot first.
      assertEquals(names[0], 'Wicked 2')

      // Only the leading amount. Dune 3 has two bidders and Wicked 2 has one,
      // and their fields must be indistinguishable in shape -- a count would
      // tell a rival how hard they'd have to push.
      const dune = fields.find((f) => f.name === 'Dune 3')!
      assertEquals(dune.value, 'High bid $12')
      assertEquals(fields.find((f) => f.name === 'Wicked 2')!.value, 'High bid $30')

      // The close reminder rides along as a Discord timestamp so each member
      // reads it in their own timezone.
      const unix = Math.floor(new Date(PROCESSING_DEADLINE).getTime() / 1000)
      const closes = fields.find((f) => f.name === 'Counter bidding closes')!
      assertEquals(closes.value, `<t:${unix}:F> (<t:${unix}:R>)`)
    } finally {
      restore()
    }
  })

  await t.step('reveals nothing about who is bidding, or how many are', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      // Four teams pile onto one movie and one team sits alone on another. The
      // embed must not let a reader tell those two situations apart.
      db.pickup_bids = [
        { league_id: LEAGUE_ID, tmdb_id: 101, amount: 40, status: 'active', movie_data: { title: 'Dune 3' } },
        { league_id: LEAGUE_ID, tmdb_id: 101, amount: 30, status: 'outbid', movie_data: { title: 'Dune 3' } },
        { league_id: LEAGUE_ID, tmdb_id: 101, amount: 20, status: 'outbid', movie_data: { title: 'Dune 3' } },
        { league_id: LEAGUE_ID, tmdb_id: 101, amount: 10, status: 'outbid', movie_data: { title: 'Dune 3' } },
        { league_id: LEAGUE_ID, tmdb_id: 202, amount: 40, status: 'active', movie_data: { title: 'Wicked 2' } },
      ]
      db.counterpick_bids = []
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      await runBidCutoffAnnouncement(client, AFTER_CUTOFF)

      const fields = sentEmbed(calls).fields ?? []
      const contested = fields.find((f) => f.name === 'Dune 3')!
      const uncontested = fields.find((f) => f.name === 'Wicked 2')!

      // Same leading amount, four bidders versus one: identical rendering.
      assertEquals(contested.value, uncontested.value)

      // One field per movie, so the row count can't be used to derive the
      // number of bidders either.
      assertEquals(fields.filter((f) => f.name === 'Dune 3').length, 1)

      // Every movie field is exactly the leading amount and nothing else.
      for (const field of fields.filter((f) => f.value.startsWith('High bid'))) {
        assertEquals(/^High bid \$\d+$/.test(field.value), true, field.value)
      }

      // No count of bidders anywhere in the payload. The description says
      // "counter another team's", which is generic copy, so match a quantity
      // rather than the bare word.
      const payload = JSON.stringify(calls[0].body)
      assertEquals(/\d+\s+teams?\b/.test(payload), false, payload)
      assertEquals(/\bbidders?\b/.test(payload), false, payload)
    } finally {
      restore()
    }
  })

  await t.step('summarizes three distinct contests, not four bids', async () => {
    const { restore } = stubFetch()
    try {
      const client = createMockDbClient(baseDb(), { rpc: RPC, unique: UNIQUE })
      const result = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)
      // Dune 3 (2 bids) + Wicked 2 + Flopbuster; the cancelled bid is excluded.
      assertEquals(result.bids_summarized, 3)
    } finally {
      restore()
    }
  })

  await t.step('a rerun in the same cycle does not announce twice', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      const first = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)
      const second = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)

      assertEquals(first.leagues_announced, 1)
      assertEquals(second.leagues_announced, 0)
      assertEquals(second.leagues_skipped, 1)
      assertEquals(calls.length, 1)
      assertEquals(db.bid_cutoff_announcements.length, 1)
    } finally {
      restore()
    }
  })

  await t.step('the next cycle announces again', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      // Already announced for last week's deadline.
      db.bid_cutoff_announcements.push({
        league_id: LEAGUE_ID,
        processing_deadline: '2026-08-08T20:00:00.000Z',
      })
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      const result = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)

      assertEquals(result.leagues_announced, 1)
      assertEquals(calls.length, 1)
    } finally {
      restore()
    }
  })

  await t.step('skips a league with the cutoff disabled', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.leagues[0].new_bid_cutoff_hours = 0
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      const result = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)

      assertEquals(result.leagues_announced, 0)
      assertEquals(result.leagues_skipped, 1)
      assertEquals(calls.length, 0)
    } finally {
      restore()
    }
  })

  await t.step('a non-default offset moves when the league is announced', async () => {
    const { restore } = stubFetch()
    try {
      const db = baseDb()
      db.leagues[0].new_bid_cutoff_hours = 24 // cutoff Friday 8pm, not Thursday
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      // Friday 9am is past a 48h cutoff but not past a 24h one.
      const early = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)
      assertEquals(early.leagues_announced, 0)

      const late = await runBidCutoffAnnouncement(client, new Date('2026-08-14T21:00:00.000Z'))
      assertEquals(late.leagues_announced, 1)
    } finally {
      restore()
    }
  })

  await t.step('still announces when nobody bid, and says so', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.pickup_bids = []
      db.counterpick_bids = []
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      const result = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)

      assertEquals(result.leagues_announced, 1)
      assertEquals(result.bids_summarized, 0)

      const embed = sentEmbed(calls)
      assertEquals(embed.description?.includes('No bids were placed'), true)
      // With nothing to counter, the reminder is about reopening, not closing.
      assertEquals((embed.fields ?? [])[0].name, 'Bidding reopens')
    } finally {
      restore()
    }
  })

  await t.step('ignores leagues that are not active', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.leagues[0].status = 'completed'
      const client = createMockDbClient(db, { rpc: RPC, unique: UNIQUE })

      const result = await runBidCutoffAnnouncement(client, AFTER_CUTOFF)

      assertEquals(result.leagues_announced, 0)
      assertEquals(result.leagues_skipped, 0)
      assertEquals(calls.length, 0)
    } finally {
      restore()
    }
  })

  await t.step('caps the movie list and says how many were left off', () => {
    const contests = Array.from({ length: 26 }, (_, i) => ({
      title: `Movie ${i}`,
      highBid: 26 - i,
      isCounterpick: false,
    }))

    const embed = buildCutoffEmbed({
      leagueId: LEAGUE_ID,
      leagueName: 'The League',
      contests,
      processingDeadline: new Date(PROCESSING_DEADLINE),
    })

    const fields = embed.fields ?? []
    // Discord's hard limit is 25 fields.
    assertEquals(fields.length <= 25, true)
    assertEquals(fields.some((f) => f.value.includes('and 6 more')), true)
  })
})
