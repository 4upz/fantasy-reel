import { MovieDetailModal } from 'fantasy-reel'

const dune = {
  tmdb_id: 693134,
  title: 'Dune: Part Two',
  overview:
    'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
  release_date: '2024-02-27',
  poster_url: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
  vote_average: 8.4,
  popularity: 1200,
  genre_ids: [878, 12],
}

const details = {
  tmdb_id: 693134,
  imdb_id: 'tt15239678',
  title: 'Dune: Part Two',
  tagline: 'Long live the fighters.',
  overview:
    'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the known universe, he endeavors to prevent a terrible future only he can foresee.',
  release_date: '2024-02-27',
  runtime: 167,
  status: 'Released',
  poster_url: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
  backdrop_url: 'https://image.tmdb.org/t/p/w780/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg',
  vote_average: 8.4,
  vote_count: 4821,
  genres: [
    { id: 878, name: 'Science Fiction' },
    { id: 12, name: 'Adventure' },
  ],
  cast: [
    { id: 1, name: 'Timothée Chalamet', character: 'Paul Atreides', profile_url: null },
    { id: 2, name: 'Zendaya', character: 'Chani', profile_url: null },
    { id: 3, name: 'Rebecca Ferguson', character: 'Jessica', profile_url: null },
    { id: 4, name: 'Javier Bardem', character: 'Stilgar', profile_url: null },
  ],
  director: 'Denis Villeneuve',
}

const noop = () => {}

/**
 * The overlay roots at `position: fixed`, which is out of flow and would
 * collapse the preview mount to zero height. A `transform` on the wrapper
 * makes it the containing block for fixed descendants, so the overlay is
 * captured at a real size instead of escaping to the viewport.
 */
const Stage = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      position: 'relative',
      width: 1040,
      height: 760,
      transform: 'translateZ(0)',
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
)

/** The full detail overlay: backdrop, poster, tagline, synopsis, cast, runtime. */
export const Loaded = () => (
  <Stage>
    <MovieDetailModal movie={dune} details={details} loading={false} onClose={noop} />
  </Stage>
)

/** Opened straight from a grid tile — the search result is shown while the
    full record is still being fetched. */
export const Loading = () => (
  <Stage>
    <MovieDetailModal movie={dune} details={null} loading onClose={noop} />
  </Stage>
)
