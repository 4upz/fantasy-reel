import { RosterMovieCard } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

const movie = { title: 'Dune: Part Two', poster_url: POSTERS.dune, release_date: daysOut(-30), fantasy_points: 34, combined_score: 92 }

export const Default = () => (
  <div className="w-52">
    <RosterMovieCard movie={movie} label="Round 1, Pick 2" isLocked posterSizes="208px" />
  </div>
)

export const Pending = () => (
  <div className="w-52">
    <RosterMovieCard
      movie={{ ...movie, title: 'Kingdom of the Planet of the Apes', poster_url: POSTERS.apes, fantasy_points: null, combined_score: null }}
      label="Pickup"
      isLocked={false}
      posterSizes="208px"
    />
  </div>
)

/** Scored before it opens: the points show muted, "at release", and don't count yet. */
export const PreRelease = () => (
  <div className="w-52">
    <RosterMovieCard movie={{ ...movie, release_date: daysOut(21) }} label="Round 1, Pick 2" isLocked={false} posterSizes="208px" />
  </div>
)
