'use client'

import { useModalDialog } from '@/hooks/useModalDialog'

export interface TradeComposerState {
  isLoading: boolean
  error: string | null
  isRetrying: boolean
  onRetry: () => void
  onOpen: () => void
}

/** Keep unknown roster/budget data out of editable proposal and counter forms. */
export default function TradeComposerLoading({
  state,
  onClose,
}: {
  state: TradeComposerState
  onClose: () => void
}) {
  const { dialogRef, requestClose } = useModalDialog(onClose)

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-lg bg-surface p-0 text-foreground backdrop:bg-overlay-soft backdrop:backdrop-blur-sm"
      aria-labelledby="trade-loading-title"
    >
      <div className="card p-6 space-y-6">
        <h2 id="trade-loading-title" className="type-section text-foreground">Preparing trade</h2>
        {state.error ? (
          <div className="alert alert-error" role="alert">
            <p>{state.error}</p>
            <button onClick={state.onRetry} disabled={state.isRetrying} className="btn btn-secondary mt-3">
              {state.isRetrying ? 'Retrying...' : 'Try again'}
            </button>
          </div>
        ) : (
          <div role="status" aria-label="Loading trade details" className="space-y-4">
            <span className="sr-only">Loading your movies and budget...</span>
            <div className="skeleton h-5 w-40 rounded" aria-hidden="true" />
            <div className="grid grid-cols-2 gap-4" aria-hidden="true">
              <div className="skeleton h-40 rounded-lg" />
              <div className="skeleton h-40 rounded-lg" />
            </div>
          </div>
        )}
        <button onClick={requestClose} className="btn btn-secondary" data-dialog-initial-focus>Cancel</button>
      </div>
    </dialog>
  )
}
