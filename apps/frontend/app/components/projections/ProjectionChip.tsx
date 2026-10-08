'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { MovieProjection } from '@/types'
import { useMovieProjection } from '@/hooks/useMovieProjections'
import { useModalDialog } from '@/hooks/useModalDialog'
import { formatSignedPoints, pointsTone } from '@/utils/scoring'
import {
  projectedPointsFor,
  projectionChipLabel,
  projectionChipSpokenLabel,
  projectionChipState,
  projectionTone,
  type ProjectionTone,
} from '@/utils/projections'
import BetaBadge from './BetaBadge'
import ProjectionBreakdown from './ProjectionBreakdown'

interface Props {
  projection: MovieProjection
  /** On a counterpick: the breakdown's points are the holder's, negated. */
  counterpick?: boolean
  size?: 'sm' | 'md'
  /** Sits on a poster, so it brings its own backdrop. */
  overlay?: boolean
  /**
   * Opens the breakdown on tap or hover. Off where the chip sits inside
   * another control (a card that is itself a button): the breakdown is then
   * one tap away in the movie dialog that card opens.
   */
  interactive?: boolean
  /** For a read-only chip, so the control it sits in can point `aria-describedby` at it. */
  id?: string
  className?: string
}

const TONE_STYLES: Record<ProjectionTone, string> = {
  fresh: 'border-gold/60 text-gold',
  rotten: 'border-crimson/70 text-crimson-text',
  uncertain: 'border-foreground-muted text-foreground',
}

/** A hollow, dashed tomato: the score still to be drawn. Half-filled once early reviews are in. */
function ProjectedTomato({ early, className }: { early: boolean; className: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`flex-none ${className}`} aria-hidden="true" focusable="false">
      <g fill="currentColor" opacity="0.55">
        <rect x="9.4" y="3.4" width="1.2" height="2.8" rx="0.6" />
        <path d="M9.9 6.4C8.9 5.2 7.6 4.5 6.1 4.4c.2 1.4 1 2.5 2.2 3.2.5-.5 1-.9 1.6-1.2Zm.2 0c1-1.2 2.3-1.9 3.8-2-.2 1.4-1 2.5-2.2 3.2-.5-.5-1-.9-1.6-1.2Z" />
      </g>
      <ellipse cx="10" cy="12.3" rx="6.6" ry="5.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 1.6" />
      {early && <path d="M3.4 12.3a6.6 5.9 0 0 0 13.2 0Z" fill="currentColor" opacity="0.7" />}
    </svg>
  )
}

/**
 * A movie's projected score, as one number in the unit of the real score that
 * replaces it: "Proj. 68–79%", or "Proj. 74%" tagged low confidence when the
 * range is too wide to help. The factor breakdown is a tap (or hover) away.
 *
 * Everything the chip shows is also what it says: the range, "Low
 * confidence" and "Beta" are its text, never hidden behind an `aria-label`.
 */
/** @design-system Movies */
export default function ProjectionChip({
  projection,
  counterpick = false,
  size = 'md',
  overlay = false,
  interactive = true,
  id,
  className = '',
}: Props) {
  const state = projectionChipState(projection)
  const label = projectionChipLabel(state)
  const lowConfidence = state.kind === 'point' && state.lowConfidence
  const small = size === 'sm'
  const classes = [
    'inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border border-dashed text-left',
    small ? 'px-2 py-1' : 'px-2.5 py-1',
    TONE_STYLES[projectionTone(projection, state)],
    overlay ? 'bg-background/85 backdrop-blur-sm' : 'bg-transparent',
    className,
  ].join(' ')
  const content = (
    <>
      <ProjectedTomato early={state.kind === 'early'} className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      <span className={`type-numeric font-bold ${small ? 'text-[0.8125rem] leading-4' : 'text-sm leading-5'}`}>
        <span aria-hidden="true">{label}</span>
        <span className="sr-only">{projectionChipSpokenLabel(state)}</span>
      </span>
      {/* In words at every size: a lone warning dot would say it by colour alone. */}
      {lowConfidence && <span className="type-meta text-warning">Low confidence</span>}
      <BetaBadge />
    </>
  )

  if (!interactive) {
    return (
      <span id={id} className={classes} data-testid="projection-chip">
        {content}
      </span>
    )
  }
  return (
    <ProjectionPopover
      projection={projection}
      counterpick={counterpick}
      points={projectedPointsFor(projection, counterpick)}
      triggerClassName={classes}
    >
      {content}
    </ProjectionPopover>
  )
}

