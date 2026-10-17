import { defineTour } from '../types'

/**
 * League settings before the draft, for the commissioner: the four settings
 * that change how the game plays, and when each one locks.
 */
export const leagueSettingsTour = defineTour({
  id: 'league-settings',
  version: 1,
  title: 'League settings',
  description: 'Settings before the draft: draft order, scoring, counterpicks and roster slots.',
  // The page is the commissioner's alone.
  when: (ctx) => ctx.leagueStatus === 'setup',
  autoStart: (ctx) => ctx.newPlayer === true,
  steps: [
    {
      anchor: 'settings-draft-order',
      title: 'Draft order',
      body: 'Who picks first. Drag teams into order or randomize it. The order snakes: whoever picks last in one round picks first in the next.',
    },
    {
      anchor: 'settings-scoring',
      title: 'Scoring',
      body: [
        'A movie scores its Tomatometer minus 60, so 84% earns 24 points. Below 50% the penalty shrinks, bottoming out near −20.',
        'Double points above 90% makes every point over 90 count twice. You can change it until the draft is over.',
      ],
    },
    {
      anchor: 'settings-counterpicks',
      title: 'Counterpicks',
      body: 'A counterpick bets against another team’s movie: you score its points in reverse. Draft counterpick slots add a round right after the draft, and bidding counterpick slots let teams bid for more during the season.',
    },
    {
      anchor: 'settings-roster',
      title: 'Roster slots',
      body: [
        'Draft slots fill at the draft. Any other roster slots fill during the season, when teams spend their Fantasy Budget bidding on movies nobody drafted. The drop limit caps how many movies a team can drop.',
        'Roster and counterpick settings lock when the draft starts.',
      ],
    },
  ],
})
