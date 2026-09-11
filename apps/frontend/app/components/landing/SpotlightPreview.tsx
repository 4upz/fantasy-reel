'use client'

import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Maximize2, X } from 'lucide-react'
import styles from './landing.module.css'

interface PreviewDetail {
  label: string
  description: string
  focus?: string
}

interface SpotlightPreviewProps {
  title: string
  width: number
  height: number
  details: readonly PreviewDetail[]
  children: ReactNode
  layout?: 'stacked' | 'beside'
}

interface SurfaceProps {
  width: number
  height: number
  focus?: string
  children: ReactNode
}

const motion = { duration: 650, easing: 'cubic-bezier(.22,.8,.2,1)' }

/** Re-rasterize native text at the destination scale; only animate the camera transform. */
function PreviewSurface({ width, height, focus, children }: SurfaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)
  const animations = useRef<Animation[]>([])
  const focusRef = useRef(focus)
  const initialized = useRef(false)

  const fit = useCallback((targetName: string | undefined, animate: boolean) => {
    const viewport = viewportRef.current
    const camera = cameraRef.current
    const canvas = canvasRef.current
    const spotlight = spotlightRef.current
    if (!viewport || !camera || !canvas || !spotlight) return

    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    if (!vw || !vh) return

    // Read the current animated positions before cancelling, so repeated clicks stay smooth.
    const matrix = new DOMMatrix(getComputedStyle(camera).transform)
    const oldScale = (Number(getComputedStyle(canvas).zoom) || 1) * matrix.a
    const viewportRect = viewport.getBoundingClientRect()
    const oldSpotlight = spotlight.getBoundingClientRect()
    const oldOpacity = getComputedStyle(spotlight).opacity
    const target = targetName
      ? canvas.querySelector<HTMLElement>(`[data-preview-focus="${targetName}"]`)
      : null
    const canvasRect = canvas.getBoundingClientRect()
    const targetRect = target?.getBoundingClientRect()
    const area = targetRect ? {
      x: (targetRect.left - canvasRect.left) / oldScale,
      y: (targetRect.top - canvasRect.top) / oldScale,
      width: targetRect.width / oldScale,
      height: targetRect.height / oldScale,
    } : null

    let scale = Math.min(vw / width, vh / height)
    let x = (vw - width * scale) / 2
    let y = (vh - height * scale) / 2
    if (area) {
      const fitScale = Math.min((vw - 32) / area.width, (vh - 32) / area.height)
      scale = Math.min(fitScale, Math.max(scale * 1.65, 1))
      x = Math.max(vw - width * scale - 12, Math.min(12, vw / 2 - (area.x + area.width / 2) * scale))
      y = Math.max(vh - height * scale - 12, Math.min(12, vh / 2 - (area.y + area.height / 2) * scale))
    }

    animations.current.forEach(animation => animation.cancel())
    animations.current = []
    canvas.style.zoom = String(scale)
    camera.style.transform = `translate(${x}px, ${y}px)`
    viewport.dataset.ready = 'true'
    const shouldAnimate = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (shouldAnimate) {
      animations.current.push(camera.animate([
        { transform: `translate(${matrix.e}px, ${matrix.f}px) scale(${oldScale / scale})` },
        { transform: `translate(${x}px, ${y}px) scale(1)` },
      ], motion))
    }

    if (area) {
      const left = Math.max(4, x + area.x * scale - 6)
      const top = Math.max(4, y + area.y * scale - 6)
      const sw = Math.min(vw - left - 4, area.width * scale + 12)
      const sh = Math.min(vh - top - 4, area.height * scale + 12)
      Object.assign(spotlight.style, {
        left: `${left}px`, top: `${top}px`, width: `${sw}px`, height: `${sh}px`, opacity: '1',
      })
      if (shouldAnimate) {
        const previous = oldOpacity !== '0'
          ? `translate(${oldSpotlight.left - viewportRect.left - left}px, ${oldSpotlight.top - viewportRect.top - top}px) scale(${oldSpotlight.width / sw}, ${oldSpotlight.height / sh})`
          : 'scale(.98)'
        animations.current.push(spotlight.animate([
          { opacity: oldOpacity, transform: previous },
          { opacity: 1, transform: 'translate(0, 0) scale(1)' },
        ], motion))
      }
    } else {
      spotlight.style.opacity = '0'
    }
  }, [width, height])

  useLayoutEffect(() => {
    focusRef.current = focus
    fit(focus, initialized.current)
    initialized.current = true
  }, [focus, fit])

  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => fit(focusRef.current, false))
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => fit(focusRef.current, false)
    if (viewportRef.current) observer.observe(viewportRef.current)
    preference.addEventListener('change', update)
    return () => {
      observer.disconnect()
      preference.removeEventListener('change', update)
      animations.current.forEach(animation => animation.cancel())
    }
  }, [fit])

  return (
    <div ref={viewportRef} className={styles.viewport} style={{ '--scene-ratio': width / height } as CSSProperties}>
      <div ref={cameraRef} className={styles.camera}>
        <div ref={canvasRef} className={styles.canvas} style={{ width, height, '--scene-width': width } as CSSProperties} inert aria-hidden="true">
          {children}
        </div>
      </div>
      <div ref={spotlightRef} className={styles.spotlight} aria-hidden="true" />
    </div>
  )
}

