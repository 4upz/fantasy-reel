import { MovieTimeline } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

const item = (
  id: string,
  tmdb_id: number,
  title: string,
  poster_url: string | null,
  days: number,
  status: 'scored' | 'releasing_soon' | 'upcoming',
  combined_score: number | null,
  fantasy_points: number | null
) => ({ id, tmdb_id, title, poster_url, release_date: daysOut(days), status, combined_score, fantasy_points })

const roster = [
  item('m1', 693134, 'Dune: Part Two', POSTERS.dune, -120, 'scored', 92, 34),
  item('m2', 748783, 'The Garfield Movie', POSTERS.garfield, -60, 'scored', 35, -16.25),
  item('m3', 653346, 'Kingdom of the Planet of the Apes', POSTERS.apes, 14, 'releasing_soon', null, null),
  item('m4', 823464, 'Godzilla x Kong', POSTERS.godzilla, 120, 'upcoming', null, null),
  item('m5', 762441, 'A Quiet Place: Day One', POSTERS.quietPlace, 240, 'upcoming', null, null),
]

/** A full roster in release order — scored films first, then the countdown. */
export const ActiveSeason = () => (
  <div className="max-w-3xl">
    <MovieTimeline movies={roster} leagueStatus="active" />
  </div>
)

/** During the draft the timeline is the team's picks so far. */
export const Drafting = () => (
  <div className="max-w-3xl">
    <MovieTimeline movies={roster.slice(0, 2)} leagueStatus="drafting" />
  </div>
)

/** No picks yet — the empty state carries the prompt. */
export const Empty = () => (
  <div className="max-w-3xl">
    <MovieTimeline movies={[]} leagueStatus="setup" />
  </div>
)

/** A finished season: everything scored. */
export const Completed = () => (
  <div className="max-w-3xl">
    <MovieTimeline
      movies={[
        item('m1', 693134, 'Dune: Part Two', POSTERS.dune, -300, 'scored', 92, 34),
        item('m2', 748783, 'The Garfield Movie', POSTERS.garfield, -260, 'scored', 35, -16.25),
        item('m3', 653346, 'Kingdom of the Planet of the Apes', POSTERS.apes, -200, 'scored', 79, 19),
      ]}
      leagueStatus="completed"
    />
  </div>
)
