import { Page } from '@playwright/test'
import { MOCK_MOVIES } from '../fixtures/test-data'

/**
 * Mock TMDb API responses via Edge Function interception
 * Only mocks external API calls - Supabase operations run against real local instance
 */
export async function mockTMDbAPI(page: Page): Promise<void> {
  // Mock browse-movies Edge Function (which calls TMDb discover)
  await page.route('**/functions/v1/browse-movies**', async (route) => {
    const url = new URL(route.request().url())
    const pageNum = parseInt(url.searchParams.get('page') || '1')

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: MOCK_MOVIES,
        page: pageNum,
        total_pages: 1,
        total_results: MOCK_MOVIES.length,
      }),
    })
  })

  // Mock search-movies Edge Function (which calls TMDb search)
  await page.route('**/functions/v1/search-movies**', async (route) => {
    const url = new URL(route.request().url())
    const query = url.searchParams.get('query')?.toLowerCase() || ''

    const filtered = MOCK_MOVIES.filter((m) =>
      m.title.toLowerCase().includes(query)
    )

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: filtered,
        page: 1,
        total_pages: 1,
        total_results: filtered.length,
      }),
    })
  })

  // Mock get-movie-details Edge Function
  await page.route('**/functions/v1/get-movie-details**', async (route) => {
    const url = new URL(route.request().url())
    const tmdbId = parseInt(url.searchParams.get('tmdb_id') || '0')
    const movie = MOCK_MOVIES.find((m) => m.tmdb_id === tmdbId)

    if (movie) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...movie,
          runtime: 120,
          genres: [{ id: 28, name: 'Action' }],
          credits: { cast: [], crew: [] },
        }),
      })
    } else {
      await route.fulfill({ status: 404, body: 'Movie not found' })
    }
  })
}

/**
 * Mock OMDb API responses for score updates
 */
export async function mockOMDbAPI(page: Page): Promise<void> {
  await page.route('**/functions/v1/update-scores**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updated: 5, errors: 0 }),
    })
  })

  await page.route('**/functions/v1/process-movie-scores**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ processed: 5, errors: 0 }),
    })
  })
}

/**
 * Setup all external API mocks for a test page
 */
export async function setupAllMocks(page: Page): Promise<void> {
  await mockTMDbAPI(page)
  await mockOMDbAPI(page)
}

export { MOCK_MOVIES }
