/**
 * Shared test data constants for E2E tests
 * These match the mock responses from TMDb/OMDb APIs
 */

export const MOCK_MOVIES = [
  {
    id: 12345,
    tmdb_id: 12345,
    title: 'Test Movie Alpha',
    release_date: '2025-06-15',
    poster_path: '/test-poster-alpha.jpg',
    overview: 'A test movie for E2E testing - action thriller',
    vote_average: 7.5,
  },
  {
    id: 12346,
    tmdb_id: 12346,
    title: 'Test Movie Beta',
    release_date: '2025-07-20',
    poster_path: '/test-poster-beta.jpg',
    overview: 'Another test movie - drama',
    vote_average: 8.2,
  },
  {
    id: 12347,
    tmdb_id: 12347,
    title: 'Test Movie Gamma',
    release_date: '2025-08-10',
    poster_path: '/test-poster-gamma.jpg',
    overview: 'Third test movie - comedy',
    vote_average: 6.8,
  },
  {
    id: 12348,
    tmdb_id: 12348,
    title: 'Test Movie Delta',
    release_date: '2025-09-05',
    poster_path: '/test-poster-delta.jpg',
    overview: 'Fourth test movie - sci-fi',
    vote_average: 9.1,
  },
  {
    id: 12349,
    tmdb_id: 12349,
    title: 'Test Movie Epsilon',
    release_date: '2025-10-15',
    poster_path: '/test-poster-epsilon.jpg',
    overview: 'Fifth test movie - horror',
    vote_average: 5.5,
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
