import { PlaceCounterpickBidModal } from 'fantasy-reel'
import { Stage } from './_stage'
import { POSTERS, daysOut } from './_fixtures'

const budget = {
  id: 'bud1',
  team_id: 'aaaaaaa1-1111-4111-8111-111111111111',
  remaining_budget: 42,
  total_spent: 58,
  created_at: '2026-05-02T10:00:00Z',
  updated_at: '2026-05-02T10:00:00Z',
}

const counterpickBid = {
  id: 'c1111111-1111-4111-8111-111111111111',
  league_id: '11111111-1111-4111-8111-111111111111',
  team_id: 'aaaaaaa1-1111-4111-8111-111111111111',
  movie_id: 'mmmmmmm1-1111-4111-8111-111111111111',
  target_team_id: 'bbbbbbb1-1111-4111-8111-111111111111',
  draft_pick_id: 'ddddddd1-1111-4111-8111-111111111111',
  amount: 14,
  priority: 1,
  status: 'active' as const,
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
}

const noop = () => {}
const place = async () => ({ success: true })

/**
 * Bid entry for a counterpick slot. The list of counterpickable movies is
 * fetched from the league at open time, so in the design pane the picker
 * renders with an empty pool — the budget, amount entry and validation are
 * the parts that render fully.
 */
export const Open = () => (
  <Stage width={900} height={700}>
    <PlaceCounterpickBidModal
      isOpen
      onClose={noop}
      leagueId="11111111-1111-4111-8111-111111111111"
      teamId="aaaaaaa1-1111-4111-8111-111111111111"
      budget={budget}
      counterpickBids={[]}
      onPlaceCounterpickBid={place}
    />
  </Stage>
)

/** Countering an existing counterpick bid pre-targets the contested pick. */
export const CounterTarget = () => (
  <Stage width={900} height={700}>
    <PlaceCounterpickBidModal
      isOpen
      onClose={noop}
      leagueId="11111111-1111-4111-8111-111111111111"
      teamId="aaaaaaa1-1111-4111-8111-111111111111"
      budget={budget}
      counterpickBids={[counterpickBid] as never}
      onPlaceCounterpickBid={place}
      counterTarget={counterpickBid as never}
    />
  </Stage>
)
