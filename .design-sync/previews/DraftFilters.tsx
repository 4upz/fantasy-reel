import { DraftFilters } from 'fantasy-reel'

const noop = () => {}

/** The draft board's filter bar. It owns its own state — search text, release
    window, genres and minimum rating — and reports upward via onFiltersChange. */
export const Default = () => (
  <div className="max-w-2xl">
    <DraftFilters onFiltersChange={noop} totalResults={186} />
  </div>
)

/** While the movie pool is refetching. */
export const Loading = () => (
  <div className="max-w-2xl">
    <DraftFilters onFiltersChange={noop} totalResults={186} loading />
  </div>
)

/** No result count supplied — the count chip is omitted. */
export const WithoutCount = () => (
  <div className="max-w-2xl">
    <DraftFilters onFiltersChange={noop} />
  </div>
)
