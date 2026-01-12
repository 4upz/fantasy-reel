/**
 * Test setup utilities for Edge Function integration tests
 *
 * These helpers provide authentication, cleanup, and common test utilities
 * for testing Edge Functions via client.functions.invoke()
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Test user credentials - created on first run
export const TEST_USER = {
  email: 'test-integration@example.com',
  password: 'integration-test-password-123!',
}

export const TEST_USER_2 = {
  email: 'test-integration-2@example.com',
  password: 'integration-test-password-456!',
}

/**
 * Get Supabase URL and anon key from environment
 */
function getEnvVars() {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!url || !anonKey) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL and SUPABASE_ANON_KEY\n' +
        'Make sure you have a .env file or export them before running tests.'
    )
  }

  return { url, anonKey }
}

/**
 * Create an anonymous (unauthenticated) Supabase client
 * Use this for testing 401 responses
 */
export function getAnonClient(): SupabaseClient {
  const { url, anonKey } = getEnvVars()
  return createClient(url, anonKey)
}

/**
 * Create an authenticated Supabase client for the primary test user
 * Signs up the user if they don't exist
 */
export async function getAuthenticatedClient(): Promise<SupabaseClient> {
  return authenticateUser(TEST_USER)
}

/**
 * Create an authenticated Supabase client for the secondary test user
 * Useful for testing permissions (e.g., non-owner trying to modify league)
 */
export async function getSecondAuthenticatedClient(): Promise<SupabaseClient> {
  return authenticateUser(TEST_USER_2)
}

/**
 * Authenticate a user, creating them if necessary
 */
async function authenticateUser(user: { email: string; password: string }): Promise<SupabaseClient> {
  const { url, anonKey } = getEnvVars()
  const client = createClient(url, anonKey)

  // Try to sign in first
  const { error: signInError } = await client.auth.signInWithPassword(user)

  if (signInError) {
    // User doesn't exist, create them
    const { error: signUpError } = await client.auth.signUp(user)
    if (signUpError) {
      throw new Error(`Failed to create test user: ${signUpError.message}`)
    }

    // Sign in with the newly created user
    const { error: retrySignInError } = await client.auth.signInWithPassword(user)
    if (retrySignInError) {
      throw new Error(`Failed to sign in after signup: ${retrySignInError.message}`)
    }
  }

  return client
}

/**
 * Get the current user's ID from an authenticated client
 */
export async function getUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error || !user) {
    throw new Error('Failed to get user ID: client is not authenticated')
  }

  return user.id
}

/**
 * Cleanup options for test data
 */
export interface CleanupOptions {
  leagueIds?: string[]
  invitationIds?: string[]
  movieIds?: string[]
}

/**
 * Clean up test data after tests complete
 * Deletes in correct order to respect foreign key constraints
 */
export async function cleanupTestData(
  client: SupabaseClient,
  options: CleanupOptions
): Promise<void> {
  const { leagueIds = [], invitationIds = [], movieIds = [] } = options

  // Delete invitations first (no FK dependencies)
  if (invitationIds.length > 0) {
    await client.from('invitations').delete().in('id', invitationIds)
  }

  // Delete leagues (cascades to participants, teams, draft_picks)
  if (leagueIds.length > 0) {
    // Delete draft picks first
    await client.from('draft_picks').delete().in('league_id', leagueIds)

    // Delete teams via participants
    const { data: participants } = await client
      .from('league_participants')
      .select('id')
      .in('league_id', leagueIds)

    if (participants && participants.length > 0) {
      const participantIds = participants.map((p) => p.id)
      await client.from('teams').delete().in('participant_id', participantIds)
    }

    // Delete participants
    await client.from('league_participants').delete().in('league_id', leagueIds)

    // Delete invitations for these leagues
    await client.from('invitations').delete().in('league_id', leagueIds)

    // Finally delete leagues
    await client.from('leagues').delete().in('id', leagueIds)
  }

  // Delete standalone movies if specified
  if (movieIds.length > 0) {
    await client.from('movies').delete().in('id', movieIds)
  }
}

