import { BidAmountDisplay, BidSummary } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

export const Default = () => (
  <div className="card flex items-start gap-4 p-4 max-w-md">
    <BidSummary title="Dune: Part Two" posterUrl={POSTERS.dune} releaseDate={daysOut(20)}>
      <div className="mt-2"><BidAmountDisplay amount={24} /></div>
    </BidSummary>
  </div>
)

export const WithoutArtwork = () => (
  <div className="card flex items-start gap-4 p-4 max-w-md">
    <BidSummary title="Upcoming release">
      <p className="type-body-sm text-foreground-secondary mt-2">Awaiting a release date</p>
    </BidSummary>
  </div>
)
