'use client'

interface Props {
  year: number | null
  onYearChange: (year: number | null) => void
  totalResults: number
}

export default function MovieFilters({ year, onYearChange, totalResults }: Props) {
  const currentYear = new Date().getFullYear()
  const years = [
    currentYear + 2,
    currentYear + 1,
    currentYear,
    currentYear - 1,
    currentYear - 2,
    currentYear - 3,
    currentYear - 4,
  ]

  const hasFilters = year !== null

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Year filter */}
        <div className="relative">
          <select
            value={year ?? ''}
            onChange={(e) => onYearChange(e.target.value ? parseInt(e.target.value) : null)}
            className="appearance-none bg-elevated border border-border rounded-lg px-4 py-2 pr-10 text-sm text-foreground focus:border-gold focus:ring-2 focus:ring-gold-muted focus:outline-none cursor-pointer transition-all hover:border-border-hover"
          >
            <option value="">All Years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg
              className="w-4 h-4 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Clear filters button */}
        {hasFilters && (
          <button
            onClick={() => onYearChange(null)}
            className="text-sm text-foreground-muted hover:text-gold transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear
          </button>
        )}
      </div>

      {/* Results count */}
      {totalResults > 0 && (
        <p className="text-sm text-foreground-muted">
          <span className="text-foreground font-medium">{totalResults.toLocaleString()}</span> movies
          found
        </p>
      )}
    </div>
  )
}
