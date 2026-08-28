'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ListOrdered, Scissors } from 'lucide-react'
import { toast } from 'sonner'

/**
 * The reorderable list behind both bid-priority controls.
 *
 * Pickup bids and counterpick bids draw on different capacity pools, so they
 * stay two separate lists on screen -- ranking one against the other would mean
 * nothing. What they share is the mechanism: drag-free up/down reordering, a
 * debounced save, and a line marking where the team runs out of room. That
 * mechanism lives here so a fix to it cannot land in one list and miss the other.
 */

export interface PriorityListItem {
  id: string
  title: string
  /** Optional detail line under the title, e.g. amount or target team. */
  meta?: React.ReactNode
}

interface PriorityListProps {
  /** Items in the team's chosen order, most wanted first. */
  items: PriorityListItem[]
  /**
   * Which items the team could actually keep, given the order passed in.
   *
   * Evaluated against the *local* order rather than the server's, so the cut
   * line moves as the user reorders instead of lagging a save behind.
   */
  computeFits: (items: PriorityListItem[]) => boolean[]
  heading: string
  /** One sentence explaining what the ordering buys the team. */
  description: string
  /** Label on the divider where capacity runs out. */
  cutLabel: string
  testId: string
  cutTestId: string
  onReorder: (ids: string[]) => Promise<{ success: boolean; error?: string }>
}

/** Saving on every keypress would spam the endpoint mid-reshuffle. */
const SAVE_DEBOUNCE_MS = 400

function move<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** @design-system League */
export default function PriorityList({
  items,
  computeFits,
  heading,
  description,
  cutLabel,
  testId,
  cutTestId,
  onReorder,
}: PriorityListProps): React.ReactElement | null {
  // Held locally so a reorder lands instantly; the server order flows back in
  // via the `items` prop once the save completes.
  const [order, setOrder] = useState(items)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef(items.map((item) => item.id).join(','))

  useEffect(() => {
    const incoming = items.map((item) => item.id).join(',')
    // Ignore the echo of our own save so it cannot fight the local order.
    if (incoming !== lastSaved.current) {
      setOrder(items)
      lastSaved.current = incoming
    }
  }, [items])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const save = useCallback(async (
    next: PriorityListItem[],
    previous: PriorityListItem[],
  ) => {
    const nextIds = next.map((item) => item.id)
    lastSaved.current = nextIds.join(',')

    const { success, error } = await onReorder(nextIds)
    if (!success) {
      setOrder(previous)
      lastSaved.current = previous.map((item) => item.id).join(',')
      toast.error(error || 'Could not save bid priority')
    }
  }, [onReorder])

  const moveItem = useCallback((from: number, to: number) => {
    if (to < 0 || to >= order.length) return

    const next = move(order, from, to)
    setOrder(next)

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(next, order), SAVE_DEBOUNCE_MS)
  }, [order, save])

  // One item cannot collide with anything, so the ordering control has no job.
  if (order.length < 2) return null

  const fits = computeFits(order)
  // The first item that needs room it does not have. Nothing below it can land,
  // so that is where the line belongs. -1 when everything fits.
  const cutIndex = fits.indexOf(false)

  return (
    <div className="card p-4 sm:p-5 space-y-4" data-testid={testId}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-gold" />
          <h3 className="font-display font-semibold text-foreground">{heading}</h3>
        </div>
        <p className="text-sm text-foreground-secondary">{description}</p>
      </div>

      <ol className="space-y-2">
        {order.map((item, index) => {
          const willFit = fits[index]

          return (
            <li key={item.id}>
              {/* Never renders when every item fits, since cutIndex is -1 then. */}
              {index === cutIndex && (
                <div className="flex items-center gap-2 py-2" data-testid={cutTestId}>
                  <Scissors className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                  <span className="text-xs uppercase tracking-wide text-foreground-muted whitespace-nowrap">
                    {cutLabel}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}

              <div
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  willFit
                    ? 'border-border bg-elevated'
                    : 'border-border/60 bg-surface opacity-60'
                }`}
              >
                <span
                  className={`font-mono text-sm w-6 text-center shrink-0 ${
                    willFit ? 'text-gold' : 'text-foreground-muted'
                  }`}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{item.title}</p>
                  {item.meta && (
                    <p className="text-xs text-foreground-secondary mt-0.5 flex items-center gap-1">
                      {item.meta}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveItem(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move ${item.title} up to priority ${index}`}
                    className="p-1 rounded text-foreground-secondary hover:text-gold hover:bg-surface-hover disabled:opacity-30 disabled:hover:text-foreground-secondary disabled:hover:bg-transparent transition-colors focus-visible:outline-2 focus-visible:outline-gold"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, index + 1)}
                    disabled={index === order.length - 1}
                    aria-label={`Move ${item.title} down to priority ${index + 2}`}
                    className="p-1 rounded text-foreground-secondary hover:text-gold hover:bg-surface-hover disabled:opacity-30 disabled:hover:text-foreground-secondary disabled:hover:bg-transparent transition-colors focus-visible:outline-2 focus-visible:outline-gold"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
