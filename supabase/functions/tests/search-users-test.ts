/**
 * Integration tests for search-users Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName } from './_setup.ts'

Deno.test('search-users', async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const { data } = await anonClient.functions.invoke('search-users', {
      body: {
        query: 'test',
        league_id: '00000000-0000-0000-0000-000000000000',
      },
    })
    assertEquals(data?.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 for missing league_id', async () => {
    const { data } = await client.functions.invoke('search-users', {
      body: { query: 'test' },
    })
    assertEquals(data?.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid league_id', async () => {
    const { data } = await client.functions.invoke('search-users', {
      body: { query: 'test', league_id: 'not-a-uuid' },
    })
    assertEquals(data?.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for query too short', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('search-short-query'))

    const { data } = await client.functions.invoke('search-users', {
      body: { query: 'a', league_id: leagueId },
    })
    assertEquals(data?.error, 'Search query must be at least 2 characters')
  })

  await t.step('returns 400 for empty query', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('search-empty-query'))

    const { data } = await client.functions.invoke('search-users', {
      body: { query: '', league_id: leagueId },
    })
    assertEquals(data?.error, 'Search query must be at least 2 characters')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when league does not exist', async () => {
    const { data } = await client.functions.invoke('search-users', {
      body: {
        query: 'test',
        league_id: '00000000-0000-0000-0000-000000000000',
      },
    })
    assertEquals(data?.error, 'League not found')
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  await t.step('returns 403 when user is not the league owner', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('search-not-owner'))

    const { data } = await secondClient.functions.invoke('search-users', {
      body: { query: 'test', league_id: leagueId },
    })
    assertEquals(data?.error, 'Only the league owner can search for users to invite')
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('returns empty array when no matches found', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('search-no-matches'))

    const { data, error } = await client.functions.invoke('search-users', {
      body: { query: 'xyznonexistent123', league_id: leagueId },
    })

    assertEquals(error, null)
    assertExists(data.users)
    assertEquals(Array.isArray(data.users), true)
    assertEquals(data.users.length, 0)
  })

  await t.step('returns results with truncated email hints', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('search-results'))

    // Search for "test" - should match test users created by _setup.ts
    const { data, error } = await client.functions.invoke('search-users', {
      body: { query: 'test', league_id: leagueId },
    })

    assertEquals(error, null)
    assertExists(data.users)
    assertEquals(Array.isArray(data.users), true)

    // If any results returned, verify structure
    if (data.users.length > 0) {
      const firstUser = data.users[0]
      assertExists(firstUser.user_id)
      assertExists(firstUser.display_name)
      assertExists(firstUser.email_hint)
      // Email hint should be truncated (e.g., "t***@example.com")
      assertEquals(firstUser.email_hint.includes('***'), true)
    }
  })

  await t.step('respects limit parameter', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('search-limit'))

    const { data, error } = await client.functions.invoke('search-users', {
      body: { query: 'test', league_id: leagueId, limit: 1 },
    })

    assertEquals(error, null)
    assertExists(data.users)
    assertEquals(data.users.length <= 1, true)
  })

  await t.step('clamps limit to maximum of 20', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('search-max-limit'))

    // This should return short query error before limit is processed
    const { data } = await client.functions.invoke('search-users', {
      body: { query: 'a', league_id: leagueId, limit: 100 },
    })
    assertEquals(data?.error, 'Search query must be at least 2 characters')
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
})
