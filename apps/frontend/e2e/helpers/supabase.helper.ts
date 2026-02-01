import { createClient, SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase helper for E2E test database operations
 * Uses service role key for admin operations (user creation, cleanup)
 */

// These should match your local Supabase instance
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Admin client for test setup/teardown
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adminClient: SupabaseClient<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAdminClient(): SupabaseClient<any> {
  if (!adminClient) {
    if (!SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for E2E tests')
    }
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return adminClient
}

// Anon client for simulating unauthenticated requests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAnonClient(): SupabaseClient<any> {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

export interface TestUser {
  id: string
  email: string
  password: string
  displayName: string
}

/**
 * Create a test user with verified email (skips email confirmation)
 */
export async function createTestUser(prefix: string): Promise<TestUser> {
  const client = getAdminClient()
  const timestamp = Date.now()
  const email = `test-${prefix}-${timestamp}@test.local`
  const password = 'TestPassword123!'
  const displayName = `Test User ${prefix}`

  // Create user via admin API (auto-confirms email)
  const { data: authData, error: authError } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  })

  if (authError || !authData.user) {
    throw new Error(`Failed to create test user: ${authError?.message}`)
  }

  // Create profile
  const { error: profileError } = await client.from('profiles').insert({
    id: authData.user.id,
    user_id: authData.user.id,
    display_name: displayName,
  })

  if (profileError) {
    // Cleanup auth user if profile creation fails
    await client.auth.admin.deleteUser(authData.user.id)
    throw new Error(`Failed to create profile: ${profileError.message}`)
  }

  return {
    id: authData.user.id,
    email,
    password,
    displayName,
  }
}

/**
 * Delete a test user and all associated data (cascades via foreign keys)
 */
export async function deleteTestUser(userId: string): Promise<void> {
  const client = getAdminClient()
  const { error } = await client.auth.admin.deleteUser(userId)
  if (error) {
    console.warn(`Failed to delete test user ${userId}: ${error.message}`)
  }
}

export interface TestLeague {
  id: string
  name: string
  ownerId: string
  status: 'setup' | 'drafting' | 'active' | 'completed'
}

/**
 * Create a test league
 */
export async function createTestLeague(
  ownerId: string,
  options?: {
    name?: string
    status?: TestLeague['status']
    maxParticipants?: number
    draftType?: 'snake' | 'linear'
  }
): Promise<TestLeague> {
  const client = getAdminClient()
  const name = options?.name || `E2E Test League ${Date.now()}`

  const { data, error } = await client
    .from('leagues')
    .insert({
      name,
      owner_id: ownerId,
      status: options?.status || 'setup',
      max_participants: options?.maxParticipants || 8,
      draft_type: options?.draftType || 'snake',
      invite_only: true,
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create test league: ${error?.message}`)
  }

  // Add owner as participant
  await client.from('league_participants').insert({
    league_id: data.id,
    user_id: ownerId,
    role: 'owner',
    status: 'active',
  })

  return {
    id: data.id,
    name: data.name,
    ownerId: data.owner_id,
    status: data.status as TestLeague['status'],
  }
}

/**
 * Add a participant to a league
 */
export async function addParticipant(
  leagueId: string,
  userId: string,
  role: 'member' | 'owner' = 'member'
): Promise<void> {
  const client = getAdminClient()

  const { error } = await client.from('league_participants').insert({
    league_id: leagueId,
    user_id: userId,
    role,
    status: 'active',
  })

  if (error) {
    throw new Error(`Failed to add participant: ${error.message}`)
  }
}

/**
 * Create a team for a participant
 */
export async function createTeam(
  leagueId: string,
  userId: string,
  teamName: string
): Promise<{ id: string; name: string }> {
  const client = getAdminClient()

  // Get participant ID
  const { data: participant } = await client
    .from('league_participants')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .single()

  if (!participant) {
    throw new Error('Participant not found')
  }

  const { data: team, error } = await client
    .from('teams')
    .insert({
      participant_id: participant.id,
      name: teamName,
      faab_budget: 100,
    })
    .select()
    .single()

  if (error || !team) {
    throw new Error(`Failed to create team: ${error?.message}`)
  }

  return { id: team.id, name: team.name }
}

/**
 * Delete a test league and all associated data
 */
export async function deleteTestLeague(leagueId: string): Promise<void> {
  const client = getAdminClient()
  const { error } = await client.from('leagues').delete().eq('id', leagueId)
  if (error) {
    console.warn(`Failed to delete test league ${leagueId}: ${error.message}`)
  }
}

/**
 * Clean up all test data (users, leagues created during tests)
 */
export async function cleanupTestData(): Promise<void> {
  const client = getAdminClient()

  // Delete test leagues
  await client.from('leagues').delete().like('name', 'E2E Test League%')

  // Delete test users
  const { data: users } = await client.auth.admin.listUsers()
  const testUsers = users?.users.filter((u) =>
    u.email?.includes('@test.local')
  ) || []

  for (const user of testUsers) {
    await client.auth.admin.deleteUser(user.id)
  }
}

/**
 * Create an invitation for a league
 */
export async function createInvitation(
  leagueId: string,
  email: string,
  invitedBy: string
): Promise<{ id: string; token: string }> {
  const client = getAdminClient()
  const token = `test-token-${Date.now()}`

  const { data, error } = await client
    .from('invitations')
    .insert({
      league_id: leagueId,
      email,
      invited_by: invitedBy,
      token,
      status: 'pending',
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create invitation: ${error?.message}`)
  }

  return { id: data.id, token: data.token }
}

