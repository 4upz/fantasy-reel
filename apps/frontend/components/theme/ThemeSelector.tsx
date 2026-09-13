'use client'

import { useId } from 'react'
import { parseThemePreference } from '@/utils/theme'
import { useTheme } from './ThemeProvider'

const options = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

export default function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference, ready } = useTheme()
  const id = useId()
  const selectedIndex = options.findIndex(option => option.value === preference)

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">Theme</label>
        <select
          id={id}
          value={preference}
          onChange={event => setPreference(parseThemePreference(event.target.value))}
          disabled={!ready}
          className="input type-control min-h-11 w-auto cursor-pointer"
          data-testid="theme-select"
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <fieldset disabled={!ready} data-testid="theme-selector">
      <legend className="type-label mb-2 text-foreground-secondary">Theme</legend>
      <div className="relative grid grid-cols-3 gap-1 rounded-lg border border-border bg-elevated p-1">
        {ready && (
          <span
            aria-hidden="true"
            data-testid="theme-selection-indicator"
            className="pointer-events-none absolute inset-y-1 left-1 rounded-md border-2 border-gold bg-surface transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{
              // Match three equal columns, accounting for row padding and gaps.
              width: 'calc((100% - 1rem) / 3)',
              transform: `translateX(calc(${selectedIndex * 100}% + ${selectedIndex * 0.25}rem))`,
            }}
          />
        )}
        {options.map(({ value, label }) => (
          <label key={value} className="relative cursor-pointer">
            <input
              type="radio"
              name={id}
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
              className="peer sr-only"
            />
            <span className="type-control flex min-h-11 items-center justify-center rounded-md border-2 border-transparent px-1 py-2 text-foreground-secondary transition-colors hover:text-foreground peer-checked:text-gold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold motion-reduce:transition-none">
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
