import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { uniqueEmail, uniqueLeagueName } from './test-ids.helper'

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

/**
 * Verify that data exists in the database with retries.
 * Useful for ensuring data is queryable after inserts (race condition prevention).
 * @param maxRetries - Number of retry attempts (default: 5)
 * @param delayMs - Delay between retries in milliseconds (default: 100)
 */
export async function verifyDataExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
  table: string,
  id: string,
  maxRetries = 5,
  delayMs = 100
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await client
      .from(table)
      .select('id')
      .eq('id', id)
      .single()

    if (data && !error) {
      return // Data found, success
    }

    if (attempt < maxRetries) {
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new Error(
    `Data not found in table '${table}' with id '${id}' after ${maxRetries} retries`
  )
}

/**
 * Verify that a profile exists for a given user_id with retries.
 * Profiles table uses user_id column (not id) to match auth.users.
 * @param userId - The auth.users id (NOT the profile's auto-generated id)
 * @param maxRetries - Number of retry attempts (default: 15)
 * @param delayMs - Delay between retries in milliseconds (default: 200)
 */
async function verifyProfileExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
  userId: string,
  maxRetries = 15,
  delayMs = 200
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await client
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (data && !error) {
      return // Profile found, success
    }

    if (attempt < maxRetries) {
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new Error(
    `Profile not found for user '${userId}' after ${maxRetries} retries`
  )
}

/**
 * Wait for real-time subscriptions to be ready on a page.
 * Waits for DOM content to load fully. Callers should follow up
 * with specific element assertions rather than relying on networkidle
 * (which is unreliable with Supabase Realtime WebSockets).
 */
export async function waitForRealtimeReady(
  page: Page,
  timeout = 10000
): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout })
}

export interface TestUser {
  id: string
  email: string
  password: string
  displayName: string
}

/**
 * Create a test user with verified email (skips email confirmation)
 * Uses worker-scoped unique email to prevent parallel test collisions.
 */
