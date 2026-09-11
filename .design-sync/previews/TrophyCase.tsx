import { TrophyCase } from 'fantasy-reel'

/** Three titles. Year in mono, league name in body text, newest first. */
export const Default = () => (
  <div className="max-w-xs">
    <TrophyCase
      titles={[
        { leagueId: 'l-2026', seriesName: 'Oscar Contenders', seasonYear: 2026 },
        { leagueId: 'l-2025', seriesName: 'Oscar Contenders', seasonYear: 2025 },
        { leagueId: 'l-2023', seriesName: 'Reel Talk', seasonYear: 2023 },
      ]}
    />
  </div>
)

/** The zero state is shown, never hidden — an empty case is a hook. */
export const NoTitles = () => (
  <div className="max-w-xs">
    <TrophyCase titles={[]} />
  </div>
)

/** Past the cap, the remainder is counted rather than listed. */
export const Truncated = () => (
  <div className="max-w-xs">
    <TrophyCase
      titles={[2026, 2025, 2024, 2023, 2022, 2021, 2020].map((year) => ({
        leagueId: `l-${year}`,
        seriesName: 'Oscar Contenders',
        seasonYear: year,
      }))}
    />
  </div>
)
