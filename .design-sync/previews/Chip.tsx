import { useState } from 'react'
import { Chip } from 'fantasy-reel'

/** Selection is controlled by the containing picker, with a pressed state. */
export const Default = () => {
  const [hours, setHours] = useState(48)

  return (
    <div className="flex flex-wrap items-start gap-2" role="group" aria-label="Offer duration">
      <Chip selected={hours === 24} onClick={() => setHours(24)}>24h</Chip>
      <Chip selected={hours === 48} onClick={() => setHours(48)}>48h</Chip>
      <Chip selected={hours === 72} onClick={() => setHours(72)}>3 days</Chip>
    </div>
  )
}

/** An unavailable release anchor retains its explanatory title. */
export const Disabled = () => (
  <div className="flex items-start">
    <Chip selected={false} disabled title="Add a movie to use this" onClick={() => {}}>
      When it releases
    </Chip>
  </div>
)
