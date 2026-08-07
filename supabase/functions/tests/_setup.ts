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

export const TEST_USER_3 = {
  email: 'test-integration-3@example.com',
  password: 'integration-test-password-789!',
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
 * Create an authenticated Supabase client for the third test user
 * Useful for multi-user bidding tests
 */
export async function getThirdAuthenticatedClient(): Promise<SupabaseClient> {
  return authenticateUser(TEST_USER_3)
}

/**
 * Get a service role client for direct database operations
 */
export function getServiceClient(): SupabaseClient {
  const { url, serviceRoleKey } = getEnvVars()
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for service client')
  }
  return createClient(url, serviceRoleKey, TEST_CLIENT_OPTIONS)
}

/**
 * Whether steps that call the live MDBList / TMDb APIs should run.
 *
 * Those calls draw down a shared daily quota -- MDBList allows 1000 req/day on
 * the same account the production nightly score sync uses -- and an exhausted
 * quota surfaces as `movies_fetched: 0`, which is indistinguishable from a real
 * regression. They also scale with however many movies have accumulated in the
 * local database, so their cost grows silently run over run.
 *
 * So they are opt-in: skipped unless RUN_EXTERNAL_API_TESTS=1, which
 * `deno task test:external` sets. The behaviour they cover is otherwise
 * asserted against mocks in `_shared/*.test.ts`; what stays here is a small
 * number of contract tests, the only thing that catches MDBList or TMDb
 * changing response shape, auth, or field names.
 */
export const RUN_EXTERNAL_API_TESTS = Deno.env.get('RUN_EXTERNAL_API_TESTS') === '1'

/**
 * Get the service role key that the Edge Function runtime actually uses.
 *
 * Functions with custom auth (X-Cron-Secret OR Bearer service_role) are called
 * via direct fetch() rather than client.functions.invoke(). The .env.test key
 * may not match the Docker container's key if Supabase has been restarted, so
 * query the container directly, falling back to .env.test.
 */
