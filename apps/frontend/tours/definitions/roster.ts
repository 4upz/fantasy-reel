import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Roster tab during a season: drops and counterpicks. The drop dialog
 * explains why a movie is locked, so the tour leaves locks to it.
 */
export const rosterTour = defineTour<{ leagueStatus: LeagueStatus; dropLimit: number; counterpicksEnabled: boolean; firstSeason: boolean }>({
  id: 'roster',
  version: 1,
  title: 'Your roster',
  description: 'Roster tab: dropping movies and your counterpicks.',
  when: (ctx) => ctx.leagueStatus === 'active' && (ctx.dropLimit !== 0 || ctx.counterpicksEnabled),
  autoStart: (ctx) => ctx.firstSeason,
  steps: [
    {
      anchor: 'roster-drops',
      when: (ctx) => ctx.dropLimit !== 0,
      title: 'Drops are limited',
      body: (ctx) =>
        `You get ${ctx.dropLimit} ${ctx.dropLimit === 1 ? 'drop' : 'drops'} for the season. A drop frees the slot for a pickup, is permanent and refunds nothing.`,
    },
    {
      // Only cards that can be dropped carry this anchor, so the step drops out when none can.
      anchor: 'roster-movie',
      title: 'Drop before it opens',
      body: 'Open a movie to drop it. Do it before release day: once a movie opens, it can’t be dropped.',
    },
    {
      anchor: 'roster-counterpicks',
      when: (ctx) => ctx.counterpicksEnabled,
      title: 'Your counterpicks',
      body: 'A counterpick scores a rival’s movie in reverse, and stays yours even if they drop it.',
    },
  ],
})
