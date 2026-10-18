import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/** The Standings tab during a season: how teams are ranked, and what can still move them. */
export const standingsTour = defineTour<{ leagueStatus: LeagueStatus; doublePoints: boolean }>({
  id: 'standings',
  version: 1,
  title: 'Standings',
  description: 'Standings tab: how teams are ranked and what can still change the order.',
  when: (ctx) => ctx.leagueStatus === 'active',
  steps: [
    {
      anchor: 'standings-summary',
      title: 'Pending movies can still change the standings',
      body: 'Pending movies haven’t opened or haven’t been scored yet. Points so far come only from movies that have opened with a score, so every pending movie can still change the order as reviews come in.',
    },
    {
      anchor: 'standings-list',
      title: 'Scout the other teams',
      body: (ctx) => [
        ctx.doublePoints && 'This season, each point above 90% counts double.',
        'Teams on the same total share a rank. Open any team to see the movies and counterpicks behind its score, and to spot a trade partner.',
      ].filter(Boolean).join(' '),
    },
  ],
})
