interface Props {
  label?: string
}

/** Matches the league's summary and content rhythm without inventing any values. */
export default function LeagueTabLoading({ label = 'league page' }: Props) {
  return (
    <div role="status" aria-label={`Loading ${label}`} data-testid="league-tab-loading" className="space-y-6">
      <span className="sr-only">Loading {label}…</span>
      <div aria-hidden="true" className="card p-4 sm:p-5">
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((slot) => (
            <div key={slot} className="space-y-3">
              <div className="skeleton h-3 w-16 max-w-full rounded" />
              <div className="skeleton h-9 w-24 max-w-full rounded" />
            </div>
          ))}
        </div>
        <div className="skeleton mt-5 h-10 w-36 rounded-lg" />
      </div>
      <div aria-hidden="true" className="space-y-4">
        <div className="skeleton h-6 w-40 rounded" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="card flex items-center gap-4 p-4">
            <div className="skeleton h-16 w-12 shrink-0 rounded" />
            <div className="flex-1 space-y-3">
              <div className="skeleton h-4 w-3/5 rounded" />
              <div className="skeleton h-3 w-2/5 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
