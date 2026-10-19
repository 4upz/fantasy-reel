import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Draft tab during the counterpick round, for players with a team. The
 * commissioner also learns how to end a round nobody can finish.
 */
export const counterpickRoundTour = defineTour<{ isOwner: boolean; leagueStatus: LeagueStatus; newPlayer: boolean; hasTeam: boolean }>({
  id: 'counterpick-round',
  version: 1,
  title: 'The counterpick round',
  description: 'Draft tab during counterpicks: betting against other teams’ movies.',
  when: (ctx) => ctx.leagueStatus === 'counterpicking' && ctx.hasTeam === true,
  autoStart: (ctx) => ctx.newPlayer === true,
  steps: [
    {
      anchor: 'counterpick-turn',
      title: 'Bet against a rival',
      body: [
        'Each team picks a movie another team drafted and scores its points in reverse; the movie stays on its owner’s roster. If it flops at 35% you gain points; if it’s a hit at 84% you lose 24.',
        'Turns run in reverse of the draft order.',
      ],
    },
    {
      anchor: 'counterpick-picker',
      title: 'Choose your target',
      body: 'Pick the movie you expect critics to pan. You can’t counterpick your own movies. A counterpick doesn’t use a roster slot, and it keeps scoring even if its owner drops the movie.',
    },
    {
      anchor: 'end-counterpicks',
      when: (ctx) => ctx.isOwner === true,
      title: 'If the round stalls',
      body: 'When nobody has a movie left to target, end the remaining counterpicks here. Counterpicks already made are kept, and the season starts.',
    },
  ],
})
