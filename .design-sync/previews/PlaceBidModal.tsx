import { PlaceBidModal } from 'fantasy-reel'
import { Stage } from './_stage'
import { movie, POSTERS, daysOut } from './_fixtures'

const budget = {
  id: 'bud1',
  team_id: 'aaaaaaa1-1111-4111-8111-111111111111',
  remaining_budget: 42,
  total_spent: 58,
  created_at: '2026-05-02T10:00:00Z',
  updated_at: '2026-05-02T10:00:00Z',
}

const existingBid = {
  id: 'b1111111-1111-4111-8111-111111111111',
  league_id: '11111111-1111-4111-8111-111111111111',
  team_id: 'aaaaaaa1-1111-4111-8111-111111111111',
  tmdb_id: 693134,
  movie_data: movie(),
  amount: 24,
  status: 'active' as const,
  created_at: daysOut(-1),
  countered_at: null,
  response_deadline: null,
  processing_deadline: daysOut(2),
}

const noop = () => {}
const place = async () => ({ success: true })

/** Bid entry with the team's remaining budget and quick-amount buttons. */
export const Open = () => (
  <Stage width={900} height={700}>
    <PlaceBidModal
      isOpen
      onClose={noop}
      budget={budget}
      existingBids={[]}
      draftedTmdbIds={[]}
      onPlaceBid={place}
    />
  </Stage>
)

/** Counter-bidding an existing bid pre-targets the movie being contested —
    this is the modal's fully-populated state, with quick amounts and the
    live-priced submit button. */
export const CounterBidding = () => (
  <Stage width={900} height={700}>
    <PlaceBidModal
      isOpen
      onClose={noop}
      budget={budget}
      existingBids={[]}
      draftedTmdbIds={[]}
      onPlaceBid={place}
      counterBidTarget={
        {
          ...existingBid,
          amount: 18,
          movie_data: movie({
            tmdb_id: 653346,
            title: 'Kingdom of the Planet of the Apes',
            overview: "Several generations following Caesar's reign.",
            poster_url: POSTERS.apes,
            vote_average: 7.1,
          }),
        } as never
      }
    />
  </Stage>
)

/** A team that has spent almost everything — the budget constraint is the
    thing the modal is really about. */
export const NearlyBrokeTeam = () => (
  <Stage width={900} height={700}>
    <PlaceBidModal
      isOpen
      onClose={noop}
      budget={{ ...budget, remaining_budget: 3, total_spent: 97 }}
      existingBids={[]}
      draftedTmdbIds={[]}
      onPlaceBid={place}
    />
  </Stage>
)
