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
  /** True when a stale release pick was swapped out from under the user. */
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

  // The release chip can go stale under the user in two ways: every unreleased
  // movie leaves the offer, or just the one they picked does. Losing the whole
  // option falls back to the default window; losing only the picked movie falls
  // back to the soonest remaining one, which is a smaller surprise than
  // switching them off the release anchor entirely.
  useEffect(() => {
    if (choice.kind !== 'release') return

    if (!releaseAnchor.available) {
      setChoiceState({ kind: 'preset', hours: DEFAULT_EXPIRY_HOURS })
      setFellBack(true)
      return
    }

    const stillThere =
      choice.movieId === null ||
      releaseAnchor.candidates.some((candidate) => candidate.movieId === choice.movieId)

    if (!stillThere) {
      setChoiceState({ kind: 'release', movieId: null })
      setFellBack(true)
    }
  }, [choice, releaseAnchor])

  const resolveNow = useCallback(
    () => resolveExpiryChoice(choice, releaseAnchor),
    [choice, releaseAnchor]
  )

  return { choice, setChoice, releaseAnchor, resolution, fellBack, resolveNow }
}
