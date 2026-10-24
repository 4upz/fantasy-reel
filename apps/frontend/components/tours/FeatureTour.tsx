'use client'

import { useEffect, useRef } from 'react'
import type { TourCtx, TourId } from '@/tours/registry'
import type { TourContext } from '@/tours/types'
import { useTours } from './TourProvider'

/**
 * `ctx` is what the tour's rules read: role, league phase, and anything else
 * the page knows, typed by the tour's `defineTour<Ctx>()`. It is optional only
 * for a tour that needs no facts. Keep values serializable; it is compared by
 * content.
 */
type Props<Id extends TourId> = Record<string, never> extends TourCtx<Id>
  ? { id: Id; ctx?: TourCtx<Id> }
  : { id: Id; ctx: TourCtx<Id> }

/**
 * Offers a tour on this page. Renders nothing: while mounted, the tour starts
 * by itself the first time it applies to the viewer, and "Show me around" and
 * the account menu can replay it. Unmounting (navigating away, a phase change,
 * a closed dialog) ends it if it is showing.
 *
 * @example <FeatureTour id="bidding" ctx={{ leagueStatus: league.status }} />
 */
export default function FeatureTour<Id extends TourId>(props: Props<Id>): null {
  const { id } = props
  const ctx: TourContext = props.ctx ?? {}
  const { register } = useTours()
  const handle = useRef<ReturnType<typeof register> | null>(null)
  const ctxKey = JSON.stringify(ctx)
  const latestCtx = useRef(ctx)
  latestCtx.current = ctx

  useEffect(() => {
    const registration = register(id, latestCtx.current)
    handle.current = registration
    return () => {
      handle.current = null
      registration.unregister()
    }
  }, [id, register])

  useEffect(() => {
    handle.current?.update(latestCtx.current)
  }, [ctxKey])

  return null
}
