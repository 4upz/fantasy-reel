import { defineTour } from '../types'

/** Every variant of the last step ends on this rule, since an offer may lose to another one. */
const COMPETING_OFFERS = 'Several offers can name the same movie. Only the first to go through happens, and the rest expire.'

/**
 * The Trading tab while trades are open: making an offer, answering one, and
 * when a trade actually goes through. Offers load after the page, so the
 * answering step stands centered when there's no card to point at yet.
 */
export const tradingTour = defineTour({
  id: 'trading',
  version: 1,
  title: 'Trading',
  description: 'Trading tab: making offers, answering them, and when a trade goes through.',
  when: (ctx) => ctx.leagueStatus === 'active' && ctx.tradesOpen === true,
  steps: [
    {
      anchor: 'propose-trade',
      title: 'Make an offer',
      body: 'Offer movies, counterpicks or Fantasy Budget for what another team holds. A movie that already has a score can’t be traded. You can set an offer to expire.',
    },
    {
      anchor: 'trade-respond',
      centerIfMissing: true,
      title: 'When an offer comes in',
      body: 'Accept it, reject it, or counter with changes. A counter goes back to them to answer. If the offer shows an expiry, answer before then or it lapses.',
    },
    {
      when: (ctx) => ctx.reviewEnabled === true && ctx.isOwner !== true,
      title: 'When a trade goes through',
      body: [
        'Nothing moves when the other team accepts. The commissioner gets a review period to approve it early or veto it. If they do neither, it goes through when the period ends.',
        COMPETING_OFFERS,
      ],
    },
    {
      when: (ctx) => ctx.reviewEnabled === true && ctx.isOwner === true,
      title: 'When a trade goes through',
      body: [
        'Nothing moves when the other team accepts. As commissioner, you get a review period to approve the trade early or veto it. If you do neither, it goes through when the period ends.',
        COMPETING_OFFERS,
      ],
    },
    {
      when: (ctx) => ctx.reviewEnabled !== true,
      title: 'When a trade goes through',
      body: [
        'Once the other team accepts, the trade goes through shortly after.',
        COMPETING_OFFERS,
      ],
    },
  ],
})
