import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Draft tab before the draft, for the commissioner: getting players in,
 * then starting. The dashboard's Next step card already says to check
 * Settings, so this tour only reminds them before the button that locks it.
 */
export const leagueSetupTour = defineTour<{ isOwner: boolean; leagueStatus: LeagueStatus; newPlayer: boolean }>({
  id: 'league-setup',
  version: 1,
  title: 'Setting up your league',
  description: 'Draft tab before the draft: getting players in and starting the draft.',
  when: (ctx) => ctx.isOwner === true && ctx.leagueStatus === 'setup',
  autoStart: (ctx) => ctx.newPlayer === true,
  steps: [
    {
      anchor: 'join-link',
      title: 'Get your players in',
      body: 'Generate a join link to share, or use Invite players to send email invitations. People can join until you start the draft.',
    },
    {
      anchor: 'start-draft',
      title: 'Start the draft',
      body: [
        'You need at least 2 players. Teams take turns picking on this page, and there’s no timer.',
        'Check Settings first: starting closes the league to new players, and most settings lock.',
      ],
    },
  ],
})
