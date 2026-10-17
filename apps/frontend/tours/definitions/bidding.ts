import { defineTour } from '../types'

/**
 * The Bidding tab during a season: the Fantasy Budget, the bidding week, what
 * happens after a bid, and counterpick bids. Being outbid and bid priority
 * are taught here rather than when they happen, because a new player has
 * neither on a first visit.
 */
export const biddingTour = defineTour({
  id: 'bidding',
  version: 2,
  title: 'Bidding for pickups',
  description: 'Bidding tab: spending your Fantasy Budget on movies nobody holds.',
  when: (ctx) => ctx.leagueStatus === 'active',
  steps: [
    {
      anchor: 'bidding-budget',
      title: 'Pick up movies the draft missed',
      body: 'Bid your Fantasy Budget on upcoming movies no team holds. Bids settle once a week: the highest bid wins and pays what it bid. Your budget has to last the whole season.',
    },
    {
      anchor: 'bid-week',
      title: 'New bids close early',
      body: 'Before the cutoff you can bid on any open movie and cancel bids. After it, until bids settle, you can only outbid bids already placed, and nothing can be cancelled. That way every late bid can be answered.',
    },
    {
      anchor: 'place-bid',
      title: 'Bid, even with a full roster',
      body: 'Choose a movie and an amount. If you have drops left, you can name a movie to drop only if the bid wins. A bid that still doesn’t fit when bids settle loses and costs nothing.',
    },
    {
      title: 'After you bid',
      body: [
        'If you’re outbid, you get a set time to bid back. Your bid still stands, and it can win at its own price if the leader can’t take the movie.',
        'If you win more than you have room or budget for, your bid priority decides which ones you keep.',
      ],
    },
    {
      anchor: 'place-counterpick-bid',
      when: (ctx) => ctx.counterpicksEnabled === true,
      title: 'Bet against a rival’s movie',
      body: 'Win a counterpick and you score that movie’s points in reverse, so pick one you expect critics to pan. It’s paid from the same budget and doesn’t take a roster slot.',
    },
  ],
})