const POPOVER_WIDTH = 360
const VIEWPORT_GUTTER = 16
const HOVER_OPEN_MS = 120
const HOVER_CLOSE_MS = 180
const PHONE_QUERY = '(max-width: 639px)'

interface Position {
  top: number
  left: number
  width: number
}

/**
 * The chip's breakdown. On wider screens a non-modal popover anchored under
 * the chip: hover shows it (and it stays while the pointer moves onto it),
 * Enter/Space or a tap pins it and moves focus in, Escape dismisses it and
 * hands focus back, and Tab leaves it for the control after the chip. On a
 * phone a tap opens it as a bottom sheet, a real modal dialog.
 *
 * The popover renders into the nearest open `<dialog>` when there is one,
 * since anything outside a modal dialog's top layer is inert behind it.
 */
function ProjectionPopover({
  projection,
  counterpick,
  points,
  triggerClassName,
  children,
}: {
  projection: MovieProjection
  counterpick: boolean
  points: number
  triggerClassName: string
  children: React.ReactNode
}) {
  const [mode, setMode] = useState<'hover' | 'pinned' | 'sheet' | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const popoverId = useId()
  const headingId = useId()
  const popoverOpen = mode === 'hover' || mode === 'pinned'

  const clearTimer = () => clearTimeout(timerRef.current)
  // Once dismissed, the pointer resting on the chip must not reopen it on hover.
  const hoverSuppressedRef = useRef(false)

  const close = useCallback((restoreFocus: boolean) => {
    clearTimeout(timerRef.current)
    hoverSuppressedRef.current = true
    setMode(null)
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }, [])

  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const width = Math.min(POPOVER_WIDTH, viewportWidth - VIEWPORT_GUTTER * 2)
    const left = Math.min(Math.max(rect.left, VIEWPORT_GUTTER), viewportWidth - VIEWPORT_GUTTER - width)
    const height = popoverRef.current?.offsetHeight ?? 0
    const below = rect.bottom + 8
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_GUTTER
    const above = rect.top - 8 - height
    setPosition({ top: fitsBelow || above < VIEWPORT_GUTTER ? below : above, left, width })
  }, [])

  useLayoutEffect(() => {
    if (!popoverOpen) return
    place()
    // A second pass once the popover has a measured height, to flip it above when needed.
    const frame = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [popoverOpen, place])

  // The popover only. The sheet is a modal <dialog>, which handles Escape,
  // focus containment and focus return itself.
  useEffect(() => {
    if (!popoverOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Inside a modal dialog, Escape would also close the dialog behind us.
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      }
      // The popover holds nothing to tab to and is rendered at the end of the
      // page, so leaving it puts focus back in the flow at the chip: Tab then
      // carries on to whatever follows the chip, Shift+Tab stops on the chip.
      if (event.key === 'Tab' && popoverRef.current?.contains(document.activeElement)) {
        if (event.shiftKey) event.preventDefault()
        close(true)
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [popoverOpen, close])

  // Focus waits for the first placement: until then the popover is
  // visibility:hidden, and a hidden element cannot take focus.
  const placed = position !== null
  useEffect(() => {
    if (mode === 'pinned' && placed) popoverRef.current?.focus({ preventScroll: true })
  }, [mode, placed])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const toggle = (event: React.MouseEvent) => {
    // The chip often sits on a card that opens something itself.
    event.stopPropagation()
    event.preventDefault()
    clearTimer()
    if (mode === 'pinned') {
      close(false)
      return
    }
    setMode(window.matchMedia(PHONE_QUERY).matches ? 'sheet' : 'pinned')
  }

  const hoverIn = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    clearTimer()
    if (mode || hoverSuppressedRef.current) return
    timerRef.current = setTimeout(() => setMode((current) => current ?? 'hover'), HOVER_OPEN_MS)
  }

  const hoverOut = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    hoverSuppressedRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => setMode((current) => (current === 'hover' ? null : current)), HOVER_CLOSE_MS)
  }

  const container = mode ? triggerRef.current?.closest('dialog') ?? document.body : null
  const breakdown = (
    <ProjectionBreakdown projection={projection} counterpick={counterpick} variant="compact" headingId={headingId} />
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        aria-haspopup="dialog"
        aria-expanded={mode !== null}
        aria-controls={mode ? popoverId : undefined}
        className={`${triggerClassName} cursor-pointer transition-colors hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold`}
        data-testid="projection-chip"
      >
        {children}
        {/* Added to what the chip shows, never in place of it. */}
        <span className="sr-only">, about {formatSignedPoints(points)} points. Show why</span>
      </button>
      {container &&
        createPortal(
          mode === 'sheet' ? (
            <ProjectionSheet id={popoverId} labelledBy={headingId} onClose={() => close(false)}>
              {breakdown}
            </ProjectionSheet>
          ) : (
            <div
              ref={popoverRef}
              id={popoverId}
              role="dialog"
              aria-labelledby={headingId}
              tabIndex={-1}
              onPointerEnter={hoverIn}
              onPointerLeave={hoverOut}
              data-testid="projection-popover"
              className="fixed z-[70] rounded-xl border border-border-hover bg-surface-hover p-4 text-foreground shadow-heavy animate-fade-in focus:outline-none motion-reduce:animate-none"
              style={
                position
                  ? { top: position.top, left: position.left, width: position.width }
                  : { top: 0, left: 0, width: POPOVER_WIDTH, visibility: 'hidden' }
              }
            >
              {breakdown}
            </div>
          ),
          container
        )}
    </>
  )
}

