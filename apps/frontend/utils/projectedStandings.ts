import type { MovieProjection } from '@/types'
import { hasReleased } from '@/utils/date'
import { fantasyPointsForTomatometer } from '@/utils/scoring'

/**
 * Projected standings (Beta), the Fantasy Critic way: what each team has
 * earned, plus what its movies still to come are most likely worth, ranked.
 *
 * A view, never a record. Real rank and champions come from
 * `league_standings` alone; nothing here feeds back into them.
 */

export interface ProjectedStandingTeam {
  team_id: string
  team_name: string
  /** Points that count today, as `league_standings` reports them. */
  earned: number
  /** The real rank, kept so the projected table can say how far a team moves. */
  rank: number
}

/** A movie a team holds, as `team_holdings` carries it (already under this season's rule). */
export interface ProjectedStandingHolding {
  team_id: string
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url?: string | null
  combined_score: number | null
  fantasy_points: number | null
}

/** A counterpick, with the inverted points it scores for the counterpicker. */
export interface ProjectedStandingCounterpick {
  counterpicker_team_id: string
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url?: string | null
  combined_score: number | null
  fantasy_points: number | null
}

export type ProjectedLegBasis =
  /** Released and scored: already inside `earned`. */
  | 'earned'
  /** Not counted yet; the projection's expected points stand in. */
  | 'projection'
  /** Not counted yet, no projection, but a pre-release score that will count at release. */
  | 'pre_release'
  /** Not counted yet and nothing to go on: adds nothing. */
  | 'none'

export interface ProjectedLeg {
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url: string | null
  counterpick: boolean
  basis: ProjectedLegBasis
  /** Points for this team: the real ones when earned, otherwise the most likely ones. */
  points: number
  projection: MovieProjection | null
}

export interface ProjectedStanding {
  team_id: string
  team_name: string
  earned: number
  /** earned + the most likely points of everything not counted yet. */
  projected: number
  /** Competition rank on `projected` (1, 2, 2, 4). */
  projectedRank: number
  isTied: boolean
  currentRank: number
  /** Places gained against the real rank: positive is up. */
  rankChange: number
  /** Movies whose points do not count yet. */
  remaining: number
  /** Standard deviation of the projected total, in points, from the 80% ranges. */
  uncertainty: number
  /** The gap to a neighbour is small next to the uncertainty in what's left. */
  tossUp: boolean
  legs: ProjectedLeg[]
}

/** A normal distribution's 80% interval spans ±1.2816 standard deviations. */
const Z80 = 1.2816

/**
 * The gap to a neighbour, in combined standard deviations, under which the
 * order is close to a coin flip (about a one-in-three chance it flips).
 */
const TOSS_UP_GAP = 0.5

/** Totals equal to a tenth of a point are tied: below that is float noise. */
const roundTenth = (value: number) => Math.round(value * 10) / 10

interface LegSource {
  team_id: string
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url?: string | null
  combined_score: number | null
  fantasy_points: number | null
  counterpick: boolean
}

function toLeg(
  source: LegSource,
  projections: ReadonlyMap<number, MovieProjection | null>,
  now: Date
): ProjectedLeg {
  const base = {
    tmdb_id: source.tmdb_id,
    title: source.title,
    release_date: source.release_date,
    poster_url: source.poster_url ?? null,
    counterpick: source.counterpick,
  }
  // Counted exactly as team_scores counts it: released, with a score.
  if (source.fantasy_points != null && hasReleased(source.release_date, now)) {
    return { ...base, basis: 'earned', points: source.fantasy_points, projection: null }
  }
  const projection = projections.get(source.tmdb_id) ?? null
  if (projection && !projection.insufficient_history) {
    const points = source.counterpick ? -projection.expected_points : projection.expected_points
    return { ...base, basis: 'projection', points, projection }
  }
  if (source.fantasy_points != null) {
    // Already inverted on a counterpick row.
    return { ...base, basis: 'pre_release', points: source.fantasy_points, projection }
  }
  return { ...base, basis: 'none', points: 0, projection }
}

/** Points-space standard deviation of one projected leg, read off its 80% Tomatometer range. */
function legVariance(leg: ProjectedLeg, doublePointsOver90: boolean): number {
  if (leg.basis !== 'projection' || !leg.projection) return 0
  const [low, high] = leg.projection.range80
  const spread =
    fantasyPointsForTomatometer(high, doublePointsOver90) - fantasyPointsForTomatometer(low, doublePointsOver90)
  const sd = Math.abs(spread) / (2 * Z80)
  return sd * sd
}

/**
 * Ranks every team by earned points plus the most likely points of what it
 * still has to come: its own unreleased or unscored movies at their expected
 * points, and its counterpicks at the negation of their target's.
 */
export function computeProjectedStandings({
  teams,
  holdings,
  counterpicks,
  projections,
  doublePointsOver90 = false,
  now = new Date(),
}: {
  teams: ProjectedStandingTeam[]
  holdings: ProjectedStandingHolding[]
  counterpicks: ProjectedStandingCounterpick[]
  projections: ReadonlyMap<number, MovieProjection | null>
  doublePointsOver90?: boolean
  now?: Date
}): ProjectedStanding[] {
  const legsByTeam = new Map<string, ProjectedLeg[]>()
  const add = (source: LegSource) => {
    const legs = legsByTeam.get(source.team_id) ?? []
    legs.push(toLeg(source, projections, now))
    legsByTeam.set(source.team_id, legs)
  }
  holdings.forEach((holding) => add({ ...holding, counterpick: false }))
  counterpicks.forEach((counterpick) =>
    add({ ...counterpick, team_id: counterpick.counterpicker_team_id, counterpick: true })
  )

  const rows = teams.map((team) => {
    const legs = legsByTeam.get(team.team_id) ?? []
    const pending = legs.filter((leg) => leg.basis !== 'earned')
    const projected = roundTenth(team.earned + pending.reduce((sum, leg) => sum + leg.points, 0))
    const variance = pending.reduce((sum, leg) => sum + legVariance(leg, doublePointsOver90), 0)
    return {
      team_id: team.team_id,
      team_name: team.team_name,
      earned: team.earned,
      projected,
      currentRank: team.rank,
      remaining: pending.length,
      uncertainty: Math.sqrt(variance),
      legs,
    }
  })

  const ordered = [...rows].sort(
    (a, b) => b.projected - a.projected || a.currentRank - b.currentRank || a.team_name.localeCompare(b.team_name)
  )

  return ordered.map((row, index) => {
    const projectedRank = ordered.findIndex((other) => other.projected === row.projected) + 1
    const isTied = ordered.some((other) => other !== row && other.projected === row.projected)
    const neighbours = [ordered[index - 1], ordered[index + 1]].filter(Boolean)
    const tossUp = neighbours.some((neighbour) => {
      const spread = Math.sqrt(row.uncertainty ** 2 + neighbour.uncertainty ** 2)
      return spread > 0 && Math.abs(row.projected - neighbour.projected) < TOSS_UP_GAP * spread
    })
    return { ...row, projectedRank, isTied, rankChange: row.currentRank - projectedRank, tossUp }
  })
}

/** Whether a projected table says anything the real one doesn't: some leg rests on a projection. */
export function hasProjectedLegs(standings: ProjectedStanding[]): boolean {
  return standings.some((team) => team.legs.some((leg) => leg.basis === 'projection'))
}
