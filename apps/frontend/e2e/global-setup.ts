import { test as setup } from '@playwright/test'
import { cleanupTestData, getAdminClient } from './helpers/supabase.helper'
import { MOCK_MOVIES } from './fixtures/test-data'

/**
 * Global setup runs before all tests
 * - Cleans up stale test data from previous runs
 * - Seeds required base data (mock movies)
 */
setup('global setup', async () => {
  console.log('🔧 Running E2E test setup...')

  // Clean up any stale test data from previous runs
  console.log('  Cleaning up stale test data...')
  await cleanupTestData()

  // Seed mock movies to database (if not using TMDb mock routes)
  console.log('  Seeding test movies...')
  await seedTestMovies()

  console.log('✅ E2E test setup complete')
})

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
  }
}
