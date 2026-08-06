import { AcceptConfirmModal } from 'fantasy-reel'
import { Stage } from './_stage'
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

const noop = () => {}
const noopAsync = async () => {}

/** Last check before a trade executes — spells out exactly what leaves and
    what arrives, from the accepting team's point of view. */
export const Default = () => (
  <Stage width={900} height={640}>
    <AcceptConfirmModal
      trade={trade()}
      currentTeamId={MY_TEAM}
      onClose={noop}
      onConfirm={noopAsync}
    />
  </Stage>
)

/** A multi-asset trade with FAAB moving both ways. */
export const MultiAsset = () => (
  <Stage width={900} height={700}>
    <AcceptConfirmModal
      trade={trade({
        initiator_items: {
          movies: [
            movieItem('m1', 'Kingdom of the Planet of the Apes', POSTERS.apes),
            movieItem('m3', 'Godzilla x Kong', POSTERS.godzilla),
          ],
          faab: 12,
        },
        recipient_items: {
          movies: [movieItem('m2', 'Dune: Part Two', POSTERS.dune)],
          faab: 3,
        },
      })}
      currentTeamId={MY_TEAM}
      onClose={noop}
      onConfirm={noopAsync}
    />
  </Stage>
)
