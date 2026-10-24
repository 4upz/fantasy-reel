import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Draft tab while the draft runs. It carries the scoring rule, because
 * this is the first time a player commits to a choice that scores.
 */
export const draftRoomTour = defineTour<{ leagueStatus: LeagueStatus; newPlayer: boolean; draftComplete: boolean; draftCounterpicks: boolean }>({
  id: 'draft-room',
  version: 1,
  title: 'The draft',
  description: 'Draft tab during the draft: turns, what makes a good pick, and what comes next.',
  when: (ctx) => ctx.leagueStatus === 'drafting' && ctx.draftComplete !== true,
  autoStart: (ctx) => ctx.newPlayer === true,
  essential: true,
  steps: [
    {
      anchor: 'draft-turn',
      title: 'Whose turn it is',
      body: 'Teams pick one at a time, and the order reverses each round. There’s no timer: the draft waits for whoever is picking. This lights up when it’s your turn.',
    },
    {
      title: 'What makes a good pick',
      body: [
        'A movie scores its Rotten Tomatoes Tomatometer minus 60, from its release day: 84% earns 24 points and 60% earns nothing. Below 50% the penalty shrinks, bottoming out near −20.',
        'If your league doubles points above 90%, each point over 90 counts twice. The most points when the season ends wins.',
      ],
    },
    {
      anchor: 'movie-picker',
      title: 'Pick a movie',
      body: 'Browse and search any time; you can pick only on your turn. Only upcoming movies with a release date can be drafted, and once a team takes one, it’s gone. The Wishlist tab shows the movies you saved.',
    },
    {
      when: (ctx) => ctx.draftCounterpicks === true,
      title: 'After the last pick',
      body: 'The commissioner can run a counterpick round, where each team bets against another team’s movie and scores its points in reverse. Then the season starts.',
    },
    {
      when: (ctx) => ctx.draftCounterpicks !== true,
      title: 'After the last pick',
      body: 'The season starts. Movies score as they’re released, and, if your league has bidding on, you can spend your Fantasy Budget on movies nobody drafted.',
    },
  ],
})
