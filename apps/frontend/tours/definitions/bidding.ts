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
      body: 'Bid your Fantasy Budget on upcoming movies no team holds and critics haven’t scored. Bids settle weekly, and each winner pays what it bid. Your budget doesn’t reset each week, so pace yourself.',
    },
    {
      anchor: 'bid-week',
      title: 'Get new bids in during open bidding',
      body: 'During open bidding you can bid on any available movie and cancel your bids. After it closes, until bids settle, you can only raise or counter bids on movies already in play, and no bid can be withdrawn.',
    },
    {
      anchor: 'place-bid',
      title: 'Bid, even with a full roster',
      body: 'Pick a movie and an amount. If you have drops left, you can also choose a movie of yours to drop if the bid wins. A bid that still doesn’t fit when bids settle loses and costs nothing.',
    },
    {
      anchor: 'bid-priority',
      centerIfMissing: true,
      title: 'After you bid',
      body: (ctx) => [
        `If you’re outbid, you have ${typeof ctx.counterbidHours === 'number' ? `${ctx.counterbidHours} ${ctx.counterbidHours === 1 ? 'hour' : 'hours'}` : 'a set time'} to counter. Your bid still stands, and it can win at its own price if the leader has no room or budget left.`,
        'If you win more than you have room or budget for, your bid priority decides which ones you keep.',
      ],
    },
    {
      anchor: 'place-counterpick-bid',
      when: (ctx) => ctx.counterpicksEnabled === true,
      title: 'Bet against a rival’s movie',
      body: 'Bid on another team’s movie to counterpick it. If you win, you score its points in reverse, so pick one you expect critics to pan. It’s paid from the same budget and doesn’t take a roster slot.',
    },
  ],
})
