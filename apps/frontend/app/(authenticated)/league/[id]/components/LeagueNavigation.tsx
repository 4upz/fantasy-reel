'use client'

import { createContext, useCallback, useContext, useOptimistic, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import LeagueTabLoading from './LeagueTabLoading'

export interface LeagueNavigateEvent {
  preventDefault: () => void
}

interface NavigationContext {
  pathname: string
  pendingHref: string | null
  navigate: (href: string, event: LeagueNavigateEvent) => void
}

const Context = createContext<NavigationContext | null>(null)

export function LeagueNavigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [destination, setDestination] = useOptimistic(pathname)
  const [isPending, startTransition] = useTransition()

  const navigate = useCallback((href: string, event: LeagueNavigateEvent) => {
    event.preventDefault()
    startTransition(() => {
      // Link invokes onNavigate inside a transition. Optimistic state still
      // paints immediately, even while the route's server response is pending.
      setDestination(href)
      router.push(href)
    })
  }, [router, setDestination])

  // Next owns completion, redirects, errors and interrupted navigations. Once a
  // loading boundary commits, the URL names the destination and that boundary
  // takes over. Until then, show feedback even for an unprefetched route.
  const pendingHref = isPending && destination !== pathname ? destination : null

  return (
    <Context.Provider value={{ pathname: pendingHref ?? pathname, pendingHref, navigate }}>
      {children}
    </Context.Provider>
  )
}

export function useLeagueNavigation() {
  const context = useContext(Context)
  if (!context) throw new Error('League navigation must be inside LeagueNavigation')
  return context
}

export function LeagueTabContent({ children }: { children: React.ReactNode }) {
  const { pendingHref } = useLeagueNavigation()
  return (
    <>
      {pendingHref && <LeagueTabLoading />}
      {/* Keep the current tab mounted while Next loads its replacement. */}
      <div hidden={pendingHref !== null}>{children}</div>
    </>
  )
}
