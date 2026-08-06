import { MovieGrid } from 'fantasy-reel'

// Curated from the repo's own FALLBACK_MOVIES fixtures.
const movies = [
  {
    tmdb_id: 693134,
    title: 'Dune: Part Two',
    overview: 'Follow the mythic journey of Paul Atreides.',
    release_date: '2024-02-27',
    poster_url: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
    vote_average: 8.4,
    popularity: 1200,
    genre_ids: [878, 12],
  },
  {
    tmdb_id: 653346,
    title: 'Kingdom of the Planet of the Apes',
    overview: "Several generations following Caesar's reign.",
    release_date: '2024-05-08',
    poster_url: 'https://image.tmdb.org/t/p/w500/gKkl37BQuKTanygYQG1pyYgLVgf.jpg',
    vote_average: 7.1,
    popularity: 800,
    genre_ids: [878, 12, 28],
  },
  {
    tmdb_id: 748783,
    title: 'The Garfield Movie',
    overview: 'Garfield, the world-famous, Monday-hating cat.',
    release_date: '2024-05-01',
    poster_url: 'https://image.tmdb.org/t/p/w500/p6AbOJvMQhBmffd0PIv0u8ghWeY.jpg',
    vote_average: 6.5,
    popularity: 600,
    genre_ids: [16, 35, 10751],
  },
  {
    tmdb_id: 823464,
    title: 'Godzilla x Kong: The New Empire',
    overview: 'Two ancient titans clash.',
    release_date: '2024-03-27',
    poster_url: 'https://image.tmdb.org/t/p/w500/z1p34vh7dEOnLDmyCrlUVLuoDzd.jpg',
    vote_average: 7.2,
    popularity: 900,
    genre_ids: [878, 28],
  },
  {
    tmdb_id: 573435,
    title: 'Bad Boys: Ride or Die',
    overview: 'Miami’s finest are now on the run.',
    release_date: '2024-06-05',
    poster_url: 'https://image.tmdb.org/t/p/w500/nP6RliHjxsz4irTKsxe8FRhKZYl.jpg',
    vote_average: 7.0,
    popularity: 700,
    genre_ids: [28, 35],
  },
  {
    tmdb_id: 762441,
    title: 'A Quiet Place: Day One',
    overview: 'Experience the day the world went quiet.',
    release_date: '2024-06-26',
    poster_url: 'https://image.tmdb.org/t/p/w500/hU42CRk14JuPEdqZG3AWmagiPAP.jpg',
    vote_average: 6.9,
    popularity: 650,
    genre_ids: [27, 878],
  },
]

const noop = () => {}

/** The catalogue grid. Column count is responsive, 2 up to 6 across. */
export const Default = () => <MovieGrid movies={movies} onMovieClick={noop} />

export const ShortList = () => <MovieGrid movies={movies.slice(0, 3)} onMovieClick={noop} />

/** An empty result set renders an empty grid — pair it with your own
    empty-state copy. */
export const NoResults = () => (
  <div>
    <MovieGrid movies={[]} onMovieClick={noop} />
    <p className="text-sm text-foreground-muted">No movies matched those filters.</p>
  </div>
)
