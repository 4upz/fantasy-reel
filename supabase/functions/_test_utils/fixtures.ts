/**
 * Test fixtures for Edge Functions unit tests
 */

// Mock user data - UUIDs must be valid format: 8-4-4-4-12 hex chars
export const mockUser = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  email: 'test@example.com',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2024-01-01T00:00:00.000Z',
}

export const mockUser2 = {
  id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
  email: 'other@example.com',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2024-01-02T00:00:00.000Z',
}

// Mock league data
export const mockLeague = {
  id: 'c3d4e5f6-a7b8-9012-cdef-345678901234',
  name: 'Test League',
  owner_id: mockUser.id,
  status: 'setup',
  invite_only: false,
  max_participants: 8,
  draft_start_date: null,
  draft_end_date: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
}

export const mockLeagueDrafting = {
  ...mockLeague,
  id: 'd4e5f6a7-b8c9-0123-def4-567890123456',
  owner_id: mockUser.id,
  status: 'drafting',
}

export const mockLeagueInviteOnly = {
  ...mockLeague,
  id: 'e5f6a7b8-c9d0-1234-ef56-789012345678',
  invite_only: true,
}

// Mock participant data
export const mockParticipant = {
  id: 'f6a7b8c9-d0e1-2345-f678-901234567890',
  league_id: mockLeague.id,
  user_id: mockUser.id,
  role: 'owner',
  status: 'active',
  draft_order: 1,
  created_at: '2024-01-01T00:00:00.000Z',
}

export const mockParticipant2 = {
  id: 'a7b8c9d0-e1f2-3456-7890-123456789abc',
  league_id: mockLeague.id,
  user_id: mockUser2.id,
  role: 'member',
  status: 'active',
  draft_order: 2,
  created_at: '2024-01-02T00:00:00.000Z',
}

// Mock team data
export const mockTeam = {
  id: 'b8c9d0e1-f2a3-4567-8901-23456789abcd',
  participant_id: mockParticipant.id,
  name: "Test's Production Company",
  avatar_url: null,
  created_at: '2024-01-01T00:00:00.000Z',
}

export const mockTeam2 = {
  id: 'c9d0e1f2-a3b4-5678-9012-3456789abcde',
  participant_id: mockParticipant2.id,
  name: "Other's Production Company",
  avatar_url: null,
  created_at: '2024-01-02T00:00:00.000Z',
}

// Mock invitation data
export const mockInvitation = {
  id: 'd0e1f2a3-b4c5-6789-0123-456789abcdef',
  league_id: mockLeague.id,
  invited_by: mockUser.id,
  email: 'invitee@example.com',
  token: 'e1f2a3b4-c5d6-7890-1234-56789abcdef0',
  status: 'pending',
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: '2024-01-01T00:00:00.000Z',
}

export const mockInvitationExpired = {
  ...mockInvitation,
  id: 'f2a3b4c5-d6e7-8901-2345-6789abcdef01',
  token: 'a3b4c5d6-e7f8-9012-3456-789abcdef012',
  expires_at: new Date(Date.now() - 1000).toISOString(),
}

// Invitation with status explicitly set to 'expired' (for resend tests)
export const mockInvitationStatusExpired = {
  ...mockInvitation,
  id: 'a4b5c6d7-e8f9-0123-4567-89abcdef0124',
  token: 'b5c6d7e8-f9a0-1234-5678-9abcdef01245',
  status: 'expired',
}

export const mockInvitationAccepted = {
  ...mockInvitation,
  id: 'b4c5d6e7-f8a9-0123-4567-89abcdef0123',
  token: 'c5d6e7f8-a9b0-1234-5678-9abcdef01234',
  status: 'accepted',
}

export const mockInvitationCancelled = {
  ...mockInvitation,
  id: 'c5d6e7f8-a9b0-1234-5678-9abcdef01235',
  token: 'd6e7f8a9-b0c1-2345-6789-abcdef012346',
  status: 'cancelled',
}

export const mockInvitationDeclined = {
  ...mockInvitation,
  id: 'd6e7f8a9-b0c1-2345-6789-abcdef012347',
  token: 'e7f8a9b0-c1d2-3456-789a-bcdef0123458',
  status: 'declined',
}

// Mock movie data
export const mockMovie = {
  id: 'd6e7f8a9-b0c1-2345-6789-abcdef012345',
  tmdb_id: 12345,
  imdb_id: 'tt1234567',
  title: 'Test Movie',
  overview: 'A test movie for unit testing.',
  release_date: '2024-12-15',
  poster_url: 'https://image.tmdb.org/t/p/w500/test.jpg',
  backdrop_url: 'https://image.tmdb.org/t/p/original/test_backdrop.jpg',
  popularity: 100.5,
  vote_average: 7.5,
  vote_count: 1000,
  status: 'upcoming',
  last_synced_at: '2024-01-01T00:00:00.000Z',
}

export const mockMovieReleased = {
  ...mockMovie,
  id: 'e7f8a9b0-c1d2-3456-789a-bcdef0123456',
  status: 'released',
  release_date: '2024-01-01',
}

export const mockMovieNoImdb = {
  ...mockMovie,
  id: 'f8a9b0c1-d2e3-4567-89ab-cdef01234567',
  imdb_id: null,
}

