import { defineTour } from '../types'

/**
 * The dashboard, for someone who hasn't played a season yet: what the game is,
 * and the two ways into a league. Three steps at most; the invitation step
 * replaces the join step when an email invitation is waiting.
 */
export const welcomeTour = defineTour<{ loaded: boolean; newPlayer: boolean; hasPendingInvites: boolean }>({
  id: 'welcome',
  version: 1,
  title: 'Welcome to Fantasy Reel',
  description: 'Dashboard: what the game is, and how to start or join a league.',
  // Judged once the league list has loaded, never against a skeleton.
  when: (ctx) => ctx.loaded === true,
  autoStart: (ctx) => ctx.newPlayer === true,
  steps: [
    {
      anchor: 'how-to-play',
      centerIfMissing: true,
      title: 'Fantasy sports, for movies',
      body: [
        'Draft upcoming movies with friends. Once a movie is released, it scores points from its Rotten Tomatoes Tomatometer, and the team with the most points when the season ends wins.',
        'Find the full rules any time under How to play in the menu.',
      ],
    },
    {
      anchor: 'create-league',
      title: 'Run your own league',
      body: 'Create a league and you’re its commissioner: you invite players, set the rules and start the draft. The defaults work fine if you just want to play.',
    },
    {
      anchor: 'join-league',
      when: (ctx) => ctx.hasPendingInvites !== true,
      title: 'Join a friend’s league',
      body: 'Paste the code or link a commissioner sent you. Leagues take new players until their draft starts.',
    },
    {
      anchor: 'pending-invitations',
      when: (ctx) => ctx.hasPendingInvites === true,
      title: 'You’ve been invited',
      body: 'Accept an invitation to join that league and name your team. You’ll draft once its commissioner starts the draft.',
    },
  ],
})
