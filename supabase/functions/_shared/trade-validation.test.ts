/**
 * Unit tests for trade-validation Discord mention helpers.
 *
 * Run with: deno task test:unit
 */

import { assertEquals } from '@std/assert'
import { buildTradeMentions, getTradeMentionContent } from './trade-validation.ts'

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
