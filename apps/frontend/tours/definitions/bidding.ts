import { defineTour } from '../types'

/**
 * The bidding tab, during an active season. The engine's reference tour: it
 * uses a centered intro, anchored steps, and a step that only applies when the
 * league has counterpicks.
 */
export const biddingTour = defineTour({
  id: 'bidding',
  version: 1,
  title: 'Bidding for pickups',
  description: 'Bidding tab: spending your Fantasy Budget on movies nobody drafted.',
  when: (ctx) => ctx.leagueStatus === 'active',
  steps: [
    {
      title: 'Pick up movies the draft missed',
      body: 'Spend your Fantasy Budget on movies no team holds. Bids are settled once a week: the highest bid on each movie wins, and the winner pays what they bid.',
    },
    {
      anchor: 'bidding-budget',
      title: 'Your budget',
      body: 'What you have left to spend. It lasts the whole season and doesn’t refill, so pace yourself.',
    },
    {
      anchor: 'bid-week',
      title: 'The bidding week',
      body: 'New bids close at the cutoff. After that, until bids are settled, you can only outbid others on movies that already have bids.',
    },
    {
      anchor: 'place-bid',
      title: 'Place a bid',
      body: 'Pick a movie and an amount. Your roster can be full: name a movie to drop only if the bid wins. If someone outbids you, you’ll hear about it and can bid again.',
    },
    {
      anchor: 'place-counterpick-bid',
      when: (ctx) => ctx.counterpicksEnabled === true,
      title: 'Counterpick bids',
      body: 'Bid to counterpick another team’s movie. You score its points in reverse, so pick one you expect critics to pan.',
    },
  ],
})