/**
 * The phone bottom sheet: a modal dialog via `useModalDialog`, so focus moves
 * in, Tab stays in, Escape or a tap on the dimmed area closes it, and focus
 * returns to the chip.
 */
function ProjectionSheet({
  id,
  labelledBy,
  onClose,
  children,
}: {
  id: string
  labelledBy: string
  onClose: () => void
  children: React.ReactNode
}) {
  // A read-only view, so a tap on the dimmed area may close it.
  const { dialogRef, requestClose } = useModalDialog(onClose, false, true)
  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-labelledby={labelledBy}
      aria-modal="true"
      data-testid="projection-sheet"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-foreground backdrop:bg-overlay-soft open:flex open:items-end"
    >
      <div
        tabIndex={-1}
        data-dialog-initial-focus
        className="relative max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-surface p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-heavy animate-slide-up focus:outline-none motion-reduce:animate-none"
      >
        <div className="mb-3 flex items-center justify-center" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-border-hover" />
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full p-2 text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        {children}
      </div>
    </dialog>
  )
}

/**
 * A counterpick target's projection: the movie's chip, plus what it is most
 * likely worth to the counterpicker -- the negation of the movie's points.
 * A span, so it can sit inside the button or label of a selectable row.
 */
export function CounterpickProjection({
  projection,
  interactive = true,
  id,
  className = '',
}: {
  projection: MovieProjection
  interactive?: boolean
  /** For a read-only chip, so the control it sits in can point `aria-describedby` at it. */
  id?: string
  className?: string
}) {
  const points = projectedPointsFor(projection, true)
  return (
    <span id={id} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <ProjectionChip projection={projection} counterpick size="sm" interactive={interactive} />
      {!projection.insufficient_history && (
        <span className="type-meta text-foreground-secondary" data-testid="counterpick-projected-points">
          <span aria-hidden="true">≈ </span>
          <span className="sr-only">about </span>
          <span className={`type-numeric font-bold ${pointsTone(points, { positive: 'text-gold' })}`}>
            {formatSignedPoints(points)} pts
          </span>{' '}
          for you
        </span>
      )}
    </span>
  )
}

/** A roster or trade row's projection: the plain chip, or the counterpick reading of it. */
export function HoldingProjection({
  projection,
  counterpick = false,
  interactive = true,
  id,
  className = '',
}: {
  projection: MovieProjection
  counterpick?: boolean
  interactive?: boolean
  /** For a read-only chip, so the control it sits in can point `aria-describedby` at it. */
  id?: string
  className?: string
}) {
  return counterpick ? (
    <CounterpickProjection projection={projection} interactive={interactive} id={id} className={className} />
  ) : (
    <ProjectionChip projection={projection} size="sm" interactive={interactive} id={id} className={className} />
  )
}

/**
 * The chip for a movie in this league. Renders nothing at all unless the
 * league has projections on and this movie has one.
 */
export function MovieProjectionChip({ tmdbId, ...props }: Omit<Props, 'projection'> & { tmdbId: number }) {
  const projection = useMovieProjection(tmdbId)
  if (!projection) return null
  return <ProjectionChip projection={projection} {...props} />
}
