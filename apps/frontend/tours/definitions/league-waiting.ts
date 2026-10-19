import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Draft tab before the draft, for a player who joined someone else's
 * league: what draft day looks like, what makes a good pick, and how to get
 * ready. The scoring rule itself is taught in the draft room.
 */
export const leagueWaitingTour = defineTour<{ isOwner: boolean; leagueStatus: LeagueStatus; newPlayer: boolean }>({
  id: 'league-waiting',
  version: 1,
  title: 'Waiting for the draft',
  description: 'Draft tab before the draft, for players: what happens on draft day and how to get ready.',
  when: (ctx) => ctx.isOwner !== true && ctx.leagueStatus === 'setup',
  autoStart: (ctx) => ctx.newPlayer === true,
  steps: [
    {
      anchor: 'draft-waiting',
      title: 'Draft day happens here',
      body: 'When the commissioner starts the draft, this page becomes the draft room. Teams take turns picking upcoming movies, the order reverses each round, and each movie can belong to only one team.',
    },
    {
      title: 'What makes a good pick',
      body: 'Draft movies you expect critics to love, not just ones you want to see. Scoring is Tomatometer-based, from release day.',
    },
    {
      anchor: 'wishlist-nav',
      centerIfMissing: true,
      title: 'Scout while you wait',
      body: 'Save movies you like to your Wishlist with the heart on any movie. The draft’s movie picker has a Wishlist tab, so your shortlist is right there on your turn.',
    },
  ],
})
