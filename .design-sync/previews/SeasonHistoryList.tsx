import { SeasonHistoryList } from 'fantasy-reel'

/** A league four years in: the running season leads, champions below it. */
export const Default = () => (
  <div className="max-w-2xl">
    <SeasonHistoryList
      rows={[
        {
          leagueId: 'l-2026',
          seasonYear: 2026,
          isCompleted: false,
          champions: [],
          championPoints: null,
          runnersUp: [],
          isCurrent: true,
        },
        {
          leagueId: 'l-2025',
          seasonYear: 2025,
          isCompleted: true,
          champions: ['Academy Aces'],
          championPoints: 345,
          runnersUp: [
            { rank: 2, name: 'Golden Globe Gang' },
            { rank: 3, name: 'Award Hunters' },
          ],
          isCurrent: false,
        },
        {
          leagueId: 'l-2024',
          seasonYear: 2024,
          isCompleted: true,
          champions: ['Award Hunters'],
          championPoints: 291,
          runnersUp: [
            { rank: 2, name: 'Academy Aces' },
            { rank: 3, name: 'Reel Talk' },
          ],
          isCurrent: false,
        },
      ]}
    />
  </div>
)

/** A shared title, and the 3rd place it pushes the next team into. */
export const SharedTitle = () => (
  <div className="max-w-2xl">
    <SeasonHistoryList
      rows={[
        {
          leagueId: 'l-2025',
          seasonYear: 2025,
          isCompleted: true,
          champions: ['Academy Aces', 'Award Hunters'],
          championPoints: 345,
          runnersUp: [{ rank: 3, name: 'Golden Globe Gang' }],
          isCurrent: false,
        },
      ]}
    />
  </div>
)
