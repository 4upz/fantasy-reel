import { MovieFilters } from 'fantasy-reel'

const noop = () => {}

/** No year selected — the clear control stays hidden. */
export const NoFilter = () => (
  <div className="max-w-2xl">
    <MovieFilters year={null} onYearChange={noop} totalResults={248} />
  </div>
)

/** With a year chosen, a clear-filters control appears beside the select. */
export const YearSelected = () => (
  <div className="max-w-2xl">
    <MovieFilters year={2024} onYearChange={noop} totalResults={37} />
  </div>
)

export const NoResults = () => (
  <div className="max-w-2xl">
    <MovieFilters year={2026} onYearChange={noop} totalResults={0} />
  </div>
)
