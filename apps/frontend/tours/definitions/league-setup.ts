import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * The Draft tab before the draft, for the commissioner: the three things that
 * stand between a new league and draft day. Settings has its own tour.
 */
export const leagueSetupTour = defineTour<{ isOwner: boolean; leagueStatus: LeagueStatus; newPlayer: boolean }>({
  id: 'league-setup',
  version: 1,
  title: 'Setting up your league',
  description: 'Draft tab before the draft: getting players in, the rules, and starting the draft.',
  when: (ctx) => ctx.isOwner === true && ctx.leagueStatus === 'setup',
  autoStart: (ctx) => ctx.newPlayer === true,
  steps: [
    {
      anchor: 'join-link',
      title: 'Get your players in',
      body: 'Generate a join link to share, or use Invite players to send email invitations. People can join until you start the draft.',
    },
    {
      anchor: 'settings-tab',
      centerIfMissing: true,
      title: 'Check the rules in Settings',
      body: 'Settings holds the draft order, roster size, scoring and counterpicks. The defaults are fine to play with, but most of them lock once the draft starts. Settings has its own short tour.',
    },
    {
      anchor: 'start-draft',
      title: 'Start the draft',
      body: [
        'You need at least 2 players. The draft runs live on this page: teams take turns picking, and there’s no timer, so the draft waits for whoever is picking.',
        'Starting it closes the league to new players and locks the draft order.',
      ],
    },
  ],
})
