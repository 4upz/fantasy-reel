import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Standings tab during a season: what can still move the order, and
 * scouting other teams. Replay only: Overview, the tab before it, already
 * says points count from release day.
 */
export const standingsTour = defineTour<{ leagueStatus: LeagueStatus }>({
  id: 'standings',
  version: 1,
  title: 'Standings',
  description: 'Standings tab: how teams are ranked and what can still change the order.',
  when: (ctx) => ctx.leagueStatus === 'active',
  autoStart: () => false,
  steps: [
    {
      anchor: 'standings-summary',
      title: 'Pending movies can still move',
      body: 'Only movies that have opened with a score count so far. Every pending movie can still change the order.',
    },
    {
      anchor: 'standings-list',
      title: 'Scout the other teams',
      body: 'Teams on the same total share a rank. Open any team to see the movies and counterpicks behind its score, and to spot a trade partner.',
    },
  ],
})
