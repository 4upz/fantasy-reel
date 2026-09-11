import type { FranchiseHistory } from '../../apps/frontend/types'

// Illustrative series: the mean (70) and latest score (58) match these films.
// Missing posters deliberately exercise the built-in fallback without a host.
export const SERIES_HISTORY: FranchiseHistory = {
  collection_id: 900_001,
  collection_name: 'Aurora Collection',
  entry_number: 4,
  films: [
    { tmdb_id: 900_101, title: 'Aurora', release_date: '2014-07-18', poster_url: null, rt_score: 82 },
    { tmdb_id: 900_102, title: 'Aurora: Beyond', release_date: '2018-06-22', poster_url: null, rt_score: 70 },
    { tmdb_id: 900_103, title: 'Aurora: Homecoming', release_date: '2022-08-12', poster_url: null, rt_score: 58 },
  ],
  average_rt: 70,
  last_rt: 58,
}

export const UNSCORED_HISTORY: FranchiseHistory = {
  ...SERIES_HISTORY,
  films: SERIES_HISTORY.films.map((film) => ({ ...film, rt_score: null })),
  average_rt: null,
  last_rt: null,
}

export const CURRENT_FILM_TITLE = 'Aurora: New Dawn'

export function upcomingReleaseDate(): string {
  return new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10)
}
