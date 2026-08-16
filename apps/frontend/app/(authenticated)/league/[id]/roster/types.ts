import type { Movie } from '@/types'

/**
 * A movie on the roster, flattened so draft picks and pickups share one path.
 * The two differ only in their subtitle and which id drop-movie wants.
 */
export interface Holding {
  id: string
  source: 'draftPicks' | 'pickups'
  movie: Movie
  /** The card's subtitle, e.g. "Round 2, Pick 5" or "$14". */
  label: string
  counterpickedByTeamId: string | null
  counterpickerName: string | null
}
