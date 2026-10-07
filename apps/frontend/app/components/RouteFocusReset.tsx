'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/**
 * After a client-side navigation that removed the focused element (signing
 * in, a form that redirects), focus falls to <body> and the browser resumes
 * Tab from wherever that element used to be - past the skip link, mid-page.
 * Restart the Tab sequence from the top so the skip link comes first, as it
 * does on a full page load. Focus that survived the navigation (a league tab
 * the user just activated) is left where it is. Next's route announcer reads
 * the new page title either way.
 */
export function RouteFocusReset(): null {
  const pathname = usePathname()
  const previousPath = useRef(pathname)

  useEffect(() => {
    if (previousPath.current === pathname) return
    previousPath.current = pathname
    if (document.activeElement !== document.body) return
    const { body } = document
    body.setAttribute('tabindex', '-1')
    body.focus({ preventScroll: true })
    body.removeAttribute('tabindex')
  }, [pathname])

  return null
}
