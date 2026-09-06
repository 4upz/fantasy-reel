import { test as setup } from '@playwright/test'
import { getAdminClient } from './helpers/supabase.helper'
import { MOCK_MOVIES } from './fixtures/test-data'
import { movieRunMarker } from './helpers/test-ids.helper'

setup('global setup', async ({ baseURL }) => {
  console.log('🔧 Running E2E test setup...')

  // Verify Supabase connection
  await verifySupabaseConnection()

  // Seed mock movies to database
  console.log('  Seeding test movies...')
  await seedTestMovies()

  // Pre-compile the hottest routes so the first tests don't pay the dev
  // server's on-demand compile cost. Only relevant locally: CI serves a
  // production build, which has nothing to compile.
  if (!process.env.CI) {
    console.log('  Warming up dev server routes...')
    await warmUpRoutes(baseURL ?? 'http://localhost:3100')
  }

  console.log('✅ E2E test setup complete')
})

/**
 * Hit the most-used routes once so Next.js dev compiles them before tests run.
 * Failures are non-fatal: tests will just pay the compile cost themselves.
 */
async function warmUpRoutes(baseURL: string): Promise<void> {
  const routes = ['/login', '/signup', '/dashboard', '/settings']

  await Promise.all(
    routes.map(async (route) => {
      try {
        await fetch(`${baseURL}${route}`, { redirect: 'manual' })
      } catch {
        console.warn(`  Warning: warm-up request to ${route} failed`)
      }
    })
  )
}

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
    poster_url: m.poster_url,
    overview: `${movieRunMarker()}${m.overview}`,
    status: m.status,
  }))

  const { error } = await client
    .from('movies')
    .insert(movies)

  if (error) {
    throw new Error(`Failed to seed movies: ${error.message}`)
  } else {
    console.log(`  Seeded ${movies.length} test movies`)
  }
}
