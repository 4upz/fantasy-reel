/**
 * Shared test data constants for E2E tests
 * These match the mock responses from TMDb/MDBList APIs
 */

/**
 * Returns a YYYY-MM-DD date string `days` from today (UTC).
 * Release dates must always be computed relative to now: the draft-pick and
 * place-bid Edge Functions reject movies whose release_date is in the past
 * (isUpcomingMovie), so hardcoded dates silently expire and break tests.
 */
export function daysFromNow(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().split('T')[0]
}

/**
 * Mock movie data matching TMDbSearchResult interface
 * Used by mock-api.helper.ts to mock Edge Function responses
 */
export const MOCK_MOVIES = [
  {
    id: 12345, // kept for backward compatibility with some tests
    tmdb_id: 12345,
    title: 'Test Movie Alpha',
    release_date: daysFromNow(30),
    poster_path: '/test-poster-alpha.jpg',
    poster_url: 'https://image.tmdb.org/t/p/w500/test-poster-alpha.jpg',
    overview: 'A test movie for E2E testing - action thriller',
    vote_average: 7.5,
    popularity: 85.5,
    genre_ids: [28, 53], // Action, Thriller
    status: 'upcoming' as const,
  },
  {
    id: 12346,
    tmdb_id: 12346,
    title: 'Test Movie Beta',
    release_date: daysFromNow(60),
    poster_path: '/test-poster-beta.jpg',
    poster_url: 'https://image.tmdb.org/t/p/w500/test-poster-beta.jpg',
    overview: 'Another test movie - drama',
    vote_average: 8.2,
    popularity: 72.3,
    genre_ids: [18], // Drama
    status: 'upcoming' as const,
  },
  {
    id: 12347,
    tmdb_id: 12347,
    title: 'Test Movie Gamma',
    release_date: daysFromNow(90),
    poster_path: '/test-poster-gamma.jpg',
    poster_url: 'https://image.tmdb.org/t/p/w500/test-poster-gamma.jpg',
    overview: 'Third test movie - comedy',
    vote_average: 6.8,
    popularity: 63.1,
    genre_ids: [35], // Comedy
    status: 'upcoming' as const,
  },
  {
    id: 12348,
    tmdb_id: 12348,
    title: 'Test Movie Delta',
    release_date: daysFromNow(120),
    poster_path: '/test-poster-delta.jpg',
    poster_url: 'https://image.tmdb.org/t/p/w500/test-poster-delta.jpg',
    overview: 'Fourth test movie - sci-fi',
    vote_average: 9.1,
    popularity: 91.7,
    genre_ids: [878], // Science Fiction
    status: 'upcoming' as const,
  },
  {
    id: 12349,
    tmdb_id: 12349,
    title: 'Test Movie Epsilon',
    release_date: daysFromNow(180),
    poster_path: '/test-poster-epsilon.jpg',
    poster_url: 'https://image.tmdb.org/t/p/w500/test-poster-epsilon.jpg',
    overview: 'Fifth test movie - horror',
    vote_average: 5.5,
    popularity: 45.2,
    genre_ids: [27], // Horror
    status: 'upcoming' as const,
  },
] as const

export const TEST_USERS = {
  primary: {
    emailPrefix: 'test-primary',
    displayName: 'Test User Primary',
    password: 'TestPassword123!',
  },
  secondary: {
    emailPrefix: 'test-secondary',
    displayName: 'Test User Secondary',
    password: 'TestPassword123!',
  },
  owner: {
    emailPrefix: 'test-owner',
    displayName: 'League Owner',
    password: 'TestPassword123!',
  },
} as const

export const TEST_LEAGUE_DEFAULTS = {
  name: 'E2E Test League',
  maxParticipants: 8,
  draftType: 'snake' as const,
  draftRounds: 5,
  slotsPerRound: 1,
}

/**
 * Generate a unique test email with timestamp
 */
export function generateTestEmail(prefix: string): string {
  return `${prefix}-${Date.now()}@test.local`
}

/**
 * Generate a unique league name with timestamp
 */
export function generateLeagueName(prefix = 'E2E Test League'): string {
  return `${prefix} ${Date.now()}`
}
