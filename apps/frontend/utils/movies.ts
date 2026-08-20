import type { TMDbSearchResult } from '@/types'

/** The shape every paginated TMDb response shares: a page of movies. */
interface MoviePage {
  results: TMDbSearchResult[]
}

/**
 * SWR key for one page of one movie request: the Edge Function to call and the
 * body to call it with. SWR hashes the body stably (keys sorted, `undefined`
 * dropped), so two equivalent requests always resolve to the same cache entry
 * -- which is what stops a remount, or a round trip through a filter and back,
 * from re-hitting TMDb.
 */
export type MoviePageKey = [functionName: string, body: Record<string, unknown>]

/** Shared `useSWRInfinite` options for every TMDb-backed movie list. */
export const MOVIE_PAGE_SWR_CONFIG = {
  // Paging in more movies must not re-request the pages already on screen.
  revalidateFirstPage: false,
  // Keys depend on the page index alone, never on the previous page, so pages
  // can be revalidated concurrently instead of one after another.
  parallel: true,
  keepPreviousData: true,
} as const

/**
 * Flatten the pages `useSWRInfinite` accumulated into the single list a grid
 * renders.
 *
 * Two things are dropped along the way: movies already seen on an earlier page
 * (TMDb occasionally repeats a title across page boundaries, especially when a
 * popularity sort shifts between requests) and anything in `exclude`.
 */
export function flattenMoviePages(
  pages: MoviePage[] | undefined,
  exclude?: ReadonlySet<number>
): TMDbSearchResult[] {
  const seen = new Set<number>()
  const movies: TMDbSearchResult[] = []

  for (const page of pages ?? []) {
    for (const movie of page.results) {
      if (seen.has(movie.tmdb_id) || exclude?.has(movie.tmdb_id)) continue
      seen.add(movie.tmdb_id)
      movies.push(movie)
    }
  }

  return movies
}
