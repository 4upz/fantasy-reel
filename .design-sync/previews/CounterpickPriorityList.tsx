import { CounterpickPriorityList } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

const bid = (
  id: string,
  priority: number,
  amount: number,
  title: string,
  poster_url: string,
  targetTeam: string
) =>
  ({
    id,
    league_id: '11111111-1111-4111-8111-111111111111',
    team_id: 'aaaaaaa1-1111-4111-8111-111111111111',
    movie_id: `m-${id}`,
    target_team_id: 'bbbbbbb1-1111-4111-8111-111111111111',
    draft_pick_id: `d-${id}`,
    amount,
    priority,
    status: 'active',
    created_at: daysOut(-1),
    countered_at: null,
    response_deadline: null,
    processing_deadline: daysOut(2),
    movies: { title, poster_url, release_date: daysOut(30), fantasy_points: null },
    target_team: { name: targetTeam },
  }) as never

const bids = [
  bid('c1', 1, 24, 'Dune: Part Two', POSTERS.dune, 'Nolan’s Eleven'),
  bid('c2', 2, 18, 'Kingdom of the Planet of the Apes', POSTERS.apes, 'The Godfathers'),
  bid('c3', 3, 11, 'Godzilla x Kong', POSTERS.godzilla, 'Kubrick’s Odyssey'),
  bid('c4', 4, 7, 'The Garfield Movie', POSTERS.garfield, 'The Godfathers'),
]

const onReorder = async () => ({ success: true })

/**
 * Ranks a team's pending counterpick bids. Priority decides which counterpicks
 * the team keeps when more bids win than it has slots for — so the cut line
 * between "will keep" and "will drop" is the point of the component.
 */
export const Default = () => (
  <div className="max-w-lg">
    <CounterpickPriorityList bids={bids} slots={2} used={0} onReorder={onReorder} />
  </div>
)

/** Slots already partly used — the cut line moves up accordingly. */
export const SlotsPartlyUsed = () => (
  <div className="max-w-lg">
    <CounterpickPriorityList bids={bids} slots={3} used={2} onReorder={onReorder} />
  </div>
)

/** Fewer bids than slots: nothing gets cut. */
export const AllWithinSlots = () => (
  <div className="max-w-lg">
    <CounterpickPriorityList bids={bids.slice(0, 2)} slots={4} used={0} onReorder={onReorder} />
  </div>
)
