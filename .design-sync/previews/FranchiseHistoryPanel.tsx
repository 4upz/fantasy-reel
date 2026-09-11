import { FranchiseHistoryPanel } from 'fantasy-reel'
import { CURRENT_FILM_TITLE, SERIES_HISTORY, UNSCORED_HISTORY, upcomingReleaseDate } from './_franchiseFixtures'

/** A declining series crosses break-even before the upcoming fourth entry. */
export const Default = () => (
  <div className="max-w-2xl">
    <FranchiseHistoryPanel
      history={SERIES_HISTORY}
      movieTitle={CURRENT_FILM_TITLE}
      movieReleaseDate={upcomingReleaseDate()}
    />
  </div>
)

/** Missing RT scores stay pending, with no fabricated chart points or average. */
export const Unscored = () => (
  <div className="max-w-2xl">
    <FranchiseHistoryPanel
      history={UNSCORED_HISTORY}
      movieTitle={CURRENT_FILM_TITLE}
      movieReleaseDate={null}
    />
  </div>
)
