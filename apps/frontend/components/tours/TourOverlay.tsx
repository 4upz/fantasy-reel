'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { placeCard, type Box, type CardPosition } from '@/tours/engine'
import type { ActiveTour } from './TourProvider'
import { findTourAnchor, measureInsets, topModal } from './anchors'

/** Breathing room between a highlighted element and its outline. */
const SPOTLIGHT_PADDING = 6
/** Re-measure this often: anchors move as data loads and sticky headers pin. */
const TICK_MS = 200
const FALLBACK_CARD = { width: 352, height: 220 }
/** Footer links: a full 44px tap target on phones, compact on larger screens. */
const FOOTER_BUTTON =
  'inline-flex min-h-[44px] items-center text-foreground-secondary transition-colors hover:text-gold sm:min-h-0 sm:py-1'

interface Props {
  tour: ActiveTour
  onBack: () => void
  onNext: () => void
  onNotNow: () => void
  onDontShowAgain: () => void
  onTurnOffTours: () => void
}

interface Layout {
  anchor: Box | null
  position: CardPosition
  /** A modal the tour doesn't belong to is on top: hide until it closes. */
  paused: boolean
}

function sameLayout(a: Layout | null, b: Layout): boolean {
  if (!a || a.paused !== b.paused) return false
  const p = a.position
  const q = b.position
  if (p.top !== q.top || p.left !== q.left || p.maxHeight !== q.maxHeight || p.docked !== q.docked) return false
  if (!a.anchor || !b.anchor) return a.anchor === b.anchor
  return a.anchor.top === b.anchor.top && a.anchor.left === b.anchor.left
    && a.anchor.width === b.anchor.width && a.anchor.height === b.anchor.height
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * One step of a guided tour: a highlight around the step's element and a card
 * beside it.
 *
 * The card is a non-modal dialog: the page stays usable (the highlight lets
 * clicks through), focus moves to the card at each step and returns to where
 * it was when the tour ends, and Escape means "not now". For a tour inside a
 * modal (create league) the card renders inside that dialog, so it shares the
 * top layer and the dialog's focus containment; Escape is stopped there so it
 * can't also close the dialog and discard a half-filled form.
 */
export default function TourOverlay({
  tour,
  onBack,
  onNext,
  onNotNow,
  onDontShowAgain,
  onTurnOffTours,
}: Props): React.ReactElement | null {
  const step = tour.steps[tour.index]
  const isLast = tour.index === tour.steps.length - 1
  const titleId = useId()
  const bodyId = useId()
  const cardRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLParagraphElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [returnFocusTo] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  const measure = useCallback(() => {
    const element = step.anchor ? findTourAnchor(step.anchor) : null
    const rect = element?.getBoundingClientRect()
    const anchor = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null
    const card = cardRef.current
      ? { width: cardRef.current.offsetWidth, height: cardRef.current.scrollHeight }
      : FALLBACK_CARD
    const next: Layout = {
      anchor,
      position: placeCard(anchor, card, { width: window.innerWidth, height: window.innerHeight }, measureInsets(), step.placement),
      paused: topModal() !== tour.hostModal,
    }
    setLayout((current) => (sameLayout(current, next) ? current : next))
  }, [step, tour.hostModal])

  // Each step: bring its element into view clear of the fixed chrome, place
  // the card, and move focus to it.
  useLayoutEffect(() => {
    const element = step.anchor ? findTourAnchor(step.anchor) : null
    if (element) {
      const rect = element.getBoundingClientRect()
      const insets = measureInsets()
      if (rect.top < insets.top || rect.bottom > window.innerHeight - insets.bottom) {
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      }
    }
    measure()
    titleRef.current?.focus({ preventScroll: true })
  }, [tour.index, step, measure])

  useEffect(() => {
    const interval = window.setInterval(measure, TICK_MS)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure])

  // Hand focus back when the tour ends, unless the user has moved on.
  useEffect(() => () => {
    const focusIsInTour = !document.activeElement || document.activeElement === document.body
      || cardRef.current?.contains(document.activeElement)
    if (focusIsInTour && returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true })
  }, [returnFocusTo])

  // Escape inside the card means "not now". Cancelling the key also keeps a
  // host <dialog> from taking it as its own cancel and closing.
  const notNowRef = useRef(onNotNow)
  notNowRef.current = onNotNow
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      notNowRef.current()
    }
    card.addEventListener('keydown', handleKeyDown)
    return () => card.removeEventListener('keydown', handleKeyDown)
  }, [layout?.paused])

  if (layout?.paused) return null

  const container = tour.hostModal?.isConnected ? tour.hostModal : document.body
  const paragraphs = Array.isArray(step.body) ? step.body : [step.body]
  const anchor = layout?.anchor ?? null
  const position = layout?.position

  return createPortal(
    // The wrapper ignores the pointer so the page stays usable; `!m-0`
    // beats the modal stylesheet's centering rule for a dialog's children.
    <div className="tour-layer pointer-events-none fixed inset-0 z-[70] !m-0" data-tour-overlay>
      {anchor ? (
        <div
          aria-hidden="true"
          className="tour-spotlight"
          style={{
            top: anchor.top - SPOTLIGHT_PADDING,
            left: anchor.left - SPOTLIGHT_PADDING,
            width: anchor.width + SPOTLIGHT_PADDING * 2,
            height: anchor.height + SPOTLIGHT_PADDING * 2,
          }}
        />
      ) : (
        <div aria-hidden="true" className="tour-scrim" />
      )}

      <section
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="tour-card"
        data-tour-id={tour.tour.id}
        className={`card tour-card has-[:focus-visible]:border-gold/40 pointer-events-auto fixed overflow-y-auto p-4 shadow-heavy animate-fade-in motion-reduce:animate-none ${
          position?.docked ? 'w-[calc(100vw-24px)]' : 'w-[min(22rem,calc(100vw-24px))]'
        } ${position ? '' : 'opacity-0'}`}
        style={position ? { top: position.top, left: position.left, maxHeight: position.maxHeight } : { top: 0, left: 0 }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="type-meta text-foreground-secondary">
            {tour.steps.length > 1 ? `Step ${tour.index + 1} of ${tour.steps.length}` : tour.tour.title}
          </p>
          <button
            type="button"
            onClick={onNotNow}
            className="-my-2 -mr-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-foreground-secondary transition-colors hover:text-foreground sm:-mr-2 sm:min-h-0 sm:min-w-0 sm:p-2.5"
            aria-label="Not now"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p ref={titleRef} id={titleId} tabIndex={-1} className="type-panel text-foreground focus:outline-none">
          {step.title}
        </p>
        <div id={bodyId} className="type-body-sm mt-2 space-y-2 text-foreground-secondary">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          {tour.index > 0 ? (
            <button type="button" onClick={onBack} className="btn btn-ghost -ml-3 min-h-[44px] px-3 py-2.5 sm:min-h-0 sm:py-1.5">
              Back
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={onNext} className="btn btn-primary min-h-[44px] px-4 py-2.5 sm:min-h-0 sm:py-1.5" data-testid="tour-next">
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>

        {!isLast && (
          <div className="type-meta mt-3 flex flex-wrap gap-x-4 border-t border-border pt-2 sm:pt-3">
            <button type="button" onClick={onNotNow} className={FOOTER_BUTTON}>
              Not now
            </button>
            <button type="button" onClick={onDontShowAgain} className={FOOTER_BUTTON} data-testid="tour-dont-show">
              Don’t show again
            </button>
            {tour.automatic && tour.index === 0 && (
              <button type="button" onClick={onTurnOffTours} className={FOOTER_BUTTON}>
                Turn off all tours
              </button>
            )}
          </div>
        )}
      </section>
    </div>,
    container
  )
}
