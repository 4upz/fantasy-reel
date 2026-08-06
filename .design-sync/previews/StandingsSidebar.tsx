import { StandingsSidebar } from 'fantasy-reel'

const entry = (
  rank: number,
  name: string,
  points: number,
  topMovie: { title: string; score: number } | null,
  isCurrentUser = false
) => ({
  rank,
  isTied: false,
  team: { id: `t${rank}`, name, avatar_url: null },
  total_points: points,
  topMovie,
  isCurrentUser,
})

const standings = [
  entry(1, 'The Spielbergs', 214, { title: 'Dune: Part Two', score: 92 }),
  entry(2, 'Nolan’s Eleven', 188, { title: 'A Quiet Place: Day One', score: 86 }, true),
  entry(3, 'The Godfathers', 141, { title: 'Godzilla x Kong', score: 74 }),
  entry(4, 'Kubrick’s Odyssey', -36, { title: 'The Garfield Movie', score: 35 }),
]

/** Podium ranks are medal-coloured; the current user's row is highlighted. */
export const Default = () => (
  <div className="max-w-sm">
    <StandingsSidebar leagueId="11111111-1111-4111-8111-111111111111" standings={standings} />
  </div>
)

/** Ties share a rank and are marked as tied. */
export const WithATie = () => (
  <div className="max-w-sm">
    <StandingsSidebar
      leagueId="11111111-1111-4111-8111-111111111111"
      standings={[
        { ...entry(1, 'The Spielbergs', 188, { title: 'Dune: Part Two', score: 92 }), isTied: true },
        { ...entry(1, 'Nolan’s Eleven', 188, { title: 'A Quiet Place: Day One', score: 86 }), isTied: true },
        entry(3, 'The Godfathers', 141, { title: 'Godzilla x Kong', score: 74 }),
      ]}
    />
  </div>
)

/** Before any movie has scored, teams sit at zero with no top movie. */
export const PreSeason = () => (
  <div className="max-w-sm">
    <StandingsSidebar
      leagueId="11111111-1111-4111-8111-111111111111"
      standings={[
        entry(1, 'The Spielbergs', 0, null),
        entry(1, 'Nolan’s Eleven', 0, null, true),
        entry(1, 'The Godfathers', 0, null),
      ]}
    />
  </div>
)
