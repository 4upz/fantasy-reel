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
  description: 'Bidding tab: spending your Fantasy Budget on movies no team holds.',
  when: (ctx) => ctx.leagueStatus === 'active',
  steps: [
    {
      title: 'Pick up movies the draft missed',
      body: 'Spend your Fantasy Budget on movies no team holds. Bids are settled once a week. The highest bid usually wins, and every winner pays what they bid. If the top bidder can’t take the movie, the next-highest bid wins instead.',
    },
    {
      anchor: 'bidding-budget',
      title: 'Your budget',
      body: 'What you have left to spend. Winning bids come out of it, and it doesn’t refill during the season, so pace yourself.',
    },
    {
      anchor: 'bid-week',
      title: 'The bidding week',
      body: 'New bids close at the cutoff. After that comes the counter-bid window: until bids are settled, you can only bid on movies that already have bids, to top them or raise your own.',
    },
    {
      anchor: 'place-bid',
      title: 'Place a bid',
      body: 'Pick a movie and an amount. If your roster is full, choose a movie to drop. It’s dropped only if this bid wins. If someone outbids you, you’ll hear about it and can bid again.',
    },
    {
      anchor: 'place-counterpick-bid',
      when: (ctx) => ctx.counterpicksEnabled === true,
      title: 'Counterpick bids',
      body: 'Bid on another team’s movie to counterpick it. If you win, you score its points in reverse, so pick one you expect critics to pan.',
    },
  ],
})
