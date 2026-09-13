'use client'

import { useEffect, useRef, type ReactNode } from 'react'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const ease = (value: number) => value * value * (3 - 2 * value)

/** Read layout coordinates, unaffected by the scroll animation's own transform. */
function layoutTop(element: HTMLElement): number {
  let top = 0
  let parent: HTMLElement | null = element
  while (parent) {
    top += parent.offsetTop
    parent = parent.offsetParent as HTMLElement | null
  }
  return top
}

/** Scroll position drives reversible depth; content stays visible without JavaScript. */
export default function ScrollDepth({ children, className }: { children: ReactNode; className: string }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-depth]'))
    const hero = root.querySelector<HTMLElement>('[data-hero]')
    const header = root.querySelector('header')
    const scrollCue = root.querySelector<HTMLElement>('[data-scroll-cue]')
    let frame = 0

    const reset = () => {
      cancelAnimationFrame(frame)
      frame = 0
      sections.forEach(section => {
        section.style.removeProperty('--scroll-enter')
        section.style.removeProperty('--scroll-exit')
      })
      scrollCue?.style.removeProperty('opacity')
      scrollCue?.style.removeProperty('visibility')
    }

    const update = () => {
      frame = 0
      const height = window.innerHeight
      const scroll = window.scrollY
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - height)
      // Batch layout reads before style writes, and never rerender React on scroll.
      const positions = sections.map(section => ({ top: layoutTop(section), height: section.offsetHeight }))

      if (scrollCue) {
        const fade = ease(clamp(scroll / Math.min(160, height * .2)))
        scrollCue.style.opacity = (1 - fade).toFixed(4)
        scrollCue.style.visibility = fade === 1 ? 'hidden' : 'visible'
      }

      sections.forEach((section, index) => {
        const position = positions[index]
        const start = position.top - height
        // Let the final section settle fully even when the page ends first.
        const end = Math.min(position.top - height * .3, maxScroll)
        const enter = ease(clamp((scroll - start) / Math.max(1, end - start)))
        const exit = ease(clamp((scroll - (position.top + position.height - height * .22)) / (height * .42)))
        section.style.setProperty('--scroll-enter', enter.toFixed(4))
        section.style.setProperty('--scroll-exit', exit.toFixed(4))
      })
    }

    const schedule = () => {
      if (!frame && !preference.matches) frame = requestAnimationFrame(update)
    }
    const updatePreference = () => preference.matches ? reset() : schedule()
    const resize = () => {
      if (hero && header) {
        hero.style.setProperty('--hero-header-height', `${header.offsetHeight}px`)
      }
      schedule()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(root)
    if (header) resizeObserver.observe(header)
    sections.forEach(section => resizeObserver.observe(section))
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    preference.addEventListener('change', updatePreference)
    resize()

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      preference.removeEventListener('change', updatePreference)
      resizeObserver.disconnect()
      reset()
      hero?.style.removeProperty('--hero-header-height')
    }
  }, [])

  return <div ref={rootRef} className={className}>{children}</div>
}
