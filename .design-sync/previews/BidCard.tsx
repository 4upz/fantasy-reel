import { BidCard } from 'fantasy-reel'
import { movie, POSTERS, daysOut } from './_fixtures'

const bid = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'b1111111-1111-4111-8111-111111111111',
    league_id: '11111111-1111-4111-8111-111111111111',
    team_id: 'aaaaaaa1-1111-4111-8111-111111111111',
    tmdb_id: 693134,
    movie_data: movie(),
    amount: 24,
    status: 'active',
    created_at: daysOut(-1),
    countered_at: null,
    response_deadline: null,
    processing_deadline: daysOut(2),
    ...over,
  }) as never

const noop = () => {}

/** A live bid the current team owns — cancel and counter controls available. */
export const Active = () => (
  <div className="max-w-md">
    <BidCard bid={bid()} isOwner onCancel={noop} onCounter={noop} />
  </div>
)

/**
 * `outbid` is the only status with its own treatment — a warning border, tint
 * and pulse, plus the counter action. `won`, `lost` and `cancelled` render
 * exactly like `active`, so do not rely on this card alone to communicate a
 * resolved bid.
 */
export const ActiveVsOutbid = () => (
  <div className="flex flex-col gap-3 max-w-md">
    <BidCard bid={bid({ status: 'active' })} isOwner={false} />
    <BidCard
      bid={bid({
        status: 'outbid',
        amount: 18,
        response_deadline: daysOut(1),
        movie_data: movie({ tmdb_id: 653346, title: 'Kingdom of the Planet of the Apes', poster_url: POSTERS.apes }),
      })}
      isOwner
      onCounter={noop}
    />
  </div>
)

/** A team's full bid board — several live bids at different amounts. */
export const BidBoard = () => (
  <div className="flex flex-col gap-3 max-w-md">
    <BidCard bid={bid({ amount: 24 })} isOwner onCancel={noop} />
    <BidCard
      bid={bid({
        amount: 31,
        movie_data: movie({ tmdb_id: 823464, title: 'Godzilla x Kong: The New Empire', poster_url: POSTERS.godzilla }),
      })}
      isOwner
      onCancel={noop}
    />
    <BidCard
      bid={bid({
        amount: 9,
        movie_data: movie({ tmdb_id: 748783, title: 'The Garfield Movie', poster_url: POSTERS.garfield }),
      })}
      isOwner
      onCancel={noop}
    />
  </div>
)

/** Without `isOwner` the management controls are hidden — this is how a rival's
    bid appears. */
export const NotOwner = () => (
  <div className="max-w-md">
    <BidCard bid={bid()} isOwner={false} />
  </div>
)

/** `bidType="counterpick"` re-tints the card for the counterpick phase. */
export const CounterpickBid = () => (
  <div className="max-w-md">
    <BidCard bid={bid({ amount: 12 })} isOwner bidType="counterpick" onCancel={noop} />
  </div>
)
