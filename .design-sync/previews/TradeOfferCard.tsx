import { TradeOfferCard } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

const MY_TEAM = 'aaaaaaa1-1111-4111-8111-111111111111'
const THEIR_TEAM = 'bbbbbbb1-1111-4111-8111-111111111111'

const team = (id: string, name: string) => ({
  id,
  participant_id: `p-${id}`,
  name,
  avatar_url: null,
  created_at: '2026-05-02T10:00:00Z',
  updated_at: '2026-05-02T10:00:00Z',
})

const owner = (id: string, name: string, display_name: string) => ({
  id,
  name,
  avatar_url: null,
  display_name,
})

const movieItem = (movie_id: string, title: string, poster_url: string) => ({
  movie_id,
  source: 'draft_pick' as const,
  source_id: `dp-${movie_id}`,
  title,
  poster_url,
  release_date: daysOut(30),
})

const trade = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'ttttttt1-1111-4111-8111-111111111111',
    league_id: '11111111-1111-4111-8111-111111111111',
    initiator_team_id: THEIR_TEAM,
    recipient_team_id: MY_TEAM,
    initiator_items: {
      movies: [movieItem('m1', 'Kingdom of the Planet of the Apes', POSTERS.apes)],
      faab: 5,
    },
    recipient_items: {
      movies: [movieItem('m2', 'Dune: Part Two', POSTERS.dune)],
      faab: 0,
    },
    status: 'proposed',
    proposed_at: daysOut(-1),
    responded_at: null,
    accepted_at: null,
    review_ends_at: null,
    completed_at: null,
    initiator_message: 'Straight swap — you get the sci-fi upside, I get the safer floor.',
    response_message: null,
    veto_reason: null,
    created_at: daysOut(-1),
    updated_at: daysOut(-1),
    initiator_team: team(THEIR_TEAM, 'Nolan’s Eleven'),
    recipient_team: team(MY_TEAM, 'The Spielbergs'),
    ...over,
  }) as never

const tradeableMovies = [
  {
    movie_id: 'm2',
    source: 'draft_pick' as const,
    source_id: 'dp-m2',
    title: 'Dune: Part Two',
    poster_url: POSTERS.dune,
    release_date: daysOut(30),
    combined_score: 92,
    fantasy_points: 34,
  },
  {
    movie_id: 'm3',
    source: 'draft_pick' as const,
    source_id: 'dp-m3',
    title: 'Godzilla x Kong',
    poster_url: POSTERS.godzilla,
    release_date: daysOut(120),
    combined_score: null,
    fantasy_points: null,
  },
]

const ok = async () => ({ success: true })

const common = {
  currentTeamId: MY_TEAM,
  currentTeam: owner(MY_TEAM, 'The Spielbergs', 'Alice Spielberg'),
  isOwner: false,
  otherTeams: [owner(THEIR_TEAM, 'Nolan’s Eleven', 'Bob Nolan')],
  tradeableMovies,
  budget: { remaining_budget: 42, total_spent: 58 },
  onRespond: ok,
  onCounter: ok,
  onCancel: ok,
  onVeto: ok,
}

/** An incoming offer awaiting your response — accept / reject / counter. */
export const Incoming = () => (
  <div className="max-w-2xl">
    <TradeOfferCard trade={trade()} {...common} />
  </div>
)

/** An offer you sent: you can cancel it, not respond to it. */
export const Outgoing = () => (
  <div className="max-w-2xl">
    <TradeOfferCard
      trade={trade({
        initiator_team_id: MY_TEAM,
        recipient_team_id: THEIR_TEAM,
        initiator_team: team(MY_TEAM, 'The Spielbergs'),
        recipient_team: team(THEIR_TEAM, 'Nolan’s Eleven'),
        initiator_message: 'Need the floor more than the ceiling this week.',
      })}
      {...common}
    />
  </div>
)

/** Accepted trades sit in a review window before they execute. */
export const InReview = () => (
  <div className="max-w-2xl">
    <TradeOfferCard
      trade={trade({
        status: 'review',
        responded_at: daysOut(0),
        accepted_at: daysOut(0),
        review_ends_at: daysOut(1),
      })}
      {...common}
    />
  </div>
)

/** The league owner can veto during review — `isOwner` reveals that control. */
export const OwnerCanVeto = () => (
  <div className="max-w-2xl">
    <TradeOfferCard
      trade={trade({
        status: 'review',
        responded_at: daysOut(0),
        accepted_at: daysOut(0),
        review_ends_at: daysOut(1),
      })}
      {...common}
      isOwner
    />
  </div>
)

/** Resolved states carry their outcome and no actions. */
export const Resolved = () => (
  <div className="flex flex-col gap-4 max-w-2xl">
    <TradeOfferCard
      trade={trade({ status: 'completed', completed_at: daysOut(-1) })}
      {...common}
    />
    <TradeOfferCard
      trade={trade({
        status: 'rejected',
        responded_at: daysOut(-1),
        response_message: 'Passing — I need the sci-fi slot.',
      })}
      {...common}
    />
  </div>
)