/**
 * Update league status (for test setup)
 */
export async function updateLeagueStatus(
  leagueId: string,
  status: TestLeague['status']
): Promise<void> {
  const client = getAdminClient()
  const { error } = await client
    .from('leagues')
    .update({ status })
    .eq('id', leagueId)

  if (error) {
    throw new Error(`Failed to update league status: ${error.message}`)
  }
}

/**
 * Generate a shareable join link for a league
 */
export async function generateJoinLink(
  leagueId: string
): Promise<{ joinCode: string }> {
  const client = getAdminClient()

  // Generate a random join code (matches Edge Function format)
  const joinCode = generateRandomCode(12)

  const { error } = await client
    .from('leagues')
    .update({ join_code: joinCode })
    .eq('id', leagueId)

  if (error) {
    throw new Error(`Failed to generate join link: ${error.message}`)
  }

  return { joinCode }
}

/**
 * Get the join code for a league
 */
export async function getLeagueJoinCode(
  leagueId: string
): Promise<string | null> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('leagues')
    .select('join_code')
    .eq('id', leagueId)
    .single()

  if (error) {
    throw new Error(`Failed to get join code: ${error.message}`)
  }

  return data?.join_code || null
}

/**
 * Clear the join code for a league (for testing regeneration)
 */
export async function clearJoinCode(leagueId: string): Promise<void> {
  const client = getAdminClient()

  const { error } = await client
    .from('leagues')
    .update({ join_code: null })
    .eq('id', leagueId)

  if (error) {
    throw new Error(`Failed to clear join code: ${error.message}`)
  }
}

/**
 * Create a draft pick for testing
 */
export async function createDraftPick(
  leagueId: string,
  teamId: string,
  movieId: string,
  pickOrder: number,
  round: number
): Promise<{ id: string }> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('draft_picks')
    .insert({
      league_id: leagueId,
      team_id: teamId,
      movie_id: movieId,
      pick_order: pickOrder,
      round,
      picked_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create draft pick: ${error?.message}`)
  }

  return { id: data.id }
}

/**
 * Create a movie in the database for testing
 */
export async function createTestMovie(
  tmdbId: number,
  title: string,
  releaseDate: string,
  options?: {
    posterUrl?: string
    status?: 'upcoming' | 'released'
    overview?: string
  }
): Promise<{ id: string; tmdbId: number }> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('movies')
    .upsert(
      {
        tmdb_id: tmdbId,
        title,
        release_date: releaseDate,
        poster_url: options?.posterUrl || `/test-poster-${tmdbId}.jpg`,
        status: options?.status || 'upcoming',
        overview: options?.overview || `Test movie ${title}`,
      },
      { onConflict: 'tmdb_id' }
    )
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create test movie: ${error?.message}`)
  }

  return { id: data.id, tmdbId: data.tmdb_id }
}

/**
 * Helper to generate random alphanumeric code
 */
