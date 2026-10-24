import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Draft tab while the draft runs. It is the one home of the scoring rule,
 * because this is the first time a player commits to a choice that scores.
 */
export const draftRoomTour = defineTour<{
  leagueStatus: LeagueStatus
  newPlayer: boolean
  draftComplete: boolean
  doublePoints: boolean
}>({
  id: 'draft-room',
  version: 1,
  title: 'The draft',
  description: 'Draft tab during the draft: turns, how movies score, and picking.',
  when: (ctx) => ctx.leagueStatus === 'drafting' && ctx.draftComplete !== true,
  autoStart: (ctx) => ctx.newPlayer === true,
  steps: [
    {
      anchor: 'draft-turn',
      title: 'Whose turn it is',
      body: 'Teams pick one at a time, and the order reverses each round. There’s no timer: the draft waits for whoever is picking. This lights up when it’s your turn.',
    },
    {
      title: 'How movies score',
      body: (ctx) => [
        'A movie scores its Tomatometer minus 60, from release day. 84% earns 24 points, 60% earns nothing, and flops cost you.',
        ...(ctx.doublePoints ? ['Your league doubles points above 90%, so each point over 90 counts twice.'] : []),
      ],
    },
    {
      anchor: 'movie-picker',
      title: 'Pick a movie',
      body: 'Browse and search any time; you can pick only on your turn. Only upcoming movies with a release date can be drafted, and once a team takes one, it’s gone. The Wishlist tab shows the movies you saved.',
    },
  ],
})
