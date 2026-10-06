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

/**
 * Fantasy points a Tomatometer would earn, on the curve of
 * `calculate_movie_score()` in the database (see CLAUDE.md, Scoring System),
 * with the season's 90+ rule applied through `leagueFantasyPoints`. Mirrors
 * the frontend's `fantasyPointsForTomatometer` (`apps/frontend/utils/scoring.ts`)
 * -- change them together. For projections only: real points always come from
 * the database.
 */
export function fantasyPointsForTomatometer(rt: number, doublePointsOver90 = false): number {
  let points: number
  if (rt >= 50) points = rt - 60
  else if (rt >= 40) points = -10 - (50 - rt) * 0.5
  else if (rt >= 30) points = -15 - (40 - rt) * 0.25
  else if (rt >= 20) points = -17.5 - (30 - rt) * 0.125
  else if (rt >= 10) points = -18.75 - (20 - rt) * 0.0625
  else points = -19.375 - (10 - rt) * 0.03125
  return leagueFantasyPoints(Math.round(points * 100) / 100, rt, doublePointsOver90)
}