function generateRandomCode(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Create an expired invitation for testing
 */
export async function createExpiredInvitation(
  leagueId: string,
  email: string,
  invitedBy: string
): Promise<{ id: string; token: string }> {
  const client = getAdminClient()
  const token = `expired-token-${Date.now()}`

  // Set expires_at to yesterday
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  const { data, error } = await client
    .from('invitations')
    .insert({
      league_id: leagueId,
      email,
      invited_by: invitedBy,
      token,
      status: 'pending',
      expires_at: yesterday.toISOString(),
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create expired invitation: ${error?.message}`)
  }

  return { id: data.id, token: data.token }
}

/**
 * Create a pickup bid for testing
 */
export async function createPickupBid(
  leagueId: string,
  teamId: string,
  tmdbId: number,
  amount: number,
  movieData: {
    title: string
    posterUrl?: string
    releaseDate?: string
  },
  options?: {
    status?: 'active' | 'outbid' | 'won' | 'lost' | 'cancelled'
  }
): Promise<{ id: string }> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('pickup_bids')
    .insert({
      league_id: leagueId,
      team_id: teamId,
      tmdb_id: tmdbId,
      amount,
      status: options?.status || 'active',
      movie_data: {
        title: movieData.title,
        poster_url: movieData.posterUrl || `/test-poster-${tmdbId}.jpg`,
        release_date: movieData.releaseDate || '2025-12-01',
      },
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create pickup bid: ${error?.message}`)
  }

  return { id: data.id }
}

/**
 * Create a trade offer for testing
 */
export async function createTradeOffer(
  leagueId: string,
  initiatorTeamId: string,
  recipientTeamId: string,
  options?: {
    status?: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'vetoed'
  }
): Promise<{ id: string }> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('trade_offers')
    .insert({
      league_id: leagueId,
      initiator_team_id: initiatorTeamId,
      recipient_team_id: recipientTeamId,
      status: options?.status || 'pending',
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create trade offer: ${error?.message}`)
  }

  return { id: data.id }
}

/**
 * Add a movie to a trade offer
 */
export async function addTradeAsset(
  tradeOfferId: string,
  fromTeamId: string,
  toTeamId: string,
  movieId: string
): Promise<{ id: string }> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('trade_assets')
    .insert({
      trade_offer_id: tradeOfferId,
      from_team_id: fromTeamId,
      to_team_id: toTeamId,
      movie_id: movieId,
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to add trade asset: ${error?.message}`)
  }

  return { id: data.id }
}

/**
 * Create or update team score for testing
 */
export async function setTeamScore(
  teamId: string,
  totalPoints: number
): Promise<void> {
  const client = getAdminClient()

  const { error } = await client
    .from('team_scores')
    .upsert(
      {
        team_id: teamId,
        total_points: totalPoints,
        last_updated: new Date().toISOString(),
      },
      { onConflict: 'team_id' }
    )

  if (error) {
    throw new Error(`Failed to set team score: ${error.message}`)
  }
}

/**
 * Create movie reviews (scores) for testing
 */
export async function createMovieReviews(
  movieId: string,
  scores: {
    imdb?: number
    rottenTomatoes?: number
    metacritic?: number
  }
): Promise<void> {
  const client = getAdminClient()
  const reviews = []

  if (scores.imdb !== undefined) {
    reviews.push({
      movie_id: movieId,
      source: 'imdb',
      score: scores.imdb,
      fetched_at: new Date().toISOString(),
    })
  }

  if (scores.rottenTomatoes !== undefined) {
    reviews.push({
      movie_id: movieId,
      source: 'rotten_tomatoes',
      score: scores.rottenTomatoes,
      fetched_at: new Date().toISOString(),
    })
  }

  if (scores.metacritic !== undefined) {
    reviews.push({
      movie_id: movieId,
      source: 'metacritic',
      score: scores.metacritic,
      fetched_at: new Date().toISOString(),
    })
  }

  if (reviews.length > 0) {
    const { error } = await client.from('reviews').insert(reviews)
    if (error) {
      throw new Error(`Failed to create movie reviews: ${error.message}`)
    }
  }
}

/**
 * Update team FAAB budget for testing
 */
export async function updateTeamBudget(
  teamId: string,
  remainingBudget: number
): Promise<void> {
  const client = getAdminClient()

  const { error } = await client
    .from('teams')
    .update({ faab_budget: remainingBudget })
    .eq('id', teamId)

  if (error) {
    throw new Error(`Failed to update team budget: ${error.message}`)
  }
}

/**
 * Enable bidding for a league
 */
export async function enableLeagueBidding(
  leagueId: string,
  options?: {
    startDate?: string
    endDate?: string
  }
): Promise<void> {
  const client = getAdminClient()

  const startDate = options?.startDate || new Date().toISOString()
  const endDate = options?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  // First check if config exists
  const { data: existing } = await client
    .from('league_bidding_config')
    .select('league_id')
    .eq('league_id', leagueId)
    .single()

  if (existing) {
    const { error } = await client
      .from('league_bidding_config')
      .update({
        bidding_enabled: true,
        bidding_start_date: startDate,
        bidding_end_date: endDate,
      })
      .eq('league_id', leagueId)

    if (error) {
      throw new Error(`Failed to enable bidding: ${error.message}`)
    }
  } else {
    const { error } = await client.from('league_bidding_config').insert({
      league_id: leagueId,
      bidding_enabled: true,
      bidding_start_date: startDate,
      bidding_end_date: endDate,
    })

    if (error) {
      throw new Error(`Failed to enable bidding: ${error.message}`)
    }
  }
}

/**
 * Get team ID for a user in a league
 */
export async function getTeamId(
  leagueId: string,
  userId: string
): Promise<string> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('league_participants')
    .select('teams(id)')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .single()

  if (error || !data?.teams) {
    throw new Error(`Failed to get team ID: ${error?.message}`)
  }

  // Handle both array and single object responses
  const teams = data.teams as { id: string } | { id: string }[]
  return Array.isArray(teams) ? teams[0].id : teams.id
}
