/**
 * Test setup utilities for Edge Function integration tests
 *
 * These helpers provide authentication, cleanup, and common test utilities
 * for testing Edge Functions via client.functions.invoke()
 */

import { createClient, SupabaseClient, FunctionsHttpError } from '@supabase/supabase-js'

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
 * Client options for testing - disables background timers that cause resource leaks
 * See: https://github.com/orgs/supabase/discussions/20078
 */
const TEST_CLIENT_OPTIONS = {
  auth: {
    autoRefreshToken: false,    // Disables the refresh interval timer
    persistSession: false,      // Don't persist to storage
    detectSessionInUrl: false,  // Don't scan URL for tokens
  },
}

/**
 * Get Supabase URL and keys from environment
 */
function getEnvVars() {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !anonKey) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL and SUPABASE_ANON_KEY\n' +
        'Make sure you have a .env file or export them before running tests.'
    )
  }

  return { url, anonKey, serviceRoleKey }
}

/**
 * Create an anonymous (unauthenticated) Supabase client
 * Use this for testing 401 responses
 */
export function getAnonClient(): SupabaseClient {
  const { url, anonKey } = getEnvVars()
  return createClient(url, anonKey, TEST_CLIENT_OPTIONS)
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
 * Authenticate a user, creating them if necessary.
 * Uses admin API to create users with email pre-confirmed for testing.
 */
async function authenticateUser(user: { email: string; password: string }): Promise<SupabaseClient> {
  const { url, anonKey, serviceRoleKey } = getEnvVars()
  const client = createClient(url, anonKey, TEST_CLIENT_OPTIONS)

  // Try to sign in first
  const { error: signInError } = await client.auth.signInWithPassword(user)

  if (signInError) {
    // User doesn't exist or isn't confirmed - use admin API
    if (!serviceRoleKey) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is required to create test users with email confirmation enabled.\n' +
          'Get it from: npx supabase status'
      )
    }

    const adminClient = createClient(url, serviceRoleKey, TEST_CLIENT_OPTIONS)

    // Check if user exists but needs confirmation
    const { data: existingUsers } = await adminClient.auth.admin.listUsers()
    const existingUser = existingUsers?.users?.find((u) => u.email === user.email)

    if (existingUser) {
      // User exists - update to confirm email and reset password
      await adminClient.auth.admin.updateUserById(existingUser.id, {
        email_confirm: true,
        password: user.password,
      })
    } else {
      // Create new user with pre-confirmed email
      const { error: createError } = await adminClient.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      })

      if (createError) {
        throw new Error(`Failed to create test user: ${createError.message}`)
      }
    }

    // Sign in with the user
    const { error: retrySignInError } = await client.auth.signInWithPassword(user)
    if (retrySignInError) {
      throw new Error(`Failed to sign in after setup: ${retrySignInError.message}`)
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

/**
 * Result type for Edge Function invocation that properly handles error responses
 */
export interface InvokeResult<T = unknown> {
  data: T | null
  error: string | null
  status?: number
}

/**
 * Invoke an Edge Function and properly extract error messages from non-2xx responses.
 *
 * The Supabase SDK's functions.invoke() returns `data: null` for non-2xx responses
 * and puts a generic error message in `error`. To get the actual error message from
 * the response body, you need to use `error.context.json()`.
 *
 * This helper normalizes the response so you can always check `result.error` for
 * the actual error message.
 */
export async function invokeFunction<T = unknown>(
  client: SupabaseClient,
  functionName: string,
  body?: Record<string, unknown>
): Promise<InvokeResult<T>> {
  const { data, error } = await client.functions.invoke(functionName, { body })

  // If no error, return the data
  if (!error) {
    return { data: data as T, error: null }
  }

  // For FunctionsHttpError, extract the actual error message from the response body
  if (error instanceof FunctionsHttpError) {
    try {
      const errorBody = await error.context.json()
      return {
        data: null,
        error: errorBody?.error || 'Unknown error',
        status: error.context.status
      }
    } catch {
      // If we can't parse the error body, return the generic message
      return { data: null, error: error.message }
    }
  }

  // For other error types, return the message
  return { data: null, error: error.message }
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
    const result = await invokeFunction<{ league: { id: string; name: string } }>(
      this.client,
      'create-league',
      { name, ...options }
    )
    if (result.error) throw new Error(`Failed to create league: ${result.error}`)
    this.leagueIds.push(result.data!.league.id)
    return { id: result.data!.league.id, name: result.data!.league.name }
  }

  /**
   * Create an invitation for a league
   */
  async createInvitation(
    leagueId: string,
    email: string
  ): Promise<{ id: string; token: string }> {
    const result = await invokeFunction<{ invitation: { id: string; token: string } }>(
      this.client,
      'send-invite',
      { league_id: leagueId, email }
    )
    if (result.error) throw new Error(`Failed to create invitation: ${result.error}`)
    return { id: result.data!.invitation.id, token: result.data!.invitation.token }
  }

  /**
   * Add second test user to a league via invitation
   */
  async addSecondParticipant(leagueId: string): Promise<void> {
    if (!this.secondClient) {
      throw new Error('Second client not provided to TestDataFactory')
    }
    const { token } = await this.createInvitation(leagueId, TEST_USER_2.email)
    const result = await invokeFunction(this.secondClient, 'join-league', { invitation_token: token })
    if (result.error) throw new Error(`Failed to join league: ${result.error}`)
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

    const result = await invokeFunction(this.client, 'start-draft', { league_id: leagueId })
    if (result.error) throw new Error(`Failed to start draft: ${result.error}`)
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
