interface Props {
  page?: string
}

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'overview',
  standings: 'standings',
  draft: 'draft',
  bidding: 'bidding',
  trading: 'trading',
  roster: 'roster',
  history: 'season history',
  settings: 'league settings',
}

function Heading() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-8 w-56 max-w-full rounded" />
      <div className="skeleton h-4 w-72 max-w-full rounded" />
    </div>
  )
}

function Summary() {
  return (
    <div className="card grid grid-cols-3 gap-4 p-4 sm:p-5">
      {[0, 1, 2].map((slot) => (
        <div key={slot} className="space-y-3">
          <div className="skeleton h-3 w-16 max-w-full rounded" />
          <div className="skeleton h-9 w-24 max-w-full rounded" />
        </div>
      ))}
    </div>
  )
}

function Rows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="card flex items-center gap-4 p-4">
          <div className="skeleton h-12 w-12 shrink-0 rounded" />
          <div className="flex-1 space-y-3">
            <div className="skeleton h-4 w-3/5 rounded" />
            <div className="skeleton h-3 w-2/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function PageLayout({ page }: Props) {
  switch (page) {
    case 'settings':
      return (
        <div className="min-h-[calc(100vh-4rem)] px-4 py-8 sm:py-12">
          <div className="mx-auto max-w-2xl">
            <div className="mb-8"><Heading /></div>
            <div className="space-y-6">
              {[0, 1].map((section) => (
                <div key={section} className="card space-y-6 p-6">
                  <div className="skeleton h-6 w-40 rounded" />
                  {[0, 1].map((field) => (
                    <div key={field} className="space-y-2">
                      <div className="skeleton h-4 w-24 rounded" />
                      <div className="skeleton h-11 w-full rounded-lg" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    case 'standings':
    case 'draft':
      return (
        <div className={page === 'standings'
          ? 'grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start'
          : 'grid gap-6 lg:grid-cols-3 lg:items-start'}>
          <div className={`space-y-3 ${page === 'draft' ? 'lg:col-span-2' : ''}`}>
            <Summary />
            <Rows />
          </div>
          <div className="card space-y-4 p-4">
            <Heading />
            <div className="skeleton h-48 rounded-lg" />
          </div>
        </div>
      )
    case 'roster':
      return (
        <div className="space-y-6">
          <Summary />
          <div className="skeleton h-7 w-40 rounded" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((poster) => (
              <div key={poster} className="card overflow-hidden">
                <div className="skeleton aspect-[2/3]" />
                <div className="space-y-2 p-3">
                  <div className="skeleton h-4 w-3/4 rounded" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    case 'trading':
    case 'history':
      return (
        <div className="space-y-4">
          <div className={page === 'trading' ? 'card space-y-4 p-4' : 'mb-6'}>
            <Heading />
            {page === 'trading' && <div className="skeleton h-5 w-36 rounded" />}
          </div>
          <Rows />
        </div>
      )
    default:
      return (
        <div className="space-y-6">
          <Summary />
          <div className="skeleton h-6 w-40 rounded" />
          <Rows />
        </div>
      )
  }
}

/** Used only by the unresolved route boundary, never by a tab click. */
export default function LeagueTabLoading({ page }: Props) {
  const label = PAGE_LABELS[page ?? ''] ?? 'league page'

  return (
    <div role="status" aria-label={`Loading ${label}`} data-testid="league-tab-loading">
      <span className="sr-only">Loading {label}…</span>
      <div aria-hidden="true"><PageLayout page={page} /></div>
    </div>
  )
}
