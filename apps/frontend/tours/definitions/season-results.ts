import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Overview tab once a season is over. Its own id, so players who finished
 * the in-season overview tour still see it.
 */
export const seasonResultsTour = defineTour<{ leagueStatus: LeagueStatus; isOwner: boolean; hasNextSeason: boolean }>({
  id: 'season-results',
  version: 1,
  title: 'Season results',
  description: 'Overview tab, once a season ends: what the final standings mean and what comes next.',
  when: (ctx) => ctx.leagueStatus === 'completed',
  steps: [
    {
      anchor: 'season-results',
      title: 'See how the season finished',
      body: 'This result is final. Bids that hadn’t settled were cancelled without charge, and open trade offers expired. Teams tied for first share the title.',
    },
    {
      anchor: 'start-next-season',
      centerIfMissing: true,
      when: (ctx) => ctx.isOwner && !ctx.hasNextSeason,
      title: 'Start the next season',
      body: 'As commissioner, you start the next season from the results. Members and settings carry over, rosters start empty, and you set up a new draft.',
    },
  ],
})
