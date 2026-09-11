export type ReleaseWindow = 'next30' | 'quarter' | 'year' | 'all'

export function releaseDateRange(window: ReleaseWindow, now = new Date()) {
  const gte = now.toISOString().slice(0, 10)
  const end = new Date(now)
  if (window === 'next30' || window === 'quarter') {
    end.setUTCDate(end.getUTCDate() + (window === 'next30' ? 30 : 90))
  } else {
    end.setUTCFullYear(end.getUTCFullYear() + (window === 'all' ? 2 : 0), 11, 31)
  }
  return { gte, lte: end.toISOString().slice(0, 10) }
}

/** Pages keep their upstream identity, even when every result is filtered out.
 * Totals describe upstream matches; they are not an eligible/available count. */
export function discoveryPage<T>(
  source: { page: number; total_pages: number; total_results: number },
  results: T[],
  pageLimit = 500,
) {
  const totalPages = Math.min(source.total_pages, pageLimit)
  return {
    page: source.page,
    total_pages: totalPages,
    total_results: source.total_results,
    total_results_scope: 'upstream' as const,
    has_more: source.page < totalPages,
    results,
  }
}
