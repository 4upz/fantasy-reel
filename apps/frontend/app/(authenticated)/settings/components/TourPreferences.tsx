'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { Compass } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useTours } from '@/components/tours'
import { TOUR_LIST, type TourId } from '@/tours/registry'
import type { TourState } from '@/tours/engine'

/** What the list says about one tour, in the user's words. */
function statusLabel(state: TourState | undefined, version: number): string {
  if (!state || state.v < version || !state.status) return 'Not seen yet'
  if (state.status === 'completed') return 'Finished'
  if (state.status === 'dismissed') return 'Hidden'
  const until = state.until ? new Date(state.until) : null
  if (!until || until.getTime() <= Date.now()) return 'Not seen yet'
  return `Snoozed until ${until.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/**
 * Account settings' Tours section: turn automatic tours off or on, and bring
 * any tour back. Tours are tied to pages, so "Show again" means the next visit
 * to that page; "Show me around" there replays one at any time.
 */
export default function TourPreferences(): React.ReactElement {
  const { ready, enabled, tourState, setEnabled, reset } = useTours()

  const toggle = useCallback(async (next: boolean) => {
    try {
      await setEnabled(next)
      toast.success(next ? 'Tours turned on' : 'Tours turned off')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t save your tour setting. Try again.')
    }
  }, [setEnabled])
  const { execute: executeToggle, isLoading: toggling } = useAsyncAction(toggle)

  const showAgain = useCallback(async (id?: TourId) => {
    try {
      await reset(id)
      toast.success(id ? 'This tour will start next time you open its page' : 'All tours will start again on your next visit to each page')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t reset your tours. Try again.')
    }
  }, [reset])
  const { execute: executeReset, isLoading: resetting } = useAsyncAction(showAgain)

  // With one tour, its own Show again button already does this.
  const showResetAll = TOUR_LIST.length > 1 && TOUR_LIST.some((tour) => tourState(tour.id)?.status)

  return (
    <section className="card p-6" aria-labelledby="tour-preferences-heading" data-testid="tour-preferences">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
        <div className="p-2 rounded-lg bg-surface-hover">
          <Compass className="w-5 h-5 text-foreground-secondary" aria-hidden="true" />
        </div>
        <div>
          <h2 id="tour-preferences-heading" className="type-section text-foreground">
            Tours
          </h2>
          <p className="type-body-sm text-foreground-secondary">Short guides that start the first time you open a page</p>
        </div>
      </div>

      {!ready && (
        <p className="alert alert-warning mb-4 type-body-sm" role="status">
          Your tour history couldn’t be loaded, so tours won’t start by themselves until you reload.
        </p>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <p id="tours-enabled-label" className="type-label text-foreground">Show tours automatically</p>
          <p id="tours-enabled-description" className="type-meta text-foreground-secondary mt-0.5">
            When this is off, tours start only when you choose “Show me around” on a page or “Tour this page” in the account menu.
          </p>
        </div>
        <button
          type="button"
          onClick={() => executeToggle(!enabled)}
          aria-disabled={toggling || undefined}
          className={`relative w-10 h-6 shrink-0 cursor-pointer rounded-full transition-colors aria-disabled:cursor-wait aria-disabled:opacity-60 ${
            enabled ? 'bg-gold' : 'bg-elevated border border-border'
          }`}
          role="switch"
          aria-checked={enabled}
          aria-labelledby="tours-enabled-label"
          aria-describedby="tours-enabled-description"
          data-testid="tours-enabled-toggle"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-foreground transition-transform ${
              enabled ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>

      <ul role="list" className="mt-6 divide-y divide-border border-y border-border">
        {TOUR_LIST.map((tour) => {
          const state = tourState(tour.id)
          return (
            <li key={tour.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="type-label text-foreground">{tour.title}</p>
                <p className="type-meta text-foreground-secondary">
                  {statusLabel(state, tour.version)} · {tour.description}
                </p>
              </div>
              {state?.status && (
                <button
                  type="button"
                  onClick={() => executeReset(tour.id as TourId)}
                  aria-disabled={resetting || undefined}
                  className="type-control shrink-0 text-gold transition-colors hover:text-gold-hover aria-disabled:cursor-wait aria-disabled:opacity-60"
                >
                  Show again<span className="sr-only">: {tour.title}</span>
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {showResetAll && (
        <button
          type="button"
          onClick={() => executeReset()}
          aria-disabled={resetting || undefined}
          className="btn btn-secondary mt-4 aria-disabled:cursor-wait aria-disabled:opacity-60"
          data-testid="tours-reset-all"
        >
          Show all tours again
        </button>
      )}
    </section>
  )
}