/**
 * Generate a unique test name with timestamp
 * Helps avoid conflicts when tests run in parallel or are re-run
 */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Wait for a condition to be true (useful for async operations)
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`)
}

/**
 * Extract error message from function invoke response
 * Edge Functions return errors in different formats
 */
export function getErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
    if (typeof e.error === 'string') return e.error
    if (typeof e.context === 'object' && e.context !== null) {
      const ctx = e.context as Record<string, unknown>
      if (typeof ctx.error === 'string') return ctx.error
    }
  }
  return String(error)
}

// =============================================================================
// Test Data Factory
// =============================================================================

/**
 * Factory for creating test data with automatic cleanup tracking
 */
export class TestDataFactory {
  private client: SupabaseClient
  private secondClient: SupabaseClient | null = null
  private leagueIds: string[] = []

  constructor(client: SupabaseClient, secondClient?: SupabaseClient) {
    this.client = client
    this.secondClient = secondClient ?? null
  }

  /**
   * Create a league for testing
   */
  async createLeague(
    name: string,
    options: { invite_only?: boolean; max_participants?: number } = {}
  ): Promise<{ id: string; name: string }> {
    const { data, error } = await this.client.functions.invoke('create-league', {
      body: { name, ...options },
    })
    if (error) throw new Error(`Failed to create league: ${getErrorMessage(error)}`)
    this.leagueIds.push(data.league.id)
    return { id: data.league.id, name: data.league.name }
  }

  /**
   * Create an invitation for a league
   */
  async createInvitation(
    leagueId: string,
    email: string
  ): Promise<{ id: string; token: string }> {
    const { data, error } = await this.client.functions.invoke('send-invite', {
      body: { league_id: leagueId, email },
    })
    if (error) throw new Error(`Failed to create invitation: ${getErrorMessage(error)}`)
    return { id: data.invitation.id, token: data.invitation.token }
  }

  /**
   * Add second test user to a league via invitation
   */
  async addSecondParticipant(leagueId: string): Promise<void> {
    if (!this.secondClient) {
      throw new Error('Second client not provided to TestDataFactory')
    }
    const { token } = await this.createInvitation(leagueId, TEST_USER_2.email)
    const { error } = await this.secondClient.functions.invoke('join-league', {
      body: { token },
    })
    if (error) throw new Error(`Failed to join league: ${getErrorMessage(error)}`)
  }

  /**
   * Create a league with two participants in drafting status
   */
  async createDraftingLeague(name: string): Promise<string> {
    if (!this.secondClient) {
      throw new Error('Second client not provided to TestDataFactory')
    }
    const { id: leagueId } = await this.createLeague(name)
    await this.addSecondParticipant(leagueId)

    const { error } = await this.client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })
    if (error) throw new Error(`Failed to start draft: ${getErrorMessage(error)}`)
    return leagueId
  }

  /**
   * Create a league with a pending invitation
   */
  async createLeagueWithInvitation(
    name: string,
    inviteeEmail = 'invitee@example.com'
  ): Promise<{ leagueId: string; invitationId: string; token: string }> {
    const { id: leagueId } = await this.createLeague(name)
    const { id: invitationId, token } = await this.createInvitation(leagueId, inviteeEmail)
    return { leagueId, invitationId, token }
  }

  /**
   * Track a league ID for cleanup (for leagues created outside the factory)
   */
  trackLeague(leagueId: string): void {
    this.leagueIds.push(leagueId)
  }

  /**
   * Clean up all tracked test data
   */
  async cleanup(): Promise<void> {
    await cleanupTestData(this.client, { leagueIds: this.leagueIds })
    this.leagueIds = []
  }
}

/**
 * Create a test data factory with authenticated clients
 */
export async function createTestFactory(): Promise<{
  client: SupabaseClient
  secondClient: SupabaseClient
  factory: TestDataFactory
}> {
  const client = await getAuthenticatedClient()
  const secondClient = await getSecondAuthenticatedClient()
  const factory = new TestDataFactory(client, secondClient)
  return { client, secondClient, factory }
}
