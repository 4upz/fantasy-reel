export type TmdbPosterSize = 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original'

const TMDB_ORIGIN = 'https://image.tmdb.org'
const POSTER_PATH = /^\/[^/?#]+\.(?:jpe?g|png|webp)$/i

/** Normalize TMDb paths and URLs while preserving app assets and other image hosts. */
export function getTmdbPosterUrl(
  posterUrl: string | null | undefined,
  size: TmdbPosterSize = 'w500',
): string | null {
  const source = posterUrl?.trim()
  if (!source) return null

  if (POSTER_PATH.test(source)) return `${TMDB_ORIGIN}/t/p/${size}${source}`
  if (source.startsWith('/') && !source.startsWith('//')) return source

  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.hostname !== 'image.tmdb.org') return source

    const match = url.pathname.match(/^\/t\/p\/(?:w\d+|original)(\/.+)$/)
    return match && POSTER_PATH.test(match[1])
      ? `${TMDB_ORIGIN}/t/p/${size}${match[1]}`
      : null
  } catch {
    return null
  }
}
