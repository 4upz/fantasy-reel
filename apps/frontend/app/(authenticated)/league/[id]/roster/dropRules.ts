import type { League, Movie } from '@/types'

/**
 * Why a held movie cannot be dropped right now.
 *
 * These mirror the refusals in the drop-movie Edge Function one for one. The
 * roster evaluates them so it can explain a refusal up front instead of leaving
 * the player to discover it by tapping and reading a toast.
 */
export type DropBlocker =
  | 'league_inactive'
  | 'released'
  | 'counterpicked'
  | 'contested'
  | 'no_drops_left'

export interface DropContext {
  leagueStatus: League['status']
  counterpicksBlockDrops: boolean
  /** Movies with an open (active/outbid) counterpick auction in this league. */
  contestedMovieIds: Set<string>
  dropsRemaining: number
}

/**
 * The first reason drop-movie would refuse this movie, or null if it would go
 * through.
 *
 * The checks run in the same order as the Edge Function, so whichever reason
 * the server would report first is the one the player is shown.
 */
export function findDropBlocker(
  movie: Pick<Movie, 'id' | 'release_date'>,
  counterpickedByTeamId: string | null,
  ctx: DropContext
): DropBlocker | null {
  const today = new Date().toISOString().split('T')[0]
  if (movie.release_date && movie.release_date < today) return 'released'

  if (ctx.leagueStatus !== 'active') return 'league_inactive'

  if (ctx.counterpicksBlockDrops) {
    if (counterpickedByTeamId) return 'counterpicked'
    if (ctx.contestedMovieIds.has(movie.id)) return 'contested'
  }

  if (ctx.dropsRemaining <= 0) return 'no_drops_left'

  return null
}

export interface BlockerExplanation {
  /** One line naming what is in the way. */
  headline: string
  /** What it means, and what would change it if anything can. */
  detail: string
}

interface ExplainArgs {
  movieTitle: string
  dropLimit: number
  leagueStatus: League['status']
  /** Name of the team holding the counterpick, when it is known. */
  counterpickerName?: string | null
}

/**
 * Player-facing copy for a blocker.
 *
 * Deliberately never names who holds an open counterpick bid: counterpick
 * auctions are blind, and the roster must not become a side channel that leaks
 * a bidder's hand.
 */
export function explainBlocker(
  blocker: DropBlocker,
  { movieTitle, dropLimit, leagueStatus, counterpickerName }: ExplainArgs
): BlockerExplanation {
  switch (blocker) {
    case 'released':
      return {
        headline: `${movieTitle} has already opened.`,
        detail:
          'Once a movie is out, its score is locked in and it stays on your roster for the rest of the season.',
      }

    case 'league_inactive':
      return leagueStatus === 'completed'
        ? {
            headline: 'This league has finished.',
            detail: 'Rosters are final, so nothing can be dropped.',
          }
        : {
            headline: 'The season has not started yet.',
            detail: 'Drops open once the league goes active. Until then your roster is fixed.',
          }

    case 'counterpicked':
      return {
        headline: counterpickerName
          ? `${counterpickerName} counterpicked ${movieTitle}.`
          : `${movieTitle} has been counterpicked.`,
        detail:
          'Your league does not allow dropping a movie another team is scoring against, so it stays on your roster for the rest of the season.',
      }

    case 'contested':
      return {
        headline: `Another team has an open counterpick bid on ${movieTitle}.`,
        detail:
          'It is locked while the auction runs. If the auction ends without anyone claiming it, you can drop it then.',
      }

    case 'no_drops_left':
      return {
        headline: `You have used all ${dropLimit} of your drops.`,
        detail: 'Drops do not reset, so your roster is set for the rest of the season.',
      }
  }
}