// Mock draft pick data
export const mockDraftPick = {
  id: 'a9b0c1d2-e3f4-5678-9abc-def012345678',
  league_id: mockLeague.id,
  team_id: mockTeam.id,
  movie_id: mockMovie.id,
  round: 1,
  pick_number: 1,
  picked_at: '2024-01-01T00:00:00.000Z',
}

// Mock next pick info (from RPC)
export const mockNextPickInfo = {
  round: 1,
  pick_number: 1,
  team_id: mockTeam.id,
  participant_id: mockParticipant.id,
  user_id: mockUser.id,
}

// Mock review data
export const mockReview = {
  id: 'b0c1d2e3-f4a5-6789-abcd-ef0123456789',
  movie_id: mockMovie.id,
  source: 'imdb',
  score: 85,
  raw_score: '8.5/10',
  fetched_at: '2024-01-01T00:00:00.000Z',
}

// Mock TMDb API response
export const mockTMDbDiscoverResponse = {
  page: 1,
  results: [
    {
      id: 12345,
      title: 'Upcoming Movie 1',
      overview: 'An exciting upcoming movie.',
      release_date: '2024-06-15',
      poster_path: '/poster1.jpg',
      backdrop_path: '/backdrop1.jpg',
      popularity: 150.5,
      vote_average: 0,
      vote_count: 0,
    },
    {
      id: 67890,
      title: 'Upcoming Movie 2',
      overview: 'Another exciting movie.',
      release_date: '2024-07-20',
      poster_path: '/poster2.jpg',
      backdrop_path: '/backdrop2.jpg',
      popularity: 120.3,
      vote_average: 0,
      vote_count: 0,
    },
  ],
  total_pages: 5,
  total_results: 100,
}

// Mock TMDb Search API response
export const mockTMDbSearchResponse = {
  page: 1,
  results: [
    {
      id: 550,
      title: 'Fight Club',
      overview: 'A depressed man suffering from insomnia meets a strange soap salesman.',
      release_date: '1999-10-15',
      poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
      vote_average: 8.4,
      vote_count: 25000,
      popularity: 45.5,
      genre_ids: [18, 53, 35],
    },
    {
      id: 551,
      title: 'Fight Club 2',
      overview: 'A fictional sequel.',
      release_date: '2024-12-15',
      poster_path: null,
      vote_average: 0,
      vote_count: 0,
      popularity: 10.2,
      genre_ids: [18],
    },
  ],
  total_pages: 1,
  total_results: 2,
}

// Mock TMDb Movie Details response
export const mockTMDbMovieDetailsResponse = {
  id: 550,
  imdb_id: 'tt0137523',
  title: 'Fight Club',
  tagline: 'Mischief. Mayhem. Soap.',
  overview: 'A depressed man suffering from insomnia meets a strange soap salesman.',
  release_date: '1999-10-15',
  runtime: 139,
  status: 'Released',
  poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
  backdrop_path: '/hZkgoQYus5vegHoetLkCJzb17zJ.jpg',
  vote_average: 8.4,
  vote_count: 25000,
  budget: 63000000,
  revenue: 100853753,
  genres: [
    { id: 18, name: 'Drama' },
    { id: 53, name: 'Thriller' },
  ],
  production_companies: [
    { id: 508, name: 'Regency Enterprises' },
  ],
}

// Mock TMDb Credits response
export const mockTMDbCreditsResponse = {
  id: 550,
  cast: [
    {
      id: 819,
      name: 'Edward Norton',
      character: 'The Narrator',
      profile_path: '/5XBzD5WuTyVQZeS4II6gs1nn5P6.jpg',
      order: 0,
    },
    {
      id: 287,
      name: 'Brad Pitt',
      character: 'Tyler Durden',
      profile_path: '/cckcYc2v0yh1tc9QjRelptcOBko.jpg',
      order: 1,
    },
    {
      id: 1283,
      name: 'Helena Bonham Carter',
      character: 'Marla Singer',
      profile_path: '/DDeITcCpnBd0CkAIRPhggy9bt5.jpg',
      order: 2,
    },
  ],
  crew: [
    {
      id: 7467,
      name: 'David Fincher',
      job: 'Director',
      department: 'Directing',
    },
  ],
}

// Mock OMDb API response
export const mockOMDbResponse = {
  Response: 'True',
  imdbID: 'tt1234567',
  Title: 'Test Movie',
  Ratings: [
    { Source: 'Internet Movie Database', Value: '8.5/10' },
    { Source: 'Rotten Tomatoes', Value: '85%' },
    { Source: 'Metacritic', Value: '78/100' },
  ],
}

export const mockOMDbErrorResponse = {
  Response: 'False',
  Error: 'Movie not found!',
}

// Valid UUIDs for testing
export const validUUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
export const invalidUUIDs = [
  '',
  'not-a-uuid',
  '12345',
  'a0eebc99-9c0b-4ef8-bb6d', // incomplete
  'g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // invalid char
]

// Valid emails for testing
export const validEmails = [
  'test@example.com',
  'user.name@domain.co.uk',
  'user+tag@example.org',
]

export const invalidEmails = [
  '',
  'not-an-email',
  '@example.com',
  'user@',
  'user@.com',
]
