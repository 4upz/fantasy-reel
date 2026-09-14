import { Clock } from 'lucide-react'
import BidSummary, { BidAmountDisplay } from '../../(authenticated)/league/[id]/components/BidSummary'
import TradeItemsSection from '../../(authenticated)/league/[id]/components/TradeItemsSection'
import { EXAMPLE_MOVIES } from './example-movies'

const NO_CONTESTED_MOVIES: ReadonlySet<string> = new Set()
const [receivedMovie, offeredMovie, , pickupMovie] = EXAMPLE_MOVIES

/** Static examples use the app's bid summary and two sides of a trade offer. */
export default function MovesPreviewScene() {
  return (
    <div className="bg-background p-6 text-left" style={{ width: 800, height: 470 }}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="type-section text-foreground">Active bids</h3>
        <span className="type-meta text-foreground-secondary">Example league</span>
      </div>

      <div className="card bid-card-pickup p-4">
        <div className="flex gap-4">
          <BidSummary title={pickupMovie.title} posterUrl={`/images/homepage/${pickupMovie.poster}.webp`} focus="bid">
            <p className="type-body-sm mt-0.5 text-foreground-secondary">Pickup bid</p>
            <div className="mt-2 flex items-center gap-4">
              <BidAmountDisplay amount={15} />
              <span className="type-body-sm flex items-center gap-1.5 text-foreground-secondary">
                <Clock className="h-4 w-4" aria-hidden="true" />
                Awaiting results
              </span>
            </div>
          </BidSummary>
          <span className="type-meta h-fit rounded bg-gold-muted px-2 py-1 text-gold">Active</span>
        </div>
      </div>

      <div className="card mt-5 p-4">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="type-row-title text-foreground">Opening Night → Second Take</h3>
            <p className="type-meta text-foreground-secondary">Trade offer</p>
          </div>
          <span className="type-meta rounded bg-info-bg px-2 py-1 text-info">Proposed</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <TradeItemsSection
            title="Opening Night sends"
            items={{
              movies: [{ movie_id: `example-${offeredMovie.poster}`, source: 'draft_pick', source_id: `example-${offeredMovie.poster}-pick`, title: offeredMovie.title, poster_url: `/images/homepage/${offeredMovie.poster}.webp` }],
              faab: 10,
            }}
            isYours
            contestedSourceIds={NO_CONTESTED_MOVIES}
          />
          <div>
            <TradeItemsSection
              title="Second Take sends"
              items={{
                movies: [{ movie_id: `example-${receivedMovie.poster}`, source: 'draft_pick', source_id: `example-${receivedMovie.poster}-pick`, title: receivedMovie.title, poster_url: `/images/homepage/${receivedMovie.poster}.webp` }],
                faab: 0,
              }}
              isYours={false}
              contestedSourceIds={NO_CONTESTED_MOVIES}
              focus="trade"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
