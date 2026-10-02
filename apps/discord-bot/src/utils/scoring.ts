/**
 * A movie's fantasy points in one season. `movies.fantasy_points` holds the
 * default rule (1 point per Tomatometer point from 50 up); a season with double
 * points over 90 adds (RT - 90) above 90. Mirrors the SQL league_fantasy_points,
 * which the bot cannot call per row -- `team_holdings` already applies it, so
 * only raw `movies` reads need this.
 */
export function leagueFantasyPoints(points: number, rtScore: number | null, doublePointsOver90: boolean): number {
  return doublePointsOver90 && rtScore !== null && rtScore > 90 ? points + (rtScore - 90) : points
}
