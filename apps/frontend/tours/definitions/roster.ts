import { defineTour } from '../types'

/**
 * The Roster tab during a season: what a drop does, when a movie can't be
 * dropped, and how counterpicks score. The drop dialog explains each lock in
 * full, so the tour only says what the locks are.
 */
export const rosterTour = defineTour({
  id: 'roster',
  version: 1,
  title: 'Your roster',
  description: 'Roster tab: dropping movies, what locks one in place, and your counterpicks.',
  when: (ctx) => ctx.leagueStatus === 'active' && (ctx.dropLimit !== 0 || ctx.counterpicksEnabled === true),
  steps: [
    {
      anchor: 'roster-summary',
      when: (ctx) => ctx.dropLimit !== 0,
      title: 'Drops are limited',
      body: 'Dropping a movie frees its slot for a pickup and puts it back up for bids. You get a set number of drops for the whole season. Used ones don’t come back, and a drop refunds nothing.',
    },
    {
      // Only cards that can be dropped carry this anchor, so the step drops out when none can.
      anchor: 'roster-movie',
      title: 'Drop before it opens',
      body: 'Open a movie to drop it. A drop is permanent, and a movie can’t be dropped once it has opened.',
    },
    {
      when: (ctx) => ctx.dropLimit !== 0,
      title: 'Locked movies',
      body: (ctx) =>
        ctx.counterpicksBlockDrops === true
          ? 'A movie is locked once it opens, while another team holds a counterpick on it or is bidding for one, and once your drops run out. Open a locked movie to see why.'
          : 'A movie is locked once it opens, and every movie is once your drops run out. Open a locked movie to see why.',
    },
    {
      anchor: 'roster-counterpicks',
      when: (ctx) => ctx.counterpicksEnabled === true,
      title: 'Counterpicks score in reverse',
      body: 'A counterpick earns you its movie’s points with the sign flipped, so a flop helps you and a hit costs you. It stays yours even if the other team drops the movie.',
    },
  ],
})
