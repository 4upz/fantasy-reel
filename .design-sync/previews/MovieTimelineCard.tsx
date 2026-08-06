import { MovieTimelineCard } from 'fantasy-reel'

// This card renders a live countdown ("14 days", "8 mo", "Released"), so its
// dates must be relative to whenever it is rendered — a hard-coded date drifts
// into the wrong bucket over time, and the screenshot harness pins its clock to
// a different date than the live design pane uses.
const daysOut = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

const base = {
  id: 'b1f0c2d3-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
  tmdb_id: 693134,
  title: 'Dune: Part Two',
  poster_url: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
  release_date: daysOut(-120),
}

/** Already released and scored — the Tomatometer and its fantasy points show. */
const scored = {
  ...base,
  status: 'scored' as const,
  combined_score: 92,
  fantasy_points: 34,
}

/** Releasing soon pulses gold; it is the state a team watches. */
const releasingSoon = {
  ...base,
  id: 'c2e1d3f4-5a6b-4c7d-9e0f-1a2b3c4d5e6f',
  tmdb_id: 653346,
  title: 'Kingdom of the Planet of the Apes',
  poster_url: 'https://image.tmdb.org/t/p/w500/gKkl37BQuKTanygYQG1pyYgLVgf.jpg',
  release_date: daysOut(14),
  status: 'releasing_soon' as const,
  combined_score: null,
  fantasy_points: null,
}

const upcoming = {
  ...base,
  id: 'd3f2e4a5-6b7c-4d8e-0f1a-2b3c4d5e6f70',
  tmdb_id: 823464,
  title: 'Godzilla x Kong: The New Empire',
  poster_url: 'https://image.tmdb.org/t/p/w500/z1p34vh7dEOnLDmyCrlUVLuoDzd.jpg',
  release_date: daysOut(240),
  status: 'upcoming' as const,
  combined_score: null,
  fantasy_points: null,
}

/** A movie that scored badly — crimson score, negative points. */
const rotten = {
  ...base,
  id: 'e4a3b5c6-7d8e-4f90-1a2b-3c4d5e6f7081',
  tmdb_id: 748783,
  title: 'The Garfield Movie',
  poster_url: 'https://image.tmdb.org/t/p/w500/p6AbOJvMQhBmffd0PIv0u8ghWeY.jpg',
  release_date: daysOut(-60),
  status: 'scored' as const,
  combined_score: 35,
  fantasy_points: -16.25,
}

const Cell = ({ children }: { children: React.ReactNode }) => (
  <div className="w-40">{children}</div>
)

export const Scored = () => (
  <Cell>
    <MovieTimelineCard movie={scored} />
  </Cell>
)

/** The three timeline states, left to right. */
export const Statuses = () => (
  <div className="flex items-start gap-4">
    <div className="w-40">
      <MovieTimelineCard movie={scored} />
    </div>
    <div className="w-40">
      <MovieTimelineCard movie={releasingSoon} />
    </div>
    <div className="w-40">
      <MovieTimelineCard movie={upcoming} />
    </div>
  </div>
)

/** Points carry a sign: gold above the 60 baseline, crimson below. */
export const EarningVsLosing = () => (
  <div className="flex items-start gap-4">
    <div className="w-40">
      <MovieTimelineCard movie={scored} />
    </div>
    <div className="w-40">
      <MovieTimelineCard movie={rotten} />
    </div>
  </div>
)
