import type { LeagueStatus } from '@/types'
import { defineTour } from '../types'

/**
 * League settings before the draft. Replay only: the fields carry their own
 * helper text and the setup tour already points here, so this never starts by
 * itself; "Show me around" plays it.
 */
export const leagueSettingsTour = defineTour<{ leagueStatus: LeagueStatus }>({
  id: 'league-settings',
  version: 1,
  title: 'League settings',
  description: 'Settings before the draft: draft order, scoring, roster and counterpick slots.',
  when: (ctx) => ctx.leagueStatus === 'setup',
  autoStart: () => false,
  steps: [
    {
      anchor: 'settings-draft-order',
      title: 'Draft order',
      body: 'Who picks first. Drag teams into order or randomize it. The order snakes: whoever picks last in one round picks first in the next.',
    },
    {
      anchor: 'settings-scoring',
      title: 'Scoring',
      body: 'Double points above 90% makes every point over 90 count twice. You can change it until the draft is over.',
    },
    {
      anchor: 'settings-roster',
      title: 'Roster and counterpicks',
      body: 'Draft slots fill at the draft and the rest fill by bidding during the season. Counterpick slots set how many counterpicks each team gets: a counterpick scores a rival’s movie in reverse. Both lock when the draft starts.',
    },
  ],
})
