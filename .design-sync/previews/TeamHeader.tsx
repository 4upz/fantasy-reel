import { TeamHeader } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

const movies = [
  {
    id: 'm1',
    tmdb_id: 693134,
    title: 'Dune: Part Two',
    poster_url: POSTERS.dune,
    release_date: daysOut(-120),
    status: 'scored' as const,
    combined_score: 92,
    fantasy_points: 34,
  },
  {
    id: 'm2',
    tmdb_id: 653346,
    title: 'Kingdom of the Planet of the Apes',
    poster_url: POSTERS.apes,
    release_date: daysOut(14),
    status: 'releasing_soon' as const,
    combined_score: null,
    fantasy_points: null,
  },
  {
    id: 'm3',
    tmdb_id: 823464,
    title: 'Godzilla x Kong',
    poster_url: POSTERS.godzilla,
    release_date: daysOut(200),
    status: 'upcoming' as const,
    combined_score: null,
    fantasy_points: null,
  },
]

const team = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'aaaaaaa1-1111-4111-8111-111111111111',
    name: 'The Spielbergs',
    avatar_url: null,
    total_points: 214,
    rank: 1,
    movies,
    ...over,
  }) as never

const noop = () => {}

/** Rank 1 gets gold with a trophy; the points readout is gold when positive. */
export const Leader = () => (
  <div className="max-w-2xl">
    <TeamHeader team={team()} totalTeams={8} />
  </div>
)

/** Podium ranks are medal-coloured — gold, silver, bronze — and everything
    below falls back to a neutral chip with no trophy. */
export const Ranks = () => (
  <div className="flex flex-col gap-4 max-w-2xl">
    <TeamHeader team={team({ rank: 1, total_points: 214 })} totalTeams={8} />
    <TeamHeader team={team({ name: 'Nolan’s Eleven', rank: 2, total_points: 188 })} totalTeams={8} />
    <TeamHeader team={team({ name: 'The Godfathers', rank: 3, total_points: 141 })} totalTeams={8} />
    <TeamHeader
      team={team({ name: 'Kubrick’s Odyssey', rank: 6, total_points: 47 })}
      totalTeams={8}
    />
  </div>
)

/** A team underwater on points reads crimson. */
export const NegativePoints = () => (
  <div className="max-w-2xl">
    <TeamHeader
      team={team({ name: 'Kubrick’s Odyssey', rank: 8, total_points: -36 })}
      totalTeams={8}
    />
  </div>
)

/** Passing onEditTeam reveals the inline edit control beside the name. */
export const Editable = () => (
  <div className="max-w-2xl">
    <TeamHeader team={team()} totalTeams={8} onEditTeam={noop} />
  </div>
)
