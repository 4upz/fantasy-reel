import { ErrorAlert } from 'fantasy-reel'

/** Unlike FormError, ErrorAlert always renders and carries its own bottom margin —
    it is the banner for a failed action, not a field validation message. */
export const Default = () => (
  <div className="max-w-lg">
    <ErrorAlert message="It's not your turn to pick." />
  </div>
)

export const AboveAForm = () => (
  <div className="max-w-lg">
    <ErrorAlert message="Could not place that bid — your remaining budget is $18." />
    <label className="block text-sm font-medium text-foreground mb-2">Bid amount</label>
    <input className="input w-full" defaultValue="25" />
  </div>
)

export const LongMessage = () => (
  <div className="max-w-lg">
    <ErrorAlert message="The draft window closed before this pick was submitted. The league has moved to the active season, so rosters are now locked until the bidding phase opens." />
  </div>
)
