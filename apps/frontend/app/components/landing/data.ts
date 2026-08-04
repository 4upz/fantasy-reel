import type { TMDbSearchResult } from '@/types'

// ============================================================================
// Fictional Users - tongue-in-cheek personalities
// ============================================================================

export interface FictionalUser {
  handle: string
  style: 'arthouse' | 'horror' | 'questionable' | 'prestige' | 'mainstream' | 'underdog'
}

export const FICTIONAL_USERS: FictionalUser[] = [
  { handle: '@AlwaysPicksA24', style: 'arthouse' },
  { handle: '@HorrorSleeper', style: 'horror' },
  { handle: '@NobodyAskedMe', style: 'questionable' },
  { handle: '@OscarBaitOnly', style: 'prestige' },
  { handle: '@BlockbusterBro', style: 'mainstream' },
  { handle: '@SleepersOnly', style: 'underdog' },
  { handle: '@CinemaAunt', style: 'prestige' },
  { handle: '@FilmBro420', style: 'arthouse' },
  { handle: '@ScreamQueen', style: 'horror' },
  { handle: '@PopcornPurist', style: 'mainstream' },
]

// ============================================================================
// Snarky Comments - dry film critic wit
// ============================================================================

export const SNARKY_COMMENTS: Record<string, string[]> = {
  good: [
    'stealing',
    'bold, respect it',
    'the right call',
    'sleeper alert',
    'finally',
    'elite taste',
    'called it',
  ],
  mid: [
    'interesting choice',
    "we'll see",
    'brave',
    'a choice was made',
    'okay then',
    'sure, why not',
  ],
  questionable: [
    'oh no',
    'bold strategy',
    'yikes',
    'good luck with that',
    'prayers up',
    'thoughts and prayers',
  ],
  arthouse: [
    'peak cinema',
    'obviously',
    'taste',
    'the only correct pick',
    "chef's kiss",
  ],
  horror: [
    'genre excellence',
    'elevated horror?',
    'the genre stays winning',
    'scream-worthy',
  ],
  mainstream: [
    'crowd pleaser',
    'safe but solid',
    "the people's choice",
    'mass appeal locked',
  ],
  prestige: [
    'awards bait',
    'Oscar season incoming',
    'the Academy will love this',
    'prestige mode activated',
  ],
  underdog: [
    'sleeper of the year',
    'nobody saw this coming',
    'dark horse alert',
    'hidden gem status',
  ],
}

// ============================================================================
// Scoring Examples - hardcoded for reliability (no API dependency)
// ============================================================================

export interface ScoringExample {
  title: string
  posterUrl: string
  /** The Tomatometer - the only critic score that affects fantasy points. */
  tomatometer: number
  draftPrice: number
  fantasyPoints: number
  quote: string
  quoter: string
  isWinner: boolean
}

// Using well-known movies as examples - these posters are from TMDb
export const SCORING_EXAMPLES: ScoringExample[] = [
  {
    title: 'Dune: Part Two',
    posterUrl: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
    tomatometer: 92,
    draftPrice: 8,
    fantasyPoints: 34,
    quote: 'Called it.',
    quoter: '@SleepersOnly',
    isWinner: true,
  },
  {
    title: 'Madame Web',
    posterUrl: 'https://image.tmdb.org/t/p/w500/rULWuutDcN5NvtiZi4FRPzRYWSh.jpg',
    tomatometer: 12,
    draftPrice: 15,
    fantasyPoints: -19,
    quote: "We don't talk about this one.",
    quoter: '@NobodyAskedMe',
    isWinner: false,
  },
]

// ============================================================================
// Generate ticker entries from real movies
// ============================================================================

export interface TickerEntry {
  user: FictionalUser
  movie: {
    title: string
    posterUrl: string | null
  }
  action: 'drafted' | 'snagged' | 'picked' | 'grabbed'
  comment: string
}

function getRandomComment(style: FictionalUser['style'], moviePopularity: number): string {
  // High popularity = mainstream, low = indie/sleeper
  if (moviePopularity > 50) {
    const pool = [...SNARKY_COMMENTS.mainstream, ...SNARKY_COMMENTS.good]
    return pool[Math.floor(Math.random() * pool.length)]
  } else if (moviePopularity > 20) {
    const pool = [...SNARKY_COMMENTS.mid, ...SNARKY_COMMENTS.good]
    return pool[Math.floor(Math.random() * pool.length)]
  } else {
    // Style-specific for less popular movies
    const styleComments = SNARKY_COMMENTS[style] || SNARKY_COMMENTS.good
    const pool = [...styleComments, ...SNARKY_COMMENTS.good]
    return pool[Math.floor(Math.random() * pool.length)]
  }
}

