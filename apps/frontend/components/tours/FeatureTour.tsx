'use client'

import { useEffect, useRef } from 'react'
import type { TourId } from '@/tours/registry'
import type { TourContext } from '@/tours/types'
import { useTours } from './TourProvider'

interface Props {
  id: TourId
  /**
   * What the tour's `when` rules read: role, league phase, and anything else
   * the page knows. Keep values serializable; it is compared by content.
   */
  ctx?: TourContext
}

/**
 * Offers a tour on this page. Renders nothing: while mounted, the tour starts
 * by itself the first time it applies to the viewer, and "Show me around" and
 * the account menu can replay it. Unmounting (navigating away, a phase change,
 * a closed dialog) ends it if it is showing.
 *
 * @example <FeatureTour id="bidding" ctx={{ leagueStatus: league.status }} />
 */
export default function FeatureTour({ id, ctx = {} }: Props): null {
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
