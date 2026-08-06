import { DraftMovieCard } from 'fantasy-reel'

const dune = {
  tmdb_id: 693134,
  title: 'Dune: Part Two',
  overview: 'Follow the mythic journey of Paul Atreides.',
  release_date: '2026-02-27',
  poster_url: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
  vote_average: 8.4,
  popularity: 1200,
  genre_ids: [878, 12],
}

const apes = {
  tmdb_id: 653346,
  title: 'Kingdom of the Planet of the Apes',
  overview: "Several generations following Caesar's reign.",
  release_date: '2026-05-08',
  poster_url: 'https://image.tmdb.org/t/p/w500/gKkl37BQuKTanygYQG1pyYgLVgf.jpg',
  vote_average: 7.1,
  // 100+ is "Trending" (solid), 50-99 is "Popular" (outline), below 50 has no
  // badge at all — see getPopularityBadge.
  popularity: 62,
  genre_ids: [878, 12, 28],
}

const quiet = {
  ...apes,
  tmdb_id: 762441,
  title: 'A Quiet Place: Day One',
  poster_url: 'https://image.tmdb.org/t/p/w500/hU42CRk14JuPEdqZG3AWmagiPAP.jpg',
  release_date: '2026-06-26',
  vote_average: 6.9,
  popularity: 12,
}

const noop = () => {}

const Cell = ({ children }: { children: React.ReactNode }) => (
  <div className="w-48">{children}</div>
)

/** Available to draft — the card is clickable and lifts on hover. */
export const Available = () => (
  <Cell>
    <DraftMovieCard movie={dune} onPreview={noop} />
  </Cell>
)

/** Already taken this league: dimmed to 40% and no longer clickable. */
export const Drafted = () => (
  <Cell>
    <DraftMovieCard movie={dune} isDrafted onPreview={noop} />
  </Cell>
)

/** Side by side, the available/drafted contrast is the card's main state axis. */
export const AvailableVsDrafted = () => (
  <div className="grid grid-cols-2 gap-4 max-w-md">
    <DraftMovieCard movie={dune} onPreview={noop} />
    <DraftMovieCard movie={dune} isDrafted onPreview={noop} />
  </div>
)

/** Popularity drives the corner badge: solid "Trending", outlined "Popular",
    or nothing at all for a quiet title. */
export const PopularityBadges = () => (
  <div className="grid grid-cols-3 gap-4 max-w-2xl">
    <DraftMovieCard movie={dune} onPreview={noop} />
    <DraftMovieCard movie={apes} onPreview={noop} />
    <DraftMovieCard movie={quiet} onPreview={noop} />
  </div>
)
