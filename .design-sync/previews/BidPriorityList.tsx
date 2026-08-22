import { BidPriorityList } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

const bid = (
  id: string,
  priority: number,
  amount: number,
  title: string,
  poster_url: string,
  /** Set to give the bid a conditional drop, which makes it slot-neutral. */
  conditional_drop_pickup_id: string | null = null
) =>
  ({
    id,
    league_id: '11111111-1111-4111-8111-111111111111',
    team_id: 'aaaaaaa1-1111-4111-8111-111111111111',
    tmdb_id: 693134,
    movie_data: { title, poster_url, release_date: daysOut(30) },
    amount,
    status: 'active',
    priority,
    conditional_drop_draft_pick_id: null,
    conditional_drop_pickup_id,
    created_at: daysOut(-1),
    countered_at: null,
    response_deadline: null,
    processing_deadline: daysOut(2),
  }) as never

const plain = [
  bid('b1', 1, 24, 'Dune: Part Two', POSTERS.dune),
  bid('b2', 2, 18, 'Kingdom of the Planet of the Apes', POSTERS.apes),
  bid('b3', 3, 11, 'Godzilla x Kong', POSTERS.godzilla),
  bid('b4', 4, 7, 'The Garfield Movie', POSTERS.garfield),
]

const onReorder = async () => ({ success: true })

/**
 * Two roster slots left, four bids. Priority decides which two the team keeps;
 * the rest fall through to the runner-up rather than going unawarded.
 */
export const Default = () => (
  <div className="max-w-lg">
    <BidPriorityList bids={plain} slots={6} used={4} onReorder={onReorder} />
  </div>
)

/**
 * The case that distinguishes this list from the counterpick one. The roster is
 * **full**, so a plain count would cut every row — but the third bid carries a
 * conditional drop, bringing its own slot. It stays live below the line and is
 * marked accordingly.
 */
export const ConditionalDropBelowTheCut = () => (
  <div className="max-w-lg">
    <BidPriorityList
      bids={[
        plain[0],
        plain[1],
        bid('b3', 3, 11, 'Godzilla x Kong', POSTERS.godzilla, 'p-0001'),
        plain[3],
      ]}
      slots={4}
      used={4}
      onReorder={onReorder}
    />
  </div>
)

/** Fewer bids than free slots: nothing gets cut. */
export const AllWithinRoster = () => (
  <div className="max-w-lg">
    <BidPriorityList bids={plain.slice(0, 2)} slots={8} used={2} onReorder={onReorder} />
  </div>
)
