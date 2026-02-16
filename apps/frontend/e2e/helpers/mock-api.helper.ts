import { Page, Route } from '@playwright/test'
import { MOCK_MOVIES } from '../fixtures/test-data'

/**
 * Genre ID to name mapping (matches TMDb genre IDs)
 */
const GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}

/**
 * Read a parameter from the request - checks POST body first, then URL query params.
 * Edge Functions are invoked via POST with JSON body by callEdgeFunction().
 */
function getRequestParam(route: Route, key: string): string {
  try {
    const body = route.request().postDataJSON()
    if (body && key in body) return String(body[key])
  } catch {
    // Not JSON or no body - fall through to URL params
  }
  const url = new URL(route.request().url())
  return url.searchParams.get(key) || ''
}

/**
 * Mock TMDb API responses via Edge Function interception
 * Only mocks external API calls - Supabase operations run against real local instance
 */
export async function mockTMDbAPI(page: Page): Promise<void> {
  // Mock browse-movies Edge Function (which calls TMDb discover)
  await page.route('**/functions/v1/browse-movies**', async (route) => {
    const pageNum = parseInt(getRequestParam(route, 'page') || '1')

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
    const query = getRequestParam(route, 'query').toLowerCase()

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

  // Mock get-movie-details Edge Function (returns TMDbMovieDetails structure)
  await page.route('**/functions/v1/get-movie-details**', async (route) => {
    const tmdbId = parseInt(getRequestParam(route, 'tmdb_id') || '0')
    const movie = MOCK_MOVIES.find((m) => m.tmdb_id === tmdbId)

    if (!movie) {
      await route.fulfill({ status: 404, body: 'Movie not found' })
      return
    }

    const genres = movie.genre_ids.map((id) => ({
      id,
      name: GENRE_MAP[id] || 'Unknown',
    }))

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tmdb_id: movie.tmdb_id,
        imdb_id: null,
        title: movie.title,
        tagline: null,
        overview: movie.overview,
        release_date: movie.release_date,
        runtime: 120,
        status: movie.status === 'upcoming' ? 'Post Production' : 'Released',
        poster_url: movie.poster_url,
        backdrop_url: null,
        vote_average: movie.vote_average,
        vote_count: 0,
        genres,
        cast: [],
        director: null,
      }),
    })
  })
}

/**
 * Mock score update API responses (MDBList via update-scores Edge Function)
 */
export async function mockScoreUpdates(page: Page): Promise<void> {
  await page.route('**/functions/v1/update-scores**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ movies_fetched: 5, scores_updated: 5, errors: [] }),
    })
  })
}

/**
 * Setup all external API mocks for a test page
 */
export async function setupAllMocks(page: Page): Promise<void> {
  await mockTMDbAPI(page)
  await mockScoreUpdates(page)
}

export { MOCK_MOVIES }
