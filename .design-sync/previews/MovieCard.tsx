import { MovieCard } from 'fantasy-reel'

// Curated from the repo's own FALLBACK_MOVIES fixtures
// (apps/frontend/app/components/landing/data.ts).
const dune = {
  tmdb_id: 693134,
  title: 'Dune: Part Two',
  overview: 'Follow the mythic journey of Paul Atreides.',
  release_date: '2024-02-27',
  poster_url: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
  vote_average: 8.4,
  popularity: 1200,
  genre_ids: [878, 12],
}

const apes = {
  tmdb_id: 653346,
  title: 'Kingdom of the Planet of the Apes',
  overview: "Several generations following Caesar's reign.",
  release_date: '2024-05-08',
  poster_url: 'https://image.tmdb.org/t/p/w500/gKkl37BQuKTanygYQG1pyYgLVgf.jpg',
  vote_average: 7.1,
  popularity: 800,
  genre_ids: [878, 12, 28],
}

const unannounced = {
  tmdb_id: 1125899,
  title: 'Untitled Villeneuve Project',
  overview: null,
  release_date: null,
  poster_url: null,
  vote_average: 0,
  popularity: 40,
  genre_ids: [878],
}

const noop = () => {}

const Cell = ({ children }: { children: React.ReactNode }) => (
  <div className="w-52">{children}</div>
)

export const Default = () => (
  <Cell>
    <MovieCard movie={dune} onClick={noop} index={0} />
  </Cell>
)

/** No poster and no release date yet — the pre-announcement state. */
export const NoPoster = () => (
  <Cell>
    <MovieCard movie={unannounced} onClick={noop} index={0} />
  </Cell>
)

/** vote_average of 0 suppresses the rating badge entirely. */
export const WithoutRating = () => (
  <Cell>
    <MovieCard movie={{ ...apes, vote_average: 0 }} onClick={noop} index={0} />
  </Cell>
)

export const InAGrid = () => (
  <div className="grid grid-cols-3 gap-4">
    <MovieCard movie={dune} onClick={noop} index={0} />
    <MovieCard movie={apes} onClick={noop} index={1} />
    <MovieCard movie={unannounced} onClick={noop} index={2} />
  </div>
)
