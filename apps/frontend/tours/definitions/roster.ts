import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Roster tab during a season: what a drop does, when a movie can't be
 * dropped, and how counterpicks score. The drop dialog explains each lock in
 * full, so the tour only says what the locks are.
 */
export const rosterTour = defineTour<{ leagueStatus: LeagueStatus; dropLimit: number; counterpicksBlockDrops: boolean; counterpicksEnabled: boolean }>({
  id: 'roster',
  version: 1,
  title: 'Your roster',
  description: 'Roster tab: dropping movies, what locks one in place, and your counterpicks.',
  when: (ctx) => ctx.leagueStatus === 'active' && (ctx.dropLimit !== 0 || ctx.counterpicksEnabled),
  steps: [
    {
      anchor: 'roster-drops',
      when: (ctx) => ctx.dropLimit !== 0,
      title: 'Drops are limited',
      body: 'Dropping a movie frees its slot for a pickup and, if critics haven’t scored it, puts it back up for bids. You get a set number of drops for the whole season. A drop is permanent and refunds nothing.',
    },
    {
      // Only cards that can be dropped carry this anchor, so the step drops out when none can.
      anchor: 'roster-movie',
      title: 'Drop before it opens',
      body: 'Open a movie to drop it. Do it before release day: once a movie opens, it can’t be dropped.',
    },
    {
      anchor: 'roster-locked',
      centerIfMissing: true,
      when: (ctx) => ctx.dropLimit !== 0,
      title: 'Locked movies',
      body: (ctx) =>
        ctx.counterpicksBlockDrops
          ? 'Besides opening, a movie locks while another team holds a counterpick on it or is bidding for one, and every movie locks once your drops run out. Open a locked movie to see why.'
          : 'Besides opening, every movie locks once your drops run out. Open a locked movie to see why.',
    },
    {
      anchor: 'roster-counterpicks',
      when: (ctx) => ctx.counterpicksEnabled,
      title: 'Counterpicks score in reverse',
      body: 'A counterpick earns you its movie’s points with the sign flipped, so a flop helps you and a hit costs you. It stays yours even if the other team drops the movie.',
    },
  ],
})
