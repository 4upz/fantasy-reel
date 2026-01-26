import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database'

/**
 * Supabase helper for E2E test database operations
 * Uses service role key for admin operations (user creation, cleanup)
 */

// These should match your local Supabase instance
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Admin client for test setup/teardown
let adminClient: SupabaseClient<Database> | null = null

export function getAdminClient(): SupabaseClient<Database> {
  if (!adminClient) {
    if (!SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for E2E tests')
    }
    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return adminClient
}

// Anon client for simulating unauthenticated requests
export function getAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
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
