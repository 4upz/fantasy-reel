'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/** Progressively enhance offscreen sections; server-rendered content stays visible. */
export default function ScrollReveal({ children, className }: { children: ReactNode; className: string }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!root || preference.matches || !('IntersectionObserver' in window)) return

    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-reveal]'))
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const section = entry.target as HTMLElement
        section.dataset.scrollReveal = 'visible'
        observer.unobserve(section)
      }
    }, { rootMargin: '0px 0px -48px 0px' })

    for (const section of sections) {
      // Leave restored scroll positions and sections already on screen undisturbed.
      if (section.getBoundingClientRect().top < window.innerHeight) continue
      section.dataset.scrollReveal = 'pending'
      observer.observe(section)
    }

    const revealFocusedSection = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return
      const section = event.target.closest<HTMLElement>('[data-scroll-reveal="pending"]')
      if (!section) return
      section.dataset.scrollReveal = 'visible'
      observer.unobserve(section)
    }
    const revealAll = () => {
      if (!preference.matches) return
      observer.disconnect()
      sections.forEach(section => { section.dataset.scrollReveal = 'visible' })
    }

    root.addEventListener('focusin', revealFocusedSection)
    preference.addEventListener('change', revealAll)
    return () => {
      observer.disconnect()
      root.removeEventListener('focusin', revealFocusedSection)
      preference.removeEventListener('change', revealAll)
      sections.forEach(section => { section.dataset.scrollReveal = 'visible' })
    }
  }, [])

  return <div ref={rootRef} className={className}>{children}</div>
}
