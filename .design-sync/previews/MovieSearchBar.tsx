import { MovieSearchBar } from 'fantasy-reel'

const noop = () => {}

/** Fully controlled — the parent owns the value and all debouncing. */
export const Empty = () => (
  <div className="max-w-xl">
    <MovieSearchBar value="" onChange={noop} onClear={noop} loading={false} />
  </div>
)

/** With a value, the trailing control becomes a clear button. */
export const WithQuery = () => (
  <div className="max-w-xl">
    <MovieSearchBar value="Dune" onChange={noop} onClear={noop} loading={false} />
  </div>
)

/** While loading, the clear button is replaced by a gold spinner. */
export const Loading = () => (
  <div className="max-w-xl">
    <MovieSearchBar value="Villeneuve" onChange={noop} onClear={noop} loading />
  </div>
)

/** `compact` shrinks the field for dense toolbars. */
export const Compact = () => (
  <div className="max-w-xl">
    <MovieSearchBar value="" onChange={noop} onClear={noop} loading={false} compact />
  </div>
)
