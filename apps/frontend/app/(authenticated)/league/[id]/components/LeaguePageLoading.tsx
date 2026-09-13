'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import LeagueTabLoading from './LeagueTabLoading'

export default function LeaguePageLoading() {
  const pathname = usePathname()
  const [visiblePath, setVisiblePath] = useState<string | null>(null)

  // The layout's persistent boundary only mounts this when no content has been
  // revealed yet. Let fast initial responses finish without flashing a skeleton.
  useEffect(() => {
    const timeout = setTimeout(() => setVisiblePath(pathname), 200)
    return () => clearTimeout(timeout)
  }, [pathname])

  if (visiblePath !== pathname) return null

  return <LeagueTabLoading page={pathname.split('/')[3]} />
}
