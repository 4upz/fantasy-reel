import { LoadingSpinner } from 'fantasy-reel'

export const Default = () => <LoadingSpinner />

export const WithMessage = () => <LoadingSpinner message="Loading upcoming releases…" />

export const Sizes = () => (
  <div className="flex items-center gap-8">
    <LoadingSpinner size="sm" message="Small" />
    <LoadingSpinner size="md" message="Medium" />
  </div>
)

/** Filling a panel while its contents load. */
export const InAPanel = () => (
  <div className="max-w-md p-6 rounded-lg bg-surface border border-border">
    <LoadingSpinner size="md" message="Processing bids…" />
  </div>
)
