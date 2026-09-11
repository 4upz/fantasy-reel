import { useState } from 'react'
import { OfferExpiryPicker } from 'fantasy-reel'
import {
  DEFAULT_EXPIRY_BOUNDS,
  resolveExpiryChoice,
  resolveReleaseAnchor,
  toDateTimeLocalValue,
  type ExpiryChoice,
  type ExpiryMovie,
} from '../../apps/frontend/utils/tradeExpiry'

function PickerStory({ initialChoice }: { initialChoice: 'preset' | 'release' | 'invalid' }) {
  const [choice, setChoice] = useState<ExpiryChoice>(() => {
    if (initialChoice === 'release') return { kind: 'release', movieId: null }
    if (initialChoice === 'invalid') {
      return { kind: 'custom', value: toDateTimeLocalValue(new Date(Date.now() - 60 * 60_000)) }
    }
    return { kind: 'preset', hours: DEFAULT_EXPIRY_BOUNDS.defaultHours }
  })

  // The capture clock and the live design pane differ. Resolve both the movie
  // dates and the selected expiry against the current render's clock.
  const now = Date.now()
  const movies: ExpiryMovie[] = [
    { movie_id: 'aurora-four', title: 'Aurora: New Dawn', release_date: new Date(now + 4 * 86_400_000).toISOString().slice(0, 10) },
    { movie_id: 'last-screening', title: 'The Last Screening', release_date: new Date(now + 9 * 86_400_000).toISOString().slice(0, 10) },
  ]
  const releaseAnchor = resolveReleaseAnchor(movies, DEFAULT_EXPIRY_BOUNDS, now)

  return (
    <div className="card max-w-2xl p-4">
      <OfferExpiryPicker
        releaseAnchor={releaseAnchor}
        value={choice}
        onChange={setChoice}
        resolution={resolveExpiryChoice(choice, releaseAnchor, DEFAULT_EXPIRY_BOUNDS, now)}
        fellBack={false}
        bounds={DEFAULT_EXPIRY_BOUNDS}
      />
    </div>
  )
}

/** Presets, custom time, and no expiry update the real resolved summary. */
export const Default = () => <PickerStory initialChoice="preset" />

/** Two upcoming movies make the release selector's dropdown available. */
export const ReleaseAnchored = () => <PickerStory initialChoice="release" />

/** A past custom time shows validation and can be corrected in the field. */
export const InvalidCustomDate = () => <PickerStory initialChoice="invalid" />
