'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

interface BreadcrumbItem {
  label: string
  href?: string
}

export default function NavBreadcrumb(): React.ReactElement {
  const pathname = usePathname()
  const [leagueName, setLeagueName] = useState<string | null>(null)

  const leagueMatch = pathname.match(/^\/league\/([^/]+)/)
  const leagueId = leagueMatch?.[1]

  useEffect(() => {
    if (!leagueId) {
      setLeagueName(null)
      return
    }

    const supabase = createClient()
    supabase
      .from('leagues')
      .select('name')
      .eq('id', leagueId)
      .single()
      .then(({ data }) => setLeagueName(data?.name ?? null))
  }, [leagueId])

  function buildBreadcrumbItems(): BreadcrumbItem[] {
    if (pathname === '/dashboard') {
      return [{ label: 'Dashboard' }]
    }

    if (pathname.startsWith('/league/')) {
      return [
        { label: 'Dashboard', href: '/dashboard' },
        { label: leagueName || 'League' },
      ]
    }

    if (pathname === '/join') {
      return [
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Join League' },
      ]
    }

    return [{ label: 'Dashboard', href: '/dashboard' }]
  }

  const items = buildBreadcrumbItems()

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-2">
          {index > 0 && (
            <span className="text-foreground-muted select-none" aria-hidden="true">
              ›
            </span>
          )}

          {item.href ? (
            <Link
              href={item.href}
              className="nav-link hover:underline underline-offset-4"
            >
              {item.label}
            </Link>
          ) : (
            <span className="nav-link-active font-medium truncate max-w-[200px] md:max-w-[300px]">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}
