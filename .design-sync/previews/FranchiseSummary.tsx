import { FranchiseSummary } from 'fantasy-reel'
import { SERIES_HISTORY, UNSCORED_HISTORY } from './_franchiseFixtures'

/** The real disclosure opens the film-by-film history in place. */
export const Default = () => (
  <div className="card max-w-xl p-4">
    <FranchiseSummary history={SERIES_HISTORY} />
  </div>
)

/** Start expanded to inspect titles, years, poster fallbacks, and score badges. */
export const Expanded = () => (
  <div className="card max-w-xl p-4">
    <FranchiseSummary history={SERIES_HISTORY} defaultOpen />
  </div>
)

/** Both summary badges and each prior film remain pending when RT is absent. */
export const Unscored = () => (
  <div className="card max-w-xl p-4">
    <FranchiseSummary history={UNSCORED_HISTORY} defaultOpen />
  </div>
)
