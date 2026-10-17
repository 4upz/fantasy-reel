import { defineTour } from '../types'

/**
 * The first tour after the draft, on the Overview tab: how the season is
 * scored and won, and the moves a team has between releases. The Roster,
 * Bidding and Trading tours teach each move in detail.
 */
export const leagueOverviewTour = defineTour({
  id: 'league-overview',
  version: 1,
  title: 'Your season',
  description: 'Overview tab: how movies score, when points count, and how to improve your team.',
  when: (ctx) => ctx.leagueStatus === 'active',
  steps: [
    {
      title: 'Critics decide your score',
      body: 'Each movie scores from its Rotten Tomatoes Tomatometer. 60% is worth nothing, every point above it earns a point, and lower scores cost you, though the loss eases off below 50%.',
    },
    {
      anchor: 'team-summary',
      title: 'Points count from release day',
      body: 'A movie adds nothing until it opens. If critics score it early, you’ll see that score muted until release day. The team with the most points when the season ends wins.',
    },
    {
      anchor: 'league-nav',
      when: (ctx) => ctx.tradesOpen === true,
      title: 'Improve your team between releases',
      body: 'Bid for movies no team holds; bids settle once a week. Trade movies, counterpicks or Fantasy Budget with other teams. If your league allows drops, drop a movie that’s lost its buzz to make room.',
    },
    {
      anchor: 'league-nav',
      when: (ctx) => ctx.tradesOpen !== true,
      title: 'Improve your team between releases',
      body: 'Bid for movies no team holds; bids settle once a week. If your league allows drops, drop a movie that’s lost its buzz to make room.',
    },
  ],
})