export async function createTestUser(prefix: string): Promise<TestUser> {
  const client = getAdminClient()
  const email = uniqueEmail(prefix)
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

  // Profile is created automatically by database trigger on_auth_user_created
  // The trigger uses user_metadata.display_name which we set above
  // Verify profile exists before returning (handles race conditions)
  // Note: profiles table uses user_id column (not id) to match auth.users
  // Use more retries with longer delay for trigger-created data
  await verifyProfileExists(client, authData.user.id, 15, 200)

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
 * Uses worker-scoped unique name to prevent parallel test collisions.
 */
export async function createTestLeague(
  ownerId: string,
  options?: {
    name?: string
    status?: TestLeague['status']
    maxParticipants?: number
  }
): Promise<TestLeague> {
  const client = getAdminClient()
  const name = options?.name || uniqueLeagueName('E2E Test League')

  const { data, error } = await client
    .from('leagues')
    .insert({
      name,
      owner_id: ownerId,
      status: options?.status || 'setup',
      max_participants: options?.maxParticipants || 8,
      invite_only: true,
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create test league: ${error?.message}`)
  }

  // Verify league exists before continuing
  await verifyDataExists(client, 'leagues', data.id)

  // Add owner as participant
  const { data: participantData, error: participantError } = await client
    .from('league_participants')
    .insert({
      league_id: data.id,
      user_id: ownerId,
      role: 'owner',
      status: 'active',
    })
    .select()
    .single()

  if (participantError || !participantData) {
    throw new Error(`Failed to add owner as participant: ${participantError?.message}`)
  }

  // Verify participant exists before returning
  await verifyDataExists(client, 'league_participants', participantData.id)

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

  // Delete test leagues - match all E2E-prefixed names (including worker-scoped names)
  await client.from('leagues').delete().like('name', 'E2E %')

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
 * Uses worker-scoped unique token to prevent parallel test collisions.
 */
export async function createInvitation(
  leagueId: string,
  email: string,
  invitedBy: string
): Promise<{ id: string; token: string }> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('invitations')
    .insert({
      league_id: leagueId,
      email,
      invited_by: invitedBy,
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

  // Generate a random 6-char join code (matches Edge Function format and VARCHAR(8) column limit)
  const joinCode = generateRandomCode(6)

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
  pickNumber: number,
  round: number
): Promise<{ id: string }> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('draft_picks')
    .insert({
      league_id: leagueId,
      team_id: teamId,
      movie_id: movieId,
      pick_number: pickNumber,
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
  // Excludes ambiguous chars (I, L, O, 0, 1) to match JOIN_CODE_REGEX in JoinLeagueClient
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Create an expired invitation for testing
 * Uses worker-scoped unique token to prevent parallel test collisions.
 */
export async function createExpiredInvitation(
  leagueId: string,
  email: string,
  invitedBy: string
): Promise<{ id: string; token: string }> {
  const client = getAdminClient()

  // Set expires_at to yesterday
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  const { data, error } = await client
    .from('invitations')
    .insert({
      league_id: leagueId,
      email,
      invited_by: invitedBy,
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

  // Calculate next Saturday 8pm UTC as processing deadline (matches get_next_processing_deadline() DB function)
  const now = new Date()
  const daysUntilSaturday = (6 - now.getUTCDay() + 7) % 7 || 7
  const nextSaturday = new Date(now)
  nextSaturday.setUTCDate(now.getUTCDate() + daysUntilSaturday)
  nextSaturday.setUTCHours(20, 0, 0, 0)

  const { data, error } = await client
    .from('pickup_bids')
    .insert({
      league_id: leagueId,
      team_id: teamId,
      tmdb_id: tmdbId,
      amount,
      status: options?.status || 'active',
      processing_deadline: nextSaturday.toISOString(),
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
 * Trade items structure for creating trade offers
 */
interface TradeItems {
  movies: Array<{ movie_id: string; source: 'draft_pick' | 'pickup'; source_id?: string }>
  faab: number
}

/**
 * Create a trade offer for testing
 * Status values: proposed, countered, accepted, review, completed, rejected, cancelled, vetoed, expired
 *
 * Note: The trade_offers table requires at least one item (movie or FAAB) from either party
 */
export async function createTradeOffer(
  leagueId: string,
  initiatorTeamId: string,
  recipientTeamId: string,
  initiatorItems: TradeItems,
  recipientItems: TradeItems,
  options?: {
    status?: 'proposed' | 'countered' | 'accepted' | 'review' | 'completed' | 'rejected' | 'cancelled' | 'vetoed' | 'expired'
  }
): Promise<{ id: string }> {
  const client = getAdminClient()

  const { data, error } = await client
    .from('trade_offers')
    .insert({
      league_id: leagueId,
      initiator_team_id: initiatorTeamId,
      recipient_team_id: recipientTeamId,
      initiator_items: initiatorItems,
      recipient_items: recipientItems,
      status: options?.status || 'proposed',
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create trade offer: ${error?.message}`)
  }

  return { id: data.id }
}

/**
 * Create a team_budgets row for a team.
 * Required for bidding tests - the place-bid edge function requires this row.
 */
export async function createTeamBudget(
  teamId: string,
  remainingBudget = 100
): Promise<void> {
  const client = getAdminClient()

  const { error } = await client
    .from('team_budgets')
    .upsert(
      {
        team_id: teamId,
        remaining_budget: remainingBudget,
        total_spent: 0,
      },
      { onConflict: 'team_id' }
    )

  if (error) {
    throw new Error(`Failed to create team budget: ${error.message}`)
  }
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
        last_calculated_at: new Date().toISOString(),
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
    // Use upsert to handle parallel test runs where reviews may already exist
    const { error } = await client
      .from('reviews')
      .upsert(reviews, { onConflict: 'movie_id,source' })
    if (error) {
      throw new Error(`Failed to create movie reviews: ${error.message}`)
    }
  }
}


/**
 * Enable bidding for a league
 * Bidding is available in active leagues - this function sets the league status to 'active'
 */
export async function enableLeagueBidding(leagueId: string): Promise<void> {
  const client = getAdminClient()
  const { error } = await client
    .from('leagues')
    .update({ status: 'active' })
    .eq('id', leagueId)
  if (error) throw new Error(`Failed to enable bidding: ${error.message}`)
}

/**
 * Set draft_order on a league participant
 */
export async function setDraftOrder(
  leagueId: string,
  userId: string,
  draftOrder: number
): Promise<void> {
  const client = getAdminClient()

  const { error } = await client
    .from('league_participants')
    .update({ draft_order: draftOrder })
    .eq('league_id', leagueId)
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to set draft order: ${error.message}`)
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
