import { assert, assertEquals } from '@std/assert'
import { buildBidResultsEmbeds, type MovieResult } from './bid-results-announcement.ts'
import { DISCORD_COLORS, type DiscordEmbed } from './discord.ts'

const LEAGUE = { leagueId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', leagueName: 'Film Club' }

function won(title: string, teamName: string, amount: number): MovieResult {
  return { title, bids: [{ teamName, amount, outcome: { kind: 'won' } }] }
}

/** Everything Discord counts toward its 6000-character message cap. */
function embedChars(embed: DiscordEmbed): number {
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
}

Deno.test('awards read as before: inline "Won by" cells under a count', () => {
  const [embed, ...rest] = buildBidResultsEmbeds({
    ...LEAGUE,
    kind: 'pickup',
    movies: [won('Dune: Part Three', 'Alice', 30), won('Wicked: For Good', 'Bob', 12)],
  })

  assertEquals(rest.length, 0)
  assertEquals(embed.title, 'Bidding Results')
  assertEquals(embed.description, '2 movies awarded')
  assertEquals(embed.color, DISCORD_COLORS.green)
  assertEquals(embed.fields, [
    { name: 'Dune: Part Three', value: 'Won by **Alice** for $30', inline: true },
    { name: 'Wicked: For Good', value: 'Won by **Bob** for $12', inline: true },
  ])
})

Deno.test('a movie nobody could take names the bid and why it failed', () => {
  const [embed] = buildBidResultsEmbeds({
    ...LEAGUE,
    kind: 'pickup',
    movies: [{
      title: 'Superman 2',
      bids: [{ teamName: 'Dave', amount: 40, outcome: { kind: 'lost', reason: 'no_slots' } }],
    }],
  })

  assertEquals(embed.description, '0 movies awarded · 1 not awarded')
  assertEquals(embed.color, DISCORD_COLORS.blue)
  assertEquals(embed.fields, [{
    name: 'Superman 2 — not awarded',
    value: "**Dave**'s $40 bid couldn't be honored: no roster room",
    inline: false,
  }])
})

Deno.test('every outcome gets its own line, the winner first', () => {
  const [embed] = buildBidResultsEmbeds({
    ...LEAGUE,
    kind: 'pickup',
    movies: [{
      title: 'Mission 9',
      bids: [
        { teamName: 'Full', amount: 20, outcome: { kind: 'lost', reason: 'no_slots' } },
        { teamName: 'Broke', amount: 15, outcome: { kind: 'lost', reason: 'insufficient_budget' } },
        { teamName: 'Low', amount: 2, outcome: { kind: 'lost', reason: 'outbid' } },
        { teamName: 'Roomy', amount: 3, outcome: { kind: 'won' } },
      ],
    }],
  })

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
  const [embed] = buildBidResultsEmbeds({
    ...LEAGUE,
    kind: 'counterpick',
    movies: [
      {
        title: 'Released',
        bids: [{ teamName: 'Eve', amount: 10, outcome: { kind: 'cancelled', reason: 'movie_released' } }],
      },
      {
        title: 'Dropped',
        bids: [{ teamName: 'Finn', amount: 4, outcome: { kind: 'cancelled', reason: 'movie_dropped' } }],
      },
    ],
  })

  assertEquals(embed.fields?.map((field) => field.value), [
    "**Eve**'s $10 bid was cancelled: the movie released before processing",
    "**Finn**'s $4 bid was cancelled: the movie was dropped by its holder",
  ])
})

Deno.test('counterpick results use counterpick wording', () => {
  const [embed] = buildBidResultsEmbeds({
    ...LEAGUE,
    kind: 'counterpick',
    movies: [
      { title: 'Taken', bids: [{ teamName: 'Gia', amount: 5, outcome: { kind: 'won' } }] },
      { title: 'Full Up', bids: [{ teamName: 'Hal', amount: 9, outcome: { kind: 'lost', reason: 'no_slots' } }] },
    ],
  })

  assertEquals(embed.title, 'Counterpick Bidding Results')
  assertEquals(embed.description, '1 counterpick awarded · 1 not awarded')
  assertEquals(embed.fields?.map((field) => field.value), [
    'Counterpicked by **Gia** for $5',
    "**Hal**'s $9 bid couldn't be honored: no counterpick slots left",
  ])
})

Deno.test('plain awards lead, so they stay together as a grid', () => {
  const [embed] = buildBidResultsEmbeds({
    ...LEAGUE,
    kind: 'pickup',
    movies: [
      { title: 'Unclaimed', bids: [{ teamName: 'Dave', amount: 40, outcome: { kind: 'lost', reason: 'no_slots' } }] },
      won('Claimed', 'Alice', 30),
    ],
  })

  assertEquals(embed.fields?.map((field) => field.name), ['Claimed', 'Unclaimed — not awarded'])
})

Deno.test('a busy week splits across messages instead of dropping any result', () => {
  const movies = Array.from({ length: 60 }, (_, index) => won(`Movie ${index}`, `Team ${index % 8}`, index))

  const embeds = buildBidResultsEmbeds({ ...LEAGUE, kind: 'pickup', movies })

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
  const movies = Array.from({ length: 20 }, (_, index) => ({
    title: `${longTitle}${index}`,
    bids: [{ teamName: 'Dave', amount: index, outcome: { kind: 'lost' as const, reason: 'no_slots' as const } }],
  }))

  const embeds = buildBidResultsEmbeds({ ...LEAGUE, kind: 'pickup', movies })

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
  assertEquals(buildBidResultsEmbeds({ ...LEAGUE, kind: 'pickup', movies: [] }), [])
})
