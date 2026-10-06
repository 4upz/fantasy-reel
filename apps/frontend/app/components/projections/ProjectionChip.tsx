'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { MovieProjection } from '@/types'
import { useMovieProjection } from '@/hooks/useMovieProjections'
import { formatSignedPoints, pointsTone } from '@/utils/scoring'
import {
  projectedPointsFor,
  projectionChipLabel,
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
  className?: string
}

const TONE_STYLES: Record<ProjectionTone, string> = {
  fresh: 'border-gold/60 text-gold',
  rotten: 'border-crimson/70 text-crimson',
  uncertain: 'border-foreground-muted text-foreground',
}

/** A hollow, dashed tomato: the score still to be drawn. Half-filled once early reviews are in. */
function ProjectedTomato({ early, className }: { early: boolean; className: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`flex-none ${className}`} aria-hidden="true">
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
 */
/** @design-system Movies */
export default function ProjectionChip({
  projection,
  counterpick = false,
  size = 'md',
  overlay = false,
  interactive = true,
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
      <span className={`type-numeric font-bold ${small ? 'text-[0.8125rem] leading-4' : 'text-sm leading-5'}`}>{label}</span>
      {lowConfidence &&
        (small ? (
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-warning" title="Low confidence">
            <span className="sr-only">Low confidence</span>
          </span>
        ) : (
          <span className="type-meta text-warning">Low confidence</span>
        ))}
      <BetaBadge />
    </>
  )

  if (!interactive) {
    return (
      <span className={classes} data-testid="projection-chip">
        {content}
      </span>
    )
  }
  return (
    <ProjectionPopover projection={projection} counterpick={counterpick} label={label} triggerClassName={classes}>
      {content}
    </ProjectionPopover>
  )
}

const POPOVER_WIDTH = 360
const VIEWPORT_GUTTER = 16
const HOVER_OPEN_MS = 120
const HOVER_CLOSE_MS = 180

interface Position {
  top: number
  left: number
  width: number
}

/**
 * The chip's breakdown. A popover anchored under the chip on wider screens,
 * opened by hover or tap; a bottom sheet on a phone, opened by tap. Rendered
 * into the nearest open `<dialog>` when there is one, since anything outside
 * a modal dialog's top layer is inert and hidden behind it.
 */
function ProjectionPopover({
  projection,
  counterpick,
  label,
  triggerClassName,
  children,
}: {
  projection: MovieProjection
  counterpick: boolean
  /** The chip's own words, which lead its accessible name. */
  label: string
  triggerClassName: string
  children: React.ReactNode
}) {
  const [mode, setMode] = useState<'hover' | 'pinned' | null>(null)
  const [asSheet, setAsSheet] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const popoverId = useId()
  const open = mode !== null

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
    if (!open || asSheet) return
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
  }, [open, asSheet, place])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Inside a modal dialog, Escape would also close the dialog behind us.
      event.preventDefault()
      event.stopPropagation()
      close(true)
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
  }, [open, close])

  useEffect(() => {
    if (mode === 'pinned') popoverRef.current?.focus({ preventScroll: true })
  }, [mode, asSheet])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const openPinned = (event: React.MouseEvent) => {
    // The chip often sits on a card that opens something itself.
    event.stopPropagation()
    event.preventDefault()
    clearTimer()
    if (mode === 'pinned') {
      close(false)
      return
    }
    setAsSheet(window.matchMedia('(max-width: 639px)').matches)
    setMode('pinned')
  }

  const hoverIn = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    clearTimer()
    if (mode || hoverSuppressedRef.current) return
    timerRef.current = setTimeout(() => {
      setAsSheet(false)
      setMode((current) => current ?? 'hover')
    }, HOVER_OPEN_MS)
  }

  const hoverOut = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    hoverSuppressedRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => setMode((current) => (current === 'hover' ? null : current)), HOVER_CLOSE_MS)
  }

  const container = open ? triggerRef.current?.closest('dialog') ?? document.body : null
  const breakdown = <ProjectionBreakdown projection={projection} counterpick={counterpick} variant="compact" />
  const points = projectedPointsFor(projection, counterpick)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPinned}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`${label}, Beta. About ${formatSignedPoints(points)} points. Show why`}
        className={`${triggerClassName} cursor-pointer transition-colors hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold`}
        data-testid="projection-chip"
      >
        {children}
      </button>
      {container &&
        createPortal(
          asSheet ? (
            <div className="fixed inset-0 z-[70] flex items-end" data-testid="projection-sheet">
              <div className="absolute inset-0 bg-overlay-soft animate-fade-in" aria-hidden="true" />
              <div
                ref={popoverRef}
                id={popoverId}
                role="dialog"
                aria-label="Why this projection"
                tabIndex={-1}
                className="relative max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-surface p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-foreground shadow-heavy animate-slide-up focus:outline-none motion-reduce:animate-none"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="mx-auto h-1 w-10 rounded-full bg-border-hover" aria-hidden="true" />
                </div>
                <button
                  type="button"
                  onClick={() => close(true)}
                  aria-label="Close"
                  className="absolute right-3 top-3 rounded-full p-2 text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
                {breakdown}
              </div>
            </div>
          ) : (
            <div
              ref={popoverRef}
              id={popoverId}
              role="dialog"
              aria-label="Why this projection"
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
 * A counterpick target's projection: the movie's chip, plus what it is most
 * likely worth to the counterpicker -- the negation of the movie's points.
 */
export function CounterpickProjection({
  projection,
  interactive = true,
  className = '',
}: {
  projection: MovieProjection
  interactive?: boolean
  className?: string
}) {
  const points = projectedPointsFor(projection, true)
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <ProjectionChip projection={projection} counterpick size="sm" interactive={interactive} />
      {!projection.insufficient_history && (
        <span className="type-meta text-foreground-secondary" data-testid="counterpick-projected-points">
          ≈{' '}
          <span className={`type-numeric font-bold ${pointsTone(points, { positive: 'text-gold' })}`}>
            {formatSignedPoints(points)} pts
          </span>{' '}
          for you
        </span>
      )}
    </div>
  )
}

/** A roster or trade row's projection: the plain chip, or the counterpick reading of it. */
export function HoldingProjection({
  projection,
  counterpick = false,
  interactive = true,
  className = '',
}: {
  projection: MovieProjection
  counterpick?: boolean
  interactive?: boolean
  className?: string
}) {
  return counterpick ? (
    <CounterpickProjection projection={projection} interactive={interactive} className={className} />
  ) : (
    <ProjectionChip projection={projection} size="sm" interactive={interactive} className={className} />
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
