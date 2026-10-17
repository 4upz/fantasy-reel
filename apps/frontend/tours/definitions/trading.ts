import { defineTour, type TourContext } from '../types'

const COMPETING_OFFERS = 'Several offers can name the same movie. The first to go through gets it, and the others expire.'

/** What happens after a yes: straight through, or a review period of the league's `trade_veto_hours`. */
function afterAccept(ctx: TourContext): string {
  if (ctx.reviewEnabled !== true) return 'Once the other team accepts, the trade goes through shortly after, as long as it’s still valid.'
  const period = typeof ctx.reviewHours === 'number' ? `a ${ctx.reviewHours}-hour review period` : 'a review period'
  return ctx.isOwner === true
    ? `Nothing moves when the other team accepts. As commissioner, you get ${period} to approve it early or veto it. If you do neither, it goes through when the period ends.`
    : `Nothing moves when the other team accepts. The commissioner gets ${period} to approve it early or veto it. If they do neither, it goes through when the period ends.`
}

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
      body: 'Offer movies, counterpicks or Fantasy Budget for what another team holds. A movie with a score, or a counterpick on one, can’t be traded. You can set an offer to expire.',
    },
    {
      anchor: 'trade-respond',
      centerIfMissing: true,
      title: 'When an offer comes in',
      body: 'Accept it, reject it, or counter with changes. A counter goes back to them to answer. If the offer shows an expiry, answer before then or it lapses.',
    },
    {
      title: 'When a trade goes through',
      body: (ctx) => [
        afterAccept(ctx),
        COMPETING_OFFERS,
      ],
    },
  ],
})
