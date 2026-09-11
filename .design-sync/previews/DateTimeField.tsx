import { useState } from 'react'
import { DateTimeField } from 'fantasy-reel'
import { daysOut } from './_fixtures'

export const Default = () => {
  const [value, setValue] = useState(() => `${daysOut(2)}T20:00`)

  return (
    <div className="max-w-sm">
      <DateTimeField label="Offer expires" value={value} onChange={setValue} />
    </div>
  )
}

export const Empty = () => {
  const [value, setValue] = useState('')

  return (
    <div className="max-w-sm">
      <DateTimeField label="Draft starts" value={value} onChange={setValue} />
    </div>
  )
}

export const OutsideAllowedWindow = () => {
  const [value, setValue] = useState(() => `${daysOut(1)}T20:00`)
  const min = `${daysOut(2)}T09:00`
  const max = `${daysOut(7)}T20:00`
  const error = !value
    ? 'Choose an expiry time.'
    : value < min || value > max
      ? 'Choose a time within the allowed offer window.'
      : null

  return (
    <div className="max-w-sm space-y-2">
      <DateTimeField label="Offer expires" value={value} onChange={setValue} min={min} max={max} error={error} />
      <p className="type-body-sm text-foreground-secondary">Offers can expire between two and seven days from today.</p>
    </div>
  )
}
