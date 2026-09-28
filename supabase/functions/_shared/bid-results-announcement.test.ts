import { assert, assertEquals } from '@std/assert'
import {
  buildBidResultsMessages,
  type BidResultOutcome,
  type BidResultsKind,
  type MovieResult,
} from './bid-results-announcement.ts'
import { DISCORD_COLORS, type DiscordEmbed } from './discord.ts'

const LEAGUE = { leagueId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', leagueName: 'Film Club' }

function oneBid(
  title: string,
  teamName: string,
  amount: number,
  outcome: BidResultOutcome = { kind: 'won' },
): MovieResult {
  return { title, bids: [{ teamName, amount, outcome }] }
}

/** The post's embeds, asserting each message carries exactly one. */
function embedsOf(kind: BidResultsKind, movies: MovieResult[]): DiscordEmbed[] {
  const messages = buildBidResultsMessages({ ...LEAGUE, kind, movies })
  for (const message of messages) assertEquals(message.length, 1)
  return messages.map(([embed]) => embed)
}

/** Everything Discord counts toward its 6000-character message cap. */
function embedChars(embed: DiscordEmbed): number {
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
}

Deno.test('awards read as before: inline "Won by" cells under a count', () => {
  const embeds = embedsOf('pickup', [
    oneBid('Dune: Part Three', 'Alice', 30),
    oneBid('Wicked: For Good', 'Bob', 12),
  ])

  assertEquals(embeds.length, 1)
  assertEquals(embeds[0].title, 'Bidding Results')
  assertEquals(embeds[0].description, '2 movies awarded')
  assertEquals(embeds[0].color, DISCORD_COLORS.green)
  assertEquals(embeds[0].fields, [
    { name: 'Dune: Part Three', value: 'Won by **Alice** for $30', inline: true },
    { name: 'Wicked: For Good', value: 'Won by **Bob** for $12', inline: true },
  ])
})

Deno.test('a movie nobody could take names the bid and why it failed', () => {
  const [embed] = embedsOf('pickup', [
    oneBid('Superman 2', 'Dave', 40, { kind: 'lost', reason: 'no_slots' }),
  ])

  assertEquals(embed.description, '0 movies awarded · 1 not awarded')
  assertEquals(embed.color, DISCORD_COLORS.blue)
  assertEquals(embed.fields, [{
    name: 'Superman 2 — not awarded',
    value: "**Dave**'s $40 bid couldn't be honored: no roster room",
    inline: false,
  }])
})

Deno.test('every bid on a movie gets its own line, the winner first', () => {
  const [embed] = embedsOf('pickup', [{
    title: 'Mission 9',
    bids: [
      { teamName: 'Full', amount: 20, outcome: { kind: 'lost', reason: 'no_slots' } },
      { teamName: 'Broke', amount: 15, outcome: { kind: 'lost', reason: 'insufficient_budget' } },
      { teamName: 'Low', amount: 2, outcome: { kind: 'lost', reason: 'outbid' } },
      { teamName: 'Roomy', amount: 3, outcome: { kind: 'won' } },
    ],
  }])

  assertEquals(embed.fields, [{
    name: 'Mission 9',
    value: [
      'Won by **Roomy** for $3',
      "**Full**'s $20 bid couldn't be honored: no roster room",
      "**Broke**'s $15 bid couldn't be honored: budget committed to higher-priority bids",
      '**Low** was outbid ($2)',
    ].join('\n'),
    inline: false,
  }])
})

Deno.test('cancelled bids say what changed while they were pending', () => {
  const [embed] = embedsOf('counterpick', [
    oneBid('Released', 'Eve', 10, { kind: 'cancelled', reason: 'movie_released' }),
    oneBid('Dropped', 'Finn', 4, { kind: 'cancelled', reason: 'movie_dropped' }),
  ])

  assertEquals(embed.fields?.map((field) => field.value), [
    "**Eve**'s $10 bid was cancelled: the movie released before processing",
    "**Finn**'s $4 bid was cancelled: the movie was dropped by its holder",
  ])
})

Deno.test('counterpick results use counterpick wording', () => {
  const [embed] = embedsOf('counterpick', [
    oneBid('Taken', 'Gia', 5),
    oneBid('Full Up', 'Hal', 9, { kind: 'lost', reason: 'no_slots' }),
  ])

  assertEquals(embed.title, 'Counterpick Bidding Results')
  assertEquals(embed.description, '1 counterpick awarded · 1 not awarded')
  assertEquals(embed.fields?.map((field) => field.value), [
    'Counterpicked by **Gia** for $5',
    "**Hal**'s $9 bid couldn't be honored: no counterpick slots left",
  ])
})

Deno.test('plain awards lead, so they stay together as a grid', () => {
  const [embed] = embedsOf('pickup', [
    oneBid('Unclaimed', 'Dave', 40, { kind: 'lost', reason: 'no_slots' }),
    oneBid('Claimed', 'Alice', 30),
  ])

  assertEquals(embed.fields?.map((field) => field.name), ['Claimed', 'Unclaimed — not awarded'])
})

Deno.test('a busy week splits across messages instead of dropping any result', () => {
  const movies = Array.from({ length: 60 }, (_, index) => oneBid(`Movie ${index}`, `Team ${index % 8}`, index))

  const embeds = embedsOf('pickup', movies)

  assertEquals(embeds.length, 3)
  assertEquals(embeds.flatMap((embed) => embed.fields ?? []).length, 60)
  assertEquals(embeds.map((embed) => embed.title), [
    'Bidding Results',
    'Bidding Results (continued)',
    'Bidding Results (continued)',
  ])
  assertEquals(embeds[0].description, '60 movies awarded')
  assertEquals(embeds[1].description, undefined)
  for (const embed of embeds) assert((embed.fields?.length ?? 0) <= 25)
})

Deno.test('long results stay under the per-message character cap', () => {
  const longTitle = 'An Extraordinarily Long Festival Title '.repeat(12)
  const movies = Array.from(
    { length: 20 },
    (_, index) => oneBid(`${longTitle}${index}`, 'Dave', index, { kind: 'lost', reason: 'no_slots' }),
  )

  const embeds = embedsOf('pickup', movies)

  assert(embeds.length > 1, 'expected the character budget to force a split')
  assertEquals(embeds.flatMap((embed) => embed.fields ?? []).length, 20)
  for (const embed of embeds) {
    assert(embedChars(embed) <= 6000, `embed is ${embedChars(embed)} characters`)
    for (const field of embed.fields ?? []) {
      assert(field.name.length <= 256)
      assert(field.value.length <= 1024)
      // Clipping shortens the title, never the verdict.
      assert(field.name.endsWith(' — not awarded'))
    }
  }
})

Deno.test('no settled bids, no post', () => {
  assertEquals(buildBidResultsMessages({ ...LEAGUE, kind: 'pickup', movies: [] }), [])
})

Deno.test('reconciled losses retain the previous award without counting a new win', () => {
  for (const kind of ['pickup', 'counterpick'] as const) {
    const [embed] = embedsOf(kind, [{
      ...oneBid('Earlier winner', 'Runner-up', 5, { kind: 'lost', reason: 'outbid' }),
      previouslyAwarded: true,
    }])
    assertEquals(embed.description, `0 ${kind === 'pickup' ? 'movies' : 'counterpicks'} awarded · 1 previously awarded`)
    assertEquals(embed.fields?.[0].name, 'Earlier winner — previously awarded')
    assert(!embed.fields?.[0].value.includes('Won by'))
  }
})

Deno.test('partial results explicitly say that other bids remain pending', () => {
  const [[embed]] = buildBidResultsMessages({ ...LEAGUE, kind: 'pickup',
    movies: [oneBid('Released', 'Eve', 10, { kind: 'cancelled', reason: 'movie_released' })],
    hasPendingBids: true })
  assertEquals(embed.description, "0 movies awarded · 1 not awarded\nSome bids are still pending; they'll be reported once processed.")
})

Deno.test('a fully held league gets a pending notice, not silence or no-bids copy', () => {
  const [[embed]] = buildBidResultsMessages({ ...LEAGUE, kind: 'counterpick', movies: [], hasPendingBids: true })
  assertEquals(embed.description, "0 counterpicks awarded\nSome bids are still pending; they'll be reported once processed.")
  assertEquals(embed.fields, [])
})
