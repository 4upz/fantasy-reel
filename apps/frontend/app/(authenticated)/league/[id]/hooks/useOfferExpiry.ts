'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_EXPIRY_HOURS,
  resolveExpiryChoice,
  resolveReleaseAnchor,
  type ExpiryChoice,
  type ExpiryMovie,
  type ExpiryResolution,
  type ReleaseAnchor,
} from '@/utils/tradeExpiry'

interface UseOfferExpiryReturn {
  choice: ExpiryChoice
  setChoice: (choice: ExpiryChoice) => void
  /** Derived from the current movie selection; drives the release chip. */
  releaseAnchor: ReleaseAnchor
  /** `choice` resolved for display, and for gating the submit button. */
  resolution: ExpiryResolution
  /** True when the release chip went stale and the window fell back. */
  fellBack: boolean
  /**
   * Resolve again at submit time. The clock keeps moving while a modal is open,
   * so a custom time that was an hour out on render can be inside the minimum
   * by the time the button is pressed.
   */
  resolveNow: () => ExpiryResolution
}

/**
 * The expiry half of a trade modal: which window is selected, whether it still
 * applies to the movies currently in the offer, and what to send.
 *
 * Both the propose and counter modals need exactly this, and the picker is a
 * pure renderer -- keeping the state machine here is what stops the two modals
 * from drifting apart. Follows the `useBidding` / `useDraftMovies` convention.
 *
 * @param movies Every movie in the offer, BOTH sides: the release anchor is the
 *   earliest release across the whole deal, because once any movie in it is out
 *   the information balance has already changed.
 */
export function useOfferExpiry(movies: ExpiryMovie[]): UseOfferExpiryReturn {
  const [choice, setChoiceState] = useState<ExpiryChoice>({
    kind: 'preset',
    hours: DEFAULT_EXPIRY_HOURS,
  })
  const [fellBack, setFellBack] = useState(false)

  const releaseAnchor = useMemo(() => resolveReleaseAnchor(movies), [movies])
  const resolution = useMemo(
    () => resolveExpiryChoice(choice, releaseAnchor),
    [choice, releaseAnchor]
  )

  const setChoice = useCallback((next: ExpiryChoice) => {
    setFellBack(false)
    setChoiceState(next)
  }, [])

  // The release chip can go stale under the user: pick "when X releases", then
  // drop X from the offer. Fall back to the default window and say so, rather
  // than leaving a dead chip selected and the submit button disabled.
  useEffect(() => {
    if (choice.kind === 'release' && !releaseAnchor.available) {
      setChoiceState({ kind: 'preset', hours: DEFAULT_EXPIRY_HOURS })
      setFellBack(true)
    }
  }, [choice.kind, releaseAnchor.available])

  const resolveNow = useCallback(
    () => resolveExpiryChoice(choice, releaseAnchor),
    [choice, releaseAnchor]
  )

  return { choice, setChoice, releaseAnchor, resolution, fellBack, resolveNow }
}
