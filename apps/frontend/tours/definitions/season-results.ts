import { defineTour } from '../types'

/**
 * The Overview tab once a season is over. Its own id, so players who finished
 * the in-season overview tour still see it.
 */
export const seasonResultsTour = defineTour({
  id: 'season-results',
  version: 1,
  title: 'Season results',
  description: 'Overview tab, once a season ends: what the final standings mean and what comes next.',
  when: (ctx) => ctx.leagueStatus === 'completed',
  steps: [
    {
      anchor: 'season-results',
      title: 'The season is over',
      body: 'These standings are final. Bids that hadn’t settled were cancelled without charge, and open trade offers expired. Teams tied for first share the title.',
    },
    {
      when: (ctx) => ctx.isOwner === true && ctx.hasNextSeason !== true,
      title: 'Start the next season',
      body: 'As commissioner, you can open a new season of this league from the results. Rosters start empty, and you set up a new draft.',
    },
  ],
})
