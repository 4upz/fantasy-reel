/**
 * Unit tests for trade-validation Discord mention helpers.
 *
 * Run with: deno task test:unit
 */

import { assertEquals } from '@std/assert'
import { buildTradeMentions, getTradeMentionContent, validateMovieOwnership } from './trade-validation.ts'

// ============================================================================
// buildTradeMentions (pure)
// ============================================================================

Deno.test('buildTradeMentions - mentions both parties when both are linked', () => {
  const content = buildTradeMentions(['111', '222'])
  assertEquals(content, '<@111> <@222>')
})

Deno.test('buildTradeMentions - mentions only the linked party', () => {
  assertEquals(buildTradeMentions(['111', null]), '<@111>')
  assertEquals(buildTradeMentions([undefined, '222']), '<@222>')
})

Deno.test('buildTradeMentions - clean fallback when neither party is linked', () => {
  assertEquals(buildTradeMentions([null, undefined]), undefined)
  assertEquals(buildTradeMentions([]), undefined)
})

// ============================================================================
// getTradeMentionContent (RPC wrapper)
// ============================================================================

function mockClient(rpcResult: { data: unknown; error: { message: string } | null }) {
  return {
    // deno-lint-ignore no-explicit-any
    rpc: (_fn: string, _params: unknown) => Promise.resolve(rpcResult),
    // deno-lint-ignore no-explicit-any
  } as any
}

Deno.test('getTradeMentionContent - builds mentions from resolved discord_ids', async () => {
  const client = mockClient({
    data: [
      { user_id: 'user-a', discord_id: '111' },
      { user_id: 'user-b', discord_id: null },
    ],
    error: null,
  })

  const content = await getTradeMentionContent(client, ['user-a', 'user-b'])
  assertEquals(content, '<@111>')
})

Deno.test('getTradeMentionContent - returns undefined when nobody is linked', async () => {
  const client = mockClient({ data: [], error: null })
  const content = await getTradeMentionContent(client, ['user-a', 'user-b'])
  assertEquals(content, undefined)
})

Deno.test('getTradeMentionContent - returns undefined for an empty user list without calling rpc', async () => {
  const content = await getTradeMentionContent(mockClient({ data: null, error: null }), [])
  assertEquals(content, undefined)
})

Deno.test('getTradeMentionContent - fails closed (no mentions) on RPC error', async () => {
  const client = mockClient({ data: null, error: { message: 'boom' } })
  const content = await getTradeMentionContent(client, ['user-a'])
  assertEquals(content, undefined)
})

// ============================================================================
// validateMovieOwnership - counterpick self-target guard
// ============================================================================

interface OwnershipRow {
  id: string
  team_id: string
  dropped_at: string | null
  counterpicked_by_team_id: string | null
}

/** Minimal `.from(table).select(...).eq('id', id).single()` stub keyed by row id. */
function mockOwnershipClient(rows: {
  draft_picks?: Record<string, OwnershipRow>
  pickups?: Record<string, OwnershipRow>
}) {
  return {
    from: (table: 'draft_picks' | 'pickups') => ({
      select: (_cols: string) => ({
        eq: (_col: string, id: string) => ({
          single: () => {
            const row = rows[table]?.[id]
            return Promise.resolve(
              row ? { data: row, error: null } : { data: null, error: { message: 'not found' } }
            )
          },
        }),
      }),
    }),
    // deno-lint-ignore no-explicit-any
  } as any
}

Deno.test('validateMovieOwnership - rejects trading a counterpicked movie to the team that counterpicked it', async () => {
  const client = mockOwnershipClient({
    draft_picks: {
      'pick-1': { id: 'pick-1', team_id: 'team-a', dropped_at: null, counterpicked_by_team_id: 'team-b' },
    },
  })

  const result = await validateMovieOwnership(
    client,
    'team-a',
    { movies: [{ movie_id: 'movie-1', source: 'draft_pick', source_id: 'pick-1' }], faab: 0 },
    'team-b' // team-b would receive this item, and team-b is who counterpicked it
  )

  assertEquals(result, {
    valid: false,
    error: 'Cannot trade a counterpicked movie to the team that counterpicked it: pick-1',
  })
})

Deno.test('validateMovieOwnership - allows trading a movie counterpicked by an uninvolved third team', async () => {
  const client = mockOwnershipClient({
    draft_picks: {
      'pick-1': { id: 'pick-1', team_id: 'team-a', dropped_at: null, counterpicked_by_team_id: 'team-c' },
    },
  })

  const result = await validateMovieOwnership(
    client,
    'team-a',
    { movies: [{ movie_id: 'movie-1', source: 'draft_pick', source_id: 'pick-1' }], faab: 0 },
    'team-b' // team-b would receive this item; team-c (not a party to the trade) counterpicked it
  )

  assertEquals(result, { valid: true })
})
