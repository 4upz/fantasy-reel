/**
 * Franchise history: the Tomatometer record of the films that came before a
 * movie in its TMDb collection.
 *
 * Used by: get-franchise-history
 *
 * Kept free of Supabase and network calls so the shaping rules -- which films
 * count as "prior", how the average is taken, where the list is capped -- are
 * testable without a database. The Edge Function fetches; this module decides.
 */

/** A TMDb `/3/collection/{id}` part, reduced to what the history needs. */
export interface CollectionPart {
  id: number
  title: string
  release_date: string | null
  poster_path: string | null
}

/** One prior film, as returned to the client. */
export interface FranchiseFilm {
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url: string | null
  /** Tomatometer 0-100, or null when MDBList has no RT score for it. */
  rt_score: number | null
}

/** Everything the client needs to render a movie's franchise history. */
export interface FranchiseHistory {
  collection_id: number
  collection_name: string
  /** Where this movie falls in the series by release order, 1-based. */
  entry_number: number
  /** Prior released films, oldest first. */
  films: FranchiseFilm[]
  /** Mean Tomatometer of the scored prior films, rounded; null when none are scored. */
  average_rt: number | null
  /** Tomatometer of the most recent prior film; null when it is unscored. */
  last_rt: number | null
}

/**
 * The whole collection's released films with their scores -- what gets cached
 * per collection, since every movie in the series derives its own history
 * from the same record.
 */
export interface CollectionRecord {
  collection_id: number
  collection_name: string
  /** Every released part with a known release date, oldest first. */
  films: FranchiseFilm[]
  /**
   * True when a score that should be here is missing for a reason that may
   * clear -- a failed lookup, or the daily budget ran out -- as opposed to
   * MDBList simply having no Tomatometer for the film. Decides the cache TTL.
   */
  incomplete?: boolean
}

/**
 * How many prior films a history carries. Long-running series (Godzilla has
 * 30+ entries) would otherwise bury the recent, relevant run under decades of
 * history and cost a score lookup per film on first sight.
 */
export const MAX_PRIOR_FILMS = 8

/**
 * A week for a complete record: which films a collection has does not change,
 * and a settled Tomatometer moves a point or two at most.
 */
export const COMPLETE_RECORD_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * An hour for an incomplete one. A rate limit or a spent budget must not bake
 * "not rated" into a week of cache; the record is retried once the condition
 * has had time to clear.
 */
export const INCOMPLETE_RECORD_TTL_SECONDS = 60 * 60

/** How long a collection record stays fresh, by whether its scores all landed. */
export function recordTtlSeconds(record: CollectionRecord): number {
  return record.incomplete ? INCOMPLETE_RECORD_TTL_SECONDS : COMPLETE_RECORD_TTL_SECONDS
}

/**
 * The parts of a collection that have already released, oldest first. A part
 * with no release date is unreleased as far as TMDb knows, so it is dropped
 * rather than sorted to an arbitrary end.
 */
export function releasedParts(parts: CollectionPart[], today: string): CollectionPart[] {
  return parts
    .filter((part): part is CollectionPart & { release_date: string } =>
      typeof part.release_date === 'string' && part.release_date !== '' && part.release_date < today
    )
    .sort((a, b) => a.release_date.localeCompare(b.release_date))
}

function roundedMean(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

/**
 * Derives one movie's history from its collection's record.
 *
 * "Prior" means released before the movie itself: by release date when the
 * movie has one, and every released film otherwise (an undated sequel is by
 * definition after everything that has come out). The movie's own row is
 * always excluded, so a released movie's history never includes itself.
 *
 * Returns null when there is nothing before the movie -- the first film in a
 * series has no track record, and rendering an empty one would only add noise.
 */
export function historyForMovie(
  record: CollectionRecord,
  movie: { tmdb_id: number; release_date: string | null }
): FranchiseHistory | null {
  const prior = record.films.filter((film) => {
    if (film.tmdb_id === movie.tmdb_id) return false
    if (!movie.release_date) return true
    return film.release_date != null && film.release_date < movie.release_date
  })

  if (prior.length === 0) return null

  const films = prior.slice(-MAX_PRIOR_FILMS)
  const scored = films.map((f) => f.rt_score).filter((s): s is number => s != null)

  return {
    collection_id: record.collection_id,
    collection_name: record.collection_name,
    entry_number: prior.length + 1,
    films,
    average_rt: roundedMean(scored),
    last_rt: films[films.length - 1].rt_score,
  }
}
