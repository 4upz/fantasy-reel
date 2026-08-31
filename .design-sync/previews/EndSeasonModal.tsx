import { EndSeasonModal } from 'fantasy-reel'
import { Stage } from './_stage'
import { daysOut } from './_fixtures'

const noop = () => {}

const standings = [
  {
    team_id: 't1',
    team_name: 'Academy Aces',
    participant_id: 'p1',
    user_id: 'u1',
    total_points: 345,
    rank: 1,
    is_tied: false,
  },
  {
    team_id: 't2',
    team_name: 'Golden Globe Gang',
    participant_id: 'p2',
    user_id: 'u2',
    total_points: 339,
    rank: 2,
    is_tied: false,
  },
  {
    team_id: 't3',
    team_name: 'Award Hunters',
    participant_id: 'p3',
    user_id: 'u3',
    total_points: 288,
    rank: 3,
    is_tied: false,
  },
]

/**
 * Ending on schedule. The confirm button stays disabled until the season year
 * is typed — the resting state of this modal is "cannot proceed".
 */
export const Default = () => (
  <Stage width={820} height={720}>
    <EndSeasonModal
      leagueId="preview"
      seasonYear={2026}
      seasonEnd={daysOut(0)}
      standings={standings}
      isLoadingStandings={false}
      onClose={noop}
      onCompleted={noop}
    />
  </Stage>
)

/** Ending early raises a warning that counts the days being cut short. */
export const EndingEarly = () => (
  <Stage width={820} height={780}>
    <EndSeasonModal
      leagueId="preview"
      seasonYear={2026}
      seasonEnd={daysOut(125)}
      standings={standings}
      isLoadingStandings={false}
      onClose={noop}
      onCompleted={noop}
    />
  </Stage>
)

/** A tie at the top is named as a shared title, never broken by the UI. */
export const SharedTitle = () => (
  <Stage width={820} height={720}>
    <EndSeasonModal
      leagueId="preview"
      seasonYear={2026}
      seasonEnd={daysOut(0)}
      standings={[
        { ...standings[0], is_tied: true },
        { ...standings[1], total_points: 345, rank: 1, is_tied: true },
        { ...standings[2], rank: 3 },
      ]}
      isLoadingStandings={false}
      onClose={noop}
      onCompleted={noop}
    />
  </Stage>
)