export default function SpotlightPreview({ title, width, height, details, children, layout = 'stacked' }: SpotlightPreviewProps) {
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const enlargeRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const selected = details[active]

  useLayoutEffect(() => {
    if (!expanded) return
    const dialog = dialogRef.current
    const trigger = enlargeRef.current
    const previousOverflow = document.documentElement.style.overflow
    dialog?.showModal()
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previousOverflow
      dialog?.close()
      trigger?.focus({ preventScroll: true })
    }
  }, [expanded])

  const controls = (inDialog: boolean) => (
    <div className={styles.previewControls} role="group" aria-label={`${title} highlights`}>
      {details.map((detail, index) => (
        <button
          key={detail.label}
          type="button"
          className={styles.previewControl}
          aria-pressed={active === index}
          aria-controls={`${id}-${inDialog ? 'large' : 'inline'}`}
          onClick={() => setActive(index)}
        >
          <span className="type-control">{detail.label}</span>
          {layout === 'beside' && !inDialog && <span className={`type-body-sm ${styles.controlDescription}`}>{detail.description}</span>}
        </button>
      ))}
    </div>
  )

  const notes = (
    <div className={styles.previewNotes}>
      {controls(false)}
      <p className={`type-body-sm ${styles.caption}`} aria-live="polite" aria-atomic="true">{selected.description}</p>
    </div>
  )

  return (
    <div className={layout === 'beside' ? styles.previewBeside : styles.previewStacked}>
      {layout === 'stacked' && notes}
      <figure className={styles.previewFrame}>
        <div className={styles.previewBar}>
          <span className="type-meta">{title} <span className={styles.exampleLabel}>· Example</span></span>
          <button ref={enlargeRef} type="button" className={`btn btn-ghost ${styles.enlarge}`} onClick={() => setExpanded(true)} aria-label={`View ${title.toLowerCase()} larger`}>
            <Maximize2 size={15} aria-hidden="true" /><span>View larger</span>
          </button>
        </div>
        <div id={`${id}-inline`} role="img" aria-label={`${title}. ${selected.description}`}>
          <PreviewSurface width={width} height={height} focus={selected.focus}>{children}</PreviewSurface>
        </div>
      </figure>
      {layout === 'beside' && notes}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={`${id}-title`}
        onClose={() => setExpanded(false)}
        onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close() }}
        onKeyDown={event => {
          if (event.key !== 'Tab') return
          const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
          const first = buttons[0]
          const last = buttons[buttons.length - 1]
          if (event.shiftKey && (event.target === first || event.target === event.currentTarget)) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && event.target === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
      >
        {expanded && <div className={styles.dialogPanel}>
          <div className={styles.dialogHeader}>
            <h2 id={`${id}-title`} className="type-panel">{title}</h2>
            <button type="button" className="btn btn-ghost min-h-11 min-w-11" aria-label="Close preview" onClick={() => dialogRef.current?.close()}><X size={22} aria-hidden="true" /></button>
          </div>
          <div className={styles.dialogScene} style={{ '--scene-ratio': width / height } as CSSProperties}>
            <div id={`${id}-large`} role="img" aria-label={`${title}. ${selected.description}`}>
              <PreviewSurface width={width} height={height} focus={selected.focus}>{children}</PreviewSurface>
            </div>
          </div>
          {controls(true)}
          <p className={`type-body-sm ${styles.caption}`} aria-live="polite" aria-atomic="true">{selected.description}</p>
        </div>}
      </dialog>
    </div>
  )
}
