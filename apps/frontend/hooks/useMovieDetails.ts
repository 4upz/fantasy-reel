import useSWR from 'swr'
import { edgeFetcher } from '@/utils/supabase/functions'
import type { TMDbMovieDetails } from '@/types'

/** Movie details barely change, and every miss costs two TMDb calls server-side. */
const DETAILS_TTL_MS = 600_000

type FetcherKey = ['get-movie-details', number]

const fetcher = ([, tmdbId]: FetcherKey): Promise<TMDbMovieDetails> =>
  edgeFetcher<TMDbMovieDetails>('get-movie-details', { tmdb_id: tmdbId })

interface UseMovieDetailsReturn {
  details: TMDbMovieDetails | null
  isLoading: boolean
  error: string | null
}

/**
 * TMDb details for a single movie, shared across every surface that opens a
 * movie dialog.
 *
 * The same movie is opened again and again -- from the draft grid, the roster,
 * the discover page -- so the result is cached under one key for ten minutes
 * and a re-open resolves from cache without touching the network.
 *
 * @param tmdbId - The movie to load, or null to fetch nothing (closed dialog).
 */
export function useMovieDetails(tmdbId: number | null): UseMovieDetailsReturn {
  const key: FetcherKey | null = tmdbId != null ? ['get-movie-details', tmdbId] : null

  const { data, error, isLoading } = useSWR(key, fetcher, {
    dedupingInterval: DETAILS_TTL_MS,
  })

  return {
    details: data ?? null,
    isLoading,
    error: error?.message ?? null,
  }
}
