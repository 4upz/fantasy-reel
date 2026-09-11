import { SeasonWelcomeCard } from 'fantasy-reel'

/**
 * What a member sees on the dashboard of a season they were carried into. The
 * empty roster is explained before it can be misread as data loss.
 */
export const Default = () => (
  <div className="max-w-2xl">
    <SeasonWelcomeCard
      leagueId="preview-2027"
      seasonYear={2027}
      teamName="Golden Globe Gang"
      previousSeason={{ id: 'preview-2026', seasonYear: 2026 }}
    />
  </div>
)

/** A league's very first season has no standings to link back to. */
export const NoPreviousSeason = () => (
  <div className="max-w-2xl">
    <SeasonWelcomeCard
      leagueId="preview-first"
      seasonYear={2026}
      teamName="Reel Talk"
      previousSeason={null}
    />
  </div>
)
