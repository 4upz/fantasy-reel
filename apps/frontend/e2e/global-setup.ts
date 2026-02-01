import { test as setup } from '@playwright/test'
import { cleanupTestData, getAdminClient } from './helpers/supabase.helper'
import { MOCK_MOVIES } from './fixtures/test-data'

/**
 * Global Setup for E2E Tests
 *
 * Supabase Best Practices Applied:
 *
 * 1. CLEAN SLATE - Clean up stale test data from previous runs to prevent flakiness
 * 2. SEED DATA - Insert known test data (movies) that tests depend on
 * 3. SERVICE ROLE - Use service role key for setup (bypasses RLS)
 * 4. IDEMPOTENT - Setup can run multiple times without issues
 *
 * For CI environments, consider:
 * - Running `supabase db reset` before test suite
 * - Using separate test database
 * - Running tests with fresh migrations
 *
 * References:
 * - https://github.com/isaacharrisholt/supawright
 * - https://supabase.com/docs/guides/local-development/testing
 */

setup('global setup', async () => {
  console.log('🔧 Running E2E test setup...')

  // Verify Supabase connection
  await verifySupabaseConnection()

  // Clean up stale test data from previous runs
  console.log('  Cleaning up stale test data...')
  await cleanupTestData()

  // Seed mock movies to database
  console.log('  Seeding test movies...')
  await seedTestMovies()

  console.log('✅ E2E test setup complete')
})

/**
 * Verify Supabase is running and accessible
 */
async function verifySupabaseConnection(): Promise<void> {
  const client = getAdminClient()

  try {
    // Simple health check - query a table
    const { error } = await client.from('leagues').select('id').limit(1)

    if (error && !error.message.includes('0 rows')) {
      throw new Error(`Supabase connection failed: ${error.message}`)
    }
    console.log('  Supabase connection verified')
  } catch (err) {
    console.error('❌ Failed to connect to Supabase')
    console.error('   Make sure local Supabase is running: npx supabase start')
    throw err
  }
}

/**
 * Seed test movies to the database
 * These match our MOCK_MOVIES constant for consistency
 */
async function seedTestMovies(): Promise<void> {
  const client = getAdminClient()

  const movies = MOCK_MOVIES.map((m) => ({
    tmdb_id: m.tmdb_id,
    title: m.title,
    release_date: m.release_date,
    poster_url: m.poster_path,
    overview: m.overview,
    status: 'upcoming' as const,
  }))

  const { error } = await client
    .from('movies')
    .upsert(movies, { onConflict: 'tmdb_id', ignoreDuplicates: false })

  if (error) {
    console.warn(`  Warning: Failed to seed movies: ${error.message}`)
  } else {
    console.log(`  Seeded ${movies.length} test movies`)
  }
}
