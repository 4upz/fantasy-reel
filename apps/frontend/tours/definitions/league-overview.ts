import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The first tour after the draft, on the Overview tab: how the season is
 * scored and won, and the moves a team has between releases. The Roster,
 * Bidding and Trading tours teach each move in detail.
 */
export const leagueOverviewTour = defineTour<{ leagueStatus: LeagueStatus; tradesOpen: boolean; dropLimit: number; doublePoints: boolean; firstSeason: boolean }>({
  id: 'league-overview',
  version: 1,
  title: 'Your season',
  description: 'Overview tab: how movies score, when points count, and how to improve your team.',
  when: (ctx) => ctx.leagueStatus === 'active',
  autoStart: (ctx) => ctx.firstSeason,
  steps: [
    {
      title: 'Critics decide your score',
      body: (ctx) => [
        'Each movie scores from its Rotten Tomatoes Tomatometer: every point above 60% earns a point, and a flop costs you.',
        ...(ctx.doublePoints ? ['This season, each point above 90% counts double.'] : []),
      ],
    },
    {
      anchor: 'team-summary',
      title: 'Points count from release day',
      body: 'A movie adds nothing until it opens. If critics score it early, you’ll see it marked “at release” until then. The team with the most points when the season ends wins.',
    },
    {
      anchor: 'league-nav',
      title: 'Improve your team between releases',
      body: (ctx) => [
        'Bid for unscored movies no team holds; bids settle weekly.',
        ctx.tradesOpen && 'Trade movies, counterpicks or Fantasy Budget with other teams.',
        ctx.dropLimit !== 0 && 'Drop a movie that’s lost its buzz, before it opens, to make room.',
      ].filter(Boolean).join(' '),
    },
  ],
})
