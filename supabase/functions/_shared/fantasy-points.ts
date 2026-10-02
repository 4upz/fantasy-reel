/**
 * A movie's fantasy points within one season.
 *
 * `movies.fantasy_points` holds the default 90+ points rule: 1 fantasy point
 * per Tomatometer point all the way to 100. A season with
 * `leagues.double_points_over_90` earns a second point for each Tomatometer
 * point above 90. This mirrors the SQL `league_fantasy_points()`, which every
 * season-scoped score in the database goes through (team totals,
 * `team_holdings.fantasy_points`, `counterpicks.fantasy_points`) -- change the
 * two together.
 *
 * Takes the stored (default-rule) points and the Tomatometer they came from. A
 * movie with no Tomatometer gets no bonus, as in SQL; pending (null) points
 * are the caller's to keep null.
 */
export function leagueFantasyPoints(
  points: number,
  rtScore: number | null,
  doublePointsOver90: boolean
): number {
  return doublePointsOver90 && rtScore !== null && rtScore > 90
    ? points + (rtScore - 90)
    : points
}
