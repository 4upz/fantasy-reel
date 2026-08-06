import { CounterpickBidCard } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

const bid = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'c1111111-1111-4111-8111-111111111111',
    league_id: '11111111-1111-4111-8111-111111111111',
    team_id: 'aaaaaaa1-1111-4111-8111-111111111111',
    movie_id: 'mmmmmmm1-1111-4111-8111-111111111111',
    target_team_id: 'bbbbbbb1-1111-4111-8111-111111111111',
    draft_pick_id: 'ddddddd1-1111-4111-8111-111111111111',
    amount: 14,
    priority: 1,
    status: 'active',
    created_at: daysOut(-1),
    countered_at: null,
    response_deadline: null,
    processing_deadline: daysOut(2),
    movies: {
      title: 'Dune: Part Two',
      poster_url: POSTERS.dune,
      release_date: daysOut(30),
      fantasy_points: null,
    },
    target_team: { name: 'Nolan’s Eleven' },
    ...over,
  }) as never

const noop = () => {}

/** A counterpick bid names both the movie and the team it is aimed at. */
export const Active = () => (
  <div className="max-w-md">
    <CounterpickBidCard bid={bid()} isOwner onCancel={noop} onCounter={noop} />
  </div>
)

/** Outbid gets a warning tint and a pulse — it is the state that needs action. */
export const Outbid = () => (
  <div className="max-w-md">
    <CounterpickBidCard
      bid={bid({ status: 'outbid', amount: 11, response_deadline: daysOut(1) })}
      isOwner
      onCounter={noop}
    />
  </div>
)

export const Statuses = () => (
  <div className="flex flex-col gap-3 max-w-md">
    <CounterpickBidCard bid={bid({ status: 'active' })} isOwner={false} />
    <CounterpickBidCard
      bid={bid({ status: 'outbid', amount: 11, response_deadline: daysOut(1) })}
      isOwner={false}
    />
    <CounterpickBidCard
      bid={bid({
        status: 'won',
        amount: 22,
        movies: {
          title: 'Godzilla x Kong: The New Empire',
          poster_url: POSTERS.godzilla,
          release_date: daysOut(-10),
          fantasy_points: 12,
        },
        target_team: { name: 'The Godfathers' },
      })}
      isOwner={false}
    />
    <CounterpickBidCard
      bid={bid({
        status: 'lost',
        amount: 6,
        movies: {
          title: 'The Garfield Movie',
          poster_url: POSTERS.garfield,
          release_date: daysOut(-40),
          fantasy_points: -16,
        },
        target_team: { name: 'Kubrick’s Odyssey' },
      })}
      isOwner={false}
    />
  </div>
)

/** A rival's bid: no management controls. */
export const NotOwner = () => (
  <div className="max-w-md">
    <CounterpickBidCard bid={bid()} isOwner={false} />
  </div>
)