const ACTIONS: TickerEntry['action'][] = ['drafted', 'snagged', 'picked', 'grabbed']

export function generateTickerEntries(movies: TMDbSearchResult[]): TickerEntry[] {
  const entries: TickerEntry[] = []
  const shuffledUsers = [...FICTIONAL_USERS].sort(() => Math.random() - 0.5)

  movies.forEach((movie, index) => {
    const user = shuffledUsers[index % shuffledUsers.length]
    entries.push({
      user,
      movie: {
        title: movie.title,
        posterUrl: movie.poster_url,
      },
      action: ACTIONS[Math.floor(Math.random() * ACTIONS.length)],
      comment: getRandomComment(user.style, movie.popularity),
    })
  })

  return entries
}

// ============================================================================
// Fallback data when API is unavailable
// ============================================================================

export const FALLBACK_MOVIES: TMDbSearchResult[] = [
  {
    tmdb_id: 693134,
    title: 'Dune: Part Two',
    overview: 'Follow the mythic journey of Paul Atreides...',
    release_date: '2024-02-27',
    poster_url: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
    vote_average: 8.4,
    popularity: 1200,
    genre_ids: [878, 12],
  },
  {
    tmdb_id: 653346,
    title: 'Kingdom of the Planet of the Apes',
    overview: 'Several generations following Caesar\'s reign...',
    release_date: '2024-05-08',
    poster_url: 'https://image.tmdb.org/t/p/w500/gKkl37BQuKTanygYQG1pyYgLVgf.jpg',
    vote_average: 7.1,
    popularity: 800,
    genre_ids: [878, 12, 28],
  },
  {
    tmdb_id: 748783,
    title: 'The Garfield Movie',
    overview: 'Garfield, the world-famous, Monday-hating...',
    release_date: '2024-05-01',
    poster_url: 'https://image.tmdb.org/t/p/w500/p6AbOJvMQhBmffd0PIv0u8ghWeY.jpg',
    vote_average: 6.5,
    popularity: 600,
    genre_ids: [16, 35, 10751],
  },
  {
    tmdb_id: 940721,
    title: 'Godzilla x Kong: The New Empire',
    overview: 'Following their explosive showdown...',
    release_date: '2024-03-27',
    poster_url: 'https://image.tmdb.org/t/p/w500/z1p34vh7dEOnLDmyCrlUVLuoDzd.jpg',
    vote_average: 7.0,
    popularity: 950,
    genre_ids: [28, 878, 12],
  },
  {
    tmdb_id: 573435,
    title: 'Bad Boys: Ride or Die',
    overview: 'After their late former Captain is framed...',
    release_date: '2024-06-05',
    poster_url: 'https://image.tmdb.org/t/p/w500/nP6RliHjxsz4irTKsxe8FRhKZYl.jpg',
    vote_average: 7.2,
    popularity: 700,
    genre_ids: [28, 35, 80],
  },
  {
    tmdb_id: 762441,
    title: 'A Quiet Place: Day One',
    overview: 'Experience the day the world went quiet...',
    release_date: '2024-06-26',
    poster_url: 'https://image.tmdb.org/t/p/w500/hU42CRk14JuPEdqZG3AWmagiPAP.jpg',
    vote_average: 7.4,
    popularity: 550,
    genre_ids: [27, 878, 53],
  },
  {
    tmdb_id: 718821,
    title: 'Twisters',
    overview: 'As storm season intensifies...',
    release_date: '2024-07-17',
    poster_url: 'https://image.tmdb.org/t/p/w500/pjnD08FlMAIXsfOLKQbvmO0f0MD.jpg',
    vote_average: 7.0,
    popularity: 480,
    genre_ids: [28, 12, 53],
  },
  {
    tmdb_id: 1011985,
    title: 'Kung Fu Panda 4',
    overview: 'Po must train a new warrior...',
    release_date: '2024-03-02',
    poster_url: 'https://image.tmdb.org/t/p/w500/kDp1vUBnMpe8ak4rjgl3cLELqjU.jpg',
    vote_average: 7.1,
    popularity: 650,
    genre_ids: [16, 28, 35, 10751],
  },
]