export async function getEdgeFunctionServiceRoleKey(): Promise<string> {
  try {
    const cmd = new Deno.Command('docker', {
      args: ['exec', 'supabase_edge_runtime_fantasy-reel', 'printenv', 'SUPABASE_SERVICE_ROLE_KEY'],
      stdout: 'piped',
      stderr: 'piped',
    })
    const output = await cmd.output()
    if (output.success) {
      const key = new TextDecoder().decode(output.stdout).trim()
      if (key) return key
    }
  } catch {
    // Docker not available or container not found
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
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
    // Get teams for these leagues (needed for bidding table cleanup)
    const { data: participants } = await client
      .from('league_participants')
      .select('id, teams(id)')
      .in('league_id', leagueIds)

    const teamIds = participants
      ?.filter((p) => p.teams)
      .map((p) => (p.teams as unknown as { id: string }).id)
      .filter(Boolean) ?? []

    // Delete bidding-related tables first (respect FK order)
    if (teamIds.length > 0) {
      // Delete trade_offers (references teams)
      await client.from('trade_offers').delete().in('league_id', leagueIds)

      // Delete counterpicks before draft_picks (FK constraint)
      await client.from('counterpicks').delete().in('league_id', leagueIds)

      // Delete team_drops (references pickups)
      await client.from('team_drops').delete().in('team_id', teamIds)

      // Delete notifications for these leagues
      await client.from('notifications').delete().in('league_id', leagueIds)

      // Delete pickups (references pickup_bids)
      await client.from('pickups').delete().in('league_id', leagueIds)

      // Delete pickup_bids
      await client.from('pickup_bids').delete().in('league_id', leagueIds)

      // Delete team_budgets
      await client.from('team_budgets').delete().in('team_id', teamIds)
    }

    // Delete draft picks
    await client.from('draft_picks').delete().in('league_id', leagueIds)

    // Delete teams
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
 * Per-run base for draft-pool tmdb_ids, monotonic across the whole run.
 *
 * A fixed base (formerly 900_100_001) made every run reuse the same movie
 * rows via draft-pick's find-or-create — and tests that legitimately mark a
 * drafted movie as released (weekly-releases-digest,
 * release-day-announcements set release_date to "today") poisoned those
 * shared rows for every LATER run: the next day, "today" is in the past and
 * every draft fails pick validation with "Movie has already been released".
 *
 * Seeded from the clock so each run gets fresh ids, and monotonic within the
 * run so ranges never collide between createActiveLeague calls. Stays inside
 * 900,000,000-940,000,000: no real TMDb ids live there (so
 * sync-release-dates can't "correct" the fake future dates), and it sits
 * below the 950m+ band other test fixtures use.
 */
let draftPoolCursor = 900_000_000 + (Date.now() % 40_000_000)

function nextDraftPoolTmdbId(): number {
  // Reserve a generous block per call; drafts use ~30 ids at most.
  const base = draftPoolCursor
  draftPoolCursor += 1000
  return base
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
      // Edge Functions return { error: "..." }
      // Kong/Auth returns { msg: "..." } for JWT errors
      const errorMessage = errorBody?.error || errorBody?.msg || 'Unknown error'
      return {
        data: null,
        error: errorMessage,
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
  private thirdClient: SupabaseClient | null = null
  private leagueIds: string[] = []
  private movieIds: string[] = []

  constructor(client: SupabaseClient, secondClient?: SupabaseClient) {
    this.client = client
    this.secondClient = secondClient ?? null
  }

  /**
   * Create and return a third authenticated client for multi-user tests
   */
  async createThirdClient(): Promise<SupabaseClient> {
    if (!this.thirdClient) {
      this.thirdClient = await getThirdAuthenticatedClient()
    }
    return this.thirdClient
  }

  /**
   * Create a league for testing
   */
  async createLeague(
    name: string,
    options: { invite_only?: boolean; max_participants?: number; draft_counterpick_slots?: number } = {}
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

    // start-draft randomizes draft_order via randomize_draft_order_if_needed().
    // Force deterministic order for tests: owner=1, second=2.
    const serviceClient = getServiceClient()
    const ownerUserId = await getUserId(this.client)
    const secondUserId = await getUserId(this.secondClient)

    await serviceClient
      .from('league_participants')
      .update({ draft_order: 1 })
      .eq('league_id', leagueId)
      .eq('user_id', ownerUserId)

    await serviceClient
      .from('league_participants')
      .update({ draft_order: 2 })
      .eq('league_id', leagueId)
      .eq('user_id', secondUserId)

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
   * Add a participant to a league using a client
   * Used for adding third+ participants in multi-user tests
   */
  async addParticipantToLeague(leagueId: string, userClient: SupabaseClient): Promise<void> {
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) throw new Error('Client is not authenticated')

    const { token } = await this.createInvitation(leagueId, user.email!)
    const result = await invokeFunction(userClient, 'join-league', { invitation_token: token })
    if (result.error) throw new Error(`Failed to join league: ${result.error}`)
  }

  /**
   * Create an active league (draft completed, budgets initialized)
   * This completes the full draft with all participants making picks.
   * Draft movies use tmdb_ids from a per-run range (see
   * nextDraftPoolTmdbId) with no real TMDb entries.
   * @param name League name
   * @param numParticipants Number of participants (default: 2, max: 3 for test support)
   */
  async createActiveLeague(name: string, numParticipants = 2): Promise<string> {
    if (!this.secondClient) {
      throw new Error('Second client not provided to TestDataFactory')
    }
    if (numParticipants < 2 || numParticipants > 3) {
      throw new Error('numParticipants must be 2 or 3')
    }

    // Create league with all participants BEFORE draft starts
    // Set draft_counterpick_slots=0 so draft completion auto-activates the league
    const { id: leagueId } = await this.createLeague(name, { draft_counterpick_slots: 0 })
    await this.addSecondParticipant(leagueId)

    // Add third participant if requested
    let thirdClient: SupabaseClient | null = null
    if (numParticipants >= 3) {
      thirdClient = await this.createThirdClient()
      await this.addParticipantToLeague(leagueId, thirdClient)
    }

    // Start the draft (randomizes draft_order via randomize_draft_order_if_needed)
    const startResult = await invokeFunction(this.client, 'start-draft', { league_id: leagueId })
    if (startResult.error) throw new Error(`Failed to start draft: ${startResult.error}`)

    // Get the service client for direct DB access
    const serviceClient = getServiceClient()

    // Query actual draft order and build clients array to match
    const { data: orderedParticipants } = await serviceClient
      .from('league_participants')
      .select('user_id, draft_order')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    const allClients: SupabaseClient[] = [this.client, this.secondClient]
    if (thirdClient) allClients.push(thirdClient)

    const userIdToClient = new Map<string, SupabaseClient>()
    for (const c of allClients) {
      const { data: { user } } = await c.auth.getUser()
      userIdToClient.set(user!.id, c)
    }

    const clients: SupabaseClient[] = orderedParticipants!.map(
      p => userIdToClient.get(p.user_id)!
    )

    // Get league config (draft_slots determines how many rounds)
    const { data: league } = await serviceClient
      .from('leagues')
      .select('draft_slots')
      .eq('id', leagueId)
      .single()

    const draftSlots = league?.draft_slots ?? 5
    const totalPicks = draftSlots * numParticipants

    // Make all required draft picks to complete the draft
    // Snake draft: e.g. with 3 players: 1,2,3,3,2,1,1,2,3...
    // The counter must sit in a range with NO real TMDb movies: IDs like
    // 200001 exist on TMDb, so sync-release-dates would "correct" the pool
    // movies' fake future dates to the real films' past dates, breaking
    // every later draft with "Movie was released in a previous year".
    let tmdbIdCounter = nextDraftPoolTmdbId()
    const currentYear = new Date().getFullYear()

    for (let pickNum = 1; pickNum <= totalPicks; pickNum++) {
      const round = Math.ceil(pickNum / numParticipants)
      const positionInRound = (pickNum - 1) % numParticipants // 0-indexed

      // Snake draft: odd rounds go forward (0,1,2), even rounds go backward (2,1,0)
      let clientIndex: number
      if (round % 2 === 1) {
        clientIndex = positionInRound
      } else {
        clientIndex = numParticipants - 1 - positionInRound
      }

      const currentClient = clients[clientIndex]

      const movieData = {
        title: `Draft Movie ${tmdbIdCounter}`,
        overview: 'Test movie for draft',
        poster_url: '/test-poster.jpg',
        release_date: `${currentYear}-12-15`,
        vote_average: 7.5,
        popularity: 100,
        genre_ids: [28, 12],
      }

      const result = await invokeFunction(currentClient, 'draft-pick', {
        league_id: leagueId,
        tmdb_id: tmdbIdCounter,
        movie_data: movieData,
      })

      if (result.error) {
        throw new Error(`Failed to make draft pick ${pickNum}: ${result.error}`)
      }

      tmdbIdCounter++
    }

    // Verify the league is now active
    const { data: updatedLeague } = await serviceClient
      .from('leagues')
      .select('status')
      .eq('id', leagueId)
      .single()

    if (updatedLeague?.status !== 'active') {
      throw new Error(`League is not active after draft completion. Status: ${updatedLeague?.status}`)
    }

    return leagueId
  }

  /**
   * Create a pickup record for a user's team (simulates a won bid)
   * This directly inserts the pickup record for testing drop functionality.
   */
  async createPickupForUser(
    leagueId: string,
    userClient: SupabaseClient,
    movieData: {
      tmdb_id: number
      title: string
      release_date: string | null
      overview?: string
      poster_url?: string | null
      vote_average?: number
      popularity?: number
    }
  ): Promise<string> {
    const serviceClient = getServiceClient()

    // Get user's team
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) throw new Error('Client is not authenticated')

    const { data: participant } = await serviceClient
      .from('league_participants')
      .select('id, teams(id)')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!participant) throw new Error('User is not a member of this league')

    const team = participant.teams as unknown as { id: string }
    if (!team) throw new Error('Team not found for user')

    // Create or find the movie
    let movieId: string
    const { data: existingMovie } = await serviceClient
      .from('movies')
      .select('id')
      .eq('tmdb_id', movieData.tmdb_id)
      .single()

    if (existingMovie) {
      movieId = existingMovie.id
    } else {
      const { data: newMovie, error: movieError } = await serviceClient
        .from('movies')
        .insert({
          tmdb_id: movieData.tmdb_id,
          title: movieData.title,
          overview: movieData.overview || 'Test movie',
          poster_url: movieData.poster_url || null,
          release_date: movieData.release_date,
          vote_average: movieData.vote_average ?? 0,
          popularity: movieData.popularity ?? 100,
          status: 'upcoming',
        })
        .select('id')
        .single()

      if (movieError || !newMovie) {
        throw new Error(`Failed to create movie: ${movieError?.message}`)
      }
      movieId = newMovie.id
      this.movieIds.push(movieId)
    }

    // Create a fake bid record first (required for pickup FK)
    const { data: bidData, error: bidError } = await serviceClient
      .from('pickup_bids')
      .insert({
        league_id: leagueId,
        team_id: team.id,
        tmdb_id: movieData.tmdb_id,
        movie_data: movieData,
        amount: 10,
        status: 'won',
        processing_deadline: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (bidError || !bidData) {
      throw new Error(`Failed to create bid: ${bidError?.message}`)
    }

    // Create the pickup record
    const { data: pickup, error: pickupError } = await serviceClient
      .from('pickups')
      .insert({
        league_id: leagueId,
        team_id: team.id,
        movie_id: movieId,
        bid_id: bidData.id,
        amount_paid: 10,
      })
      .select('id')
      .single()

    if (pickupError || !pickup) {
      throw new Error(`Failed to create pickup: ${pickupError?.message}`)
    }

    return pickup.id
  }

  /**
   * Create a draft pick record for a user's team (for testing drop functionality)
   * This directly inserts a draft pick record.
   */
  async createDraftPickForUser(
    leagueId: string,
    userClient: SupabaseClient,
    movieData: {
      tmdb_id: number
      title: string
      release_date: string | null
      overview?: string
      poster_url?: string | null
      vote_average?: number
      popularity?: number
    }
  ): Promise<string> {
    const serviceClient = getServiceClient()

    // Get user's team
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) throw new Error('Client is not authenticated')

    const { data: participant } = await serviceClient
      .from('league_participants')
      .select('id, teams(id)')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!participant) throw new Error('User is not a member of this league')

    const team = participant.teams as unknown as { id: string }
    if (!team) throw new Error('Team not found for user')

    // Create or find the movie
    let movieId: string
    const { data: existingMovie } = await serviceClient
      .from('movies')
      .select('id')
      .eq('tmdb_id', movieData.tmdb_id)
      .single()

    if (existingMovie) {
      movieId = existingMovie.id
    } else {
      const { data: newMovie, error: movieError } = await serviceClient
        .from('movies')
        .insert({
          tmdb_id: movieData.tmdb_id,
          title: movieData.title,
          overview: movieData.overview || 'Test movie',
          poster_url: movieData.poster_url || null,
          release_date: movieData.release_date,
          vote_average: movieData.vote_average ?? 0,
          popularity: movieData.popularity ?? 100,
          status: 'upcoming',
        })
        .select('id')
        .single()

      if (movieError || !newMovie) {
        throw new Error(`Failed to create movie: ${movieError?.message}`)
      }
      movieId = newMovie.id
      this.movieIds.push(movieId)
    }

    // Get the next pick number for this league
    const { data: existingPicks } = await serviceClient
      .from('draft_picks')
      .select('pick_number')
      .eq('league_id', leagueId)
      .order('pick_number', { ascending: false })
      .limit(1)

    const nextPickNumber = existingPicks && existingPicks.length > 0
      ? existingPicks[0].pick_number + 1
      : 1

    // Create the draft pick record
    const { data: draftPick, error: draftPickError } = await serviceClient
      .from('draft_picks')
      .insert({
        league_id: leagueId,
        team_id: team.id,
        movie_id: movieId,
        round: 1,
        pick_number: nextPickNumber,
        picked_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (draftPickError || !draftPick) {
      throw new Error(`Failed to create draft pick: ${draftPickError?.message}`)
    }

    return draftPick.id
  }

  /**
   * Track a league ID for cleanup (for leagues created outside the factory)
   */
  trackLeague(leagueId: string): void {
    this.leagueIds.push(leagueId)
  }

  /**
   * Add a counterpick to a draft pick (for testing drop blocking)
   * This simulates another team placing a counterpick on the draft pick.
   */
  async addCounterpickToDraftPick(
    leagueId: string,
    draftPickId: string,
    counterpickerClient: SupabaseClient
  ): Promise<string> {
    const serviceClient = getServiceClient()

    // Get counterpicker's team
    const { data: { user } } = await counterpickerClient.auth.getUser()
    if (!user) throw new Error('Client is not authenticated')

    const { data: counterpickerParticipant } = await serviceClient
      .from('league_participants')
      .select('id, teams(id)')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!counterpickerParticipant) throw new Error('Counterpicker is not a member of this league')

    const counterpickerTeam = counterpickerParticipant.teams as unknown as { id: string }
    if (!counterpickerTeam) throw new Error('Team not found for counterpicker')

    // Get the draft pick details
    const { data: draftPick } = await serviceClient
      .from('draft_picks')
      .select('movie_id, team_id')
      .eq('id', draftPickId)
      .single()

    if (!draftPick) throw new Error('Draft pick not found')

    // Get the next pick order for counterpicks
    const { data: existingCounterpicks } = await serviceClient
      .from('counterpicks')
      .select('pick_order')
      .eq('league_id', leagueId)
      .order('pick_order', { ascending: false })
      .limit(1)

    const nextPickOrder = existingCounterpicks && existingCounterpicks.length > 0
      ? existingCounterpicks[0].pick_order + 1
      : 1

    // Create the counterpick record
    const { data: counterpick, error: counterpickError } = await serviceClient
      .from('counterpicks')
      .insert({
        league_id: leagueId,
        counterpicker_team_id: counterpickerTeam.id,
        target_team_id: draftPick.team_id,
        movie_id: draftPick.movie_id,
        draft_pick_id: draftPickId,
        pick_order: nextPickOrder,
        phase: 'draft',
      })
      .select('id')
      .single()

    if (counterpickError || !counterpick) {
      throw new Error(`Failed to create counterpick: ${counterpickError?.message}`)
    }

    // Update the draft_picks table to mark it as counterpicked
    const { error: updateError } = await serviceClient
      .from('draft_picks')
      .update({ counterpicked_by_team_id: counterpickerTeam.id })
      .eq('id', draftPickId)

    if (updateError) {
      throw new Error(`Failed to update draft pick with counterpick: ${updateError.message}`)
    }

    return counterpick.id
  }

  /**
   * Update a league's counterpick blocking setting
   */
  async setCounterpickBlockDrops(leagueId: string, blockDrops: boolean): Promise<void> {
    const serviceClient = getServiceClient()
    const { error } = await serviceClient
      .from('leagues')
      .update({ counterpicks_block_drops: blockDrops })
      .eq('id', leagueId)

    if (error) {
      throw new Error(`Failed to update counterpicks_block_drops: ${error.message}`)
    }
  }

  /**
   * Create an active league with trading enabled
   */
  async createTradingLeague(name: string, numParticipants = 2): Promise<string> {
    const leagueId = await this.createActiveLeague(name, numParticipants)

    // Enable trading on the league
    const serviceClient = getServiceClient()
    await serviceClient
      .from('leagues')
      .update({
        trades_enabled: true,
        trade_deadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 1 year
        trade_veto_hours: 24,
        trade_review_enabled: true,
      })
      .eq('id', leagueId)

    return leagueId
  }

  /**
   * Get team info for a user in a league
   */
  async getTeamForUser(
    leagueId: string,
    userClient: SupabaseClient
  ): Promise<{ teamId: string; teamName: string } | null> {
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) throw new Error('Client is not authenticated')

    const serviceClient = getServiceClient()
    const { data: participant } = await serviceClient
      .from('league_participants')
      .select('id, teams(id, name)')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!participant) return null

    const team = participant.teams as unknown as { id: string; name: string }
    if (!team) return null

    return { teamId: team.id, teamName: team.name }
  }

  /**
   * Get user's draft picks in a league (for trading tests)
   */
  async getDraftPicksForUser(
    leagueId: string,
    userClient: SupabaseClient
  ): Promise<Array<{ id: string; movie_id: string; movie_title: string }>> {
    const teamInfo = await this.getTeamForUser(leagueId, userClient)
    if (!teamInfo) return []

    const serviceClient = getServiceClient()
    const { data: picks } = await serviceClient
      .from('draft_picks')
      .select('id, movie_id, movies(title)')
      .eq('team_id', teamInfo.teamId)
      .eq('league_id', leagueId)
      .is('dropped_at', null)

    if (!picks) return []

    return picks.map((p) => ({
      id: p.id,
      movie_id: p.movie_id,
      movie_title: (p.movies as unknown as { title: string })?.title ?? 'Unknown',
    }))
  }

  /**
   * Clean up all tracked test data
   */
  async cleanup(): Promise<void> {
    await cleanupTestData(this.client, {
      leagueIds: this.leagueIds,
      movieIds: this.movieIds,
    })
    this.leagueIds = []
    this.movieIds = []
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
