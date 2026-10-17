import { defineTour } from '../types'

/** The Standings tab during a season: how teams are ranked, and what can still move them. */
export const standingsTour = defineTour({
  id: 'standings',
  version: 1,
  title: 'Standings',
  description: 'Standings tab: how teams are ranked and what can still change the order.',
  when: (ctx) => ctx.leagueStatus === 'active',
  steps: [
    {
      anchor: 'standings-summary',
      title: 'Pending movies can still move the table',
      body: 'Points so far come only from movies that have opened and have a score. Every pending movie can still change the order. Scores update every day.',
    },
    {
      anchor: 'standings-list',
      when: (ctx) => ctx.doublePoints !== true,
      title: 'Scout the other teams',
      body: 'Teams on the same total share a rank. Open any team to see the movies and counterpicks behind its score, and to spot a trade partner.',
    },
    {
      anchor: 'standings-list',
      when: (ctx) => ctx.doublePoints === true,
      title: 'Scout the other teams',
      body: 'This season, each point above 90% counts double. Teams on the same total share a rank. Open any team to see the movies and counterpicks behind its score.',
    },
  ],
})
