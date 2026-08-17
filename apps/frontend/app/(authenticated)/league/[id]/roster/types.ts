import type { HoldingMovieRow } from '@/utils/holdings'
import type { HoldingMovie, HoldingSource, TeamHolding } from '@/types'

/** The `team_holdings` columns the roster page selects. */
export type RosterHolding = HoldingMovieRow &
  Pick<
    TeamHolding,
    | 'holding_id'
    | 'source'
    | 'round'
    | 'pick_number'
    | 'amount_paid'
    | 'counterpicked_by_team_id'
    | 'counterpicked_by_name'
  >

/**
 * A movie on the roster, flattened so draft picks and pickups share one path.
 * The two differ only in their subtitle and which id drop-movie wants.
 */
export interface Holding {
  id: string
  source: HoldingSource
  movie: HoldingMovie
  /** The card's subtitle, e.g. "Round 2, Pick 5" or "$14". */
  label: string
  counterpickedByTeamId: string | null
  counterpickerName: string | null
}
