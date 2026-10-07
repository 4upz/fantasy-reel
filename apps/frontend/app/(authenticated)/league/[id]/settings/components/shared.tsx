'use client'

import type { LucideIcon } from 'lucide-react'
import { Lock } from 'lucide-react'

interface SectionHeaderProps {
  icon: LucideIcon
  title: string
  description: string
  isLocked?: boolean
  /** Id for the heading, so the section can be named by it. */
  headingId?: string
}

/**
 * Consistent header for settings sections with icon, title, and description.
 * An h3: the league's name is the page's h1 and "League settings" its h2.
 * @design-system Settings primitives
 */
export function SectionHeader({
  icon: Icon,
  title,
  description,
  isLocked = false,
  headingId,
}: SectionHeaderProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
      <div className={`p-2 rounded-lg ${isLocked ? 'bg-surface-hover' : 'bg-gold/10'}`}>
        {isLocked ? (
          <Lock className="w-5 h-5 text-foreground-muted" />
        ) : (
          <Icon className="w-5 h-5 text-gold" />
        )}
      </div>
      <div>
        <h3 id={headingId} className="type-section text-foreground">
          {title}
        </h3>
        <p className="type-body-sm text-foreground-secondary">
          {description}
        </p>
      </div>
    </div>
  )
}

interface LockedMessageProps {
  message: string
}

/**
 * Consistent locked state message box for settings sections
 * @design-system Settings primitives
 */
export function LockedMessage({ message }: LockedMessageProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 p-4 bg-surface-hover rounded-lg border border-border">
      <Lock className="w-5 h-5 text-foreground-muted shrink-0" />
      <p className="type-body-sm text-foreground-secondary">{message}</p>
    </div>
  )
}

/** Space-separated ids for aria-describedby, or undefined when there are none. */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ')
  return joined || undefined
}

interface NumberFieldProps {
  id: string
  /** The visible label. Pass a node to add words only a screen reader hears. */
  label: React.ReactNode
  /** Shown after the input ("hours") and read as part of the field's name. */
  unit?: string
  value: number | string
  /** The raw input value; callers parse it their own way. */
  onChange: (raw: string) => void
  min: number
  max: number
  placeholder?: string
  /** Helper text under the field, linked as its description. */
  help?: React.ReactNode
  /** Shown, linked and announced while the value is invalid. */
  error?: string | null
  /** Input width class. */
  widthClass?: string
}

/**
 * A labelled number input for settings forms: the unit is part of its name,
 * the help and any error are its description, and an error marks it invalid
 * and is announced -- not just a red border and a Save button that went grey.
 * @design-system Settings primitives
 */
export function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  min,
  max,
  placeholder,
  help,
  error,
  widthClass = 'w-24',
}: NumberFieldProps): React.ReactElement {
  const helpId = help ? `${id}_help` : undefined
  const errorId = error ? `${id}_error` : undefined

  return (
    <div>
      <label htmlFor={id} className="type-label block text-foreground-secondary mb-2">
        {label}
        {unit && <span className="sr-only"> ({unit})</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          min={min}
          max={max}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(helpId, errorId)}
          className={`type-input type-numeric input ${widthClass} ${error ? 'border-error focus:border-error' : ''}`}
        />
        {unit && (
          <span className="type-body-sm text-foreground-secondary" aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {help && (
        <p id={helpId} className="type-meta text-foreground-secondary mt-1.5">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="type-meta text-error mt-1">
          {error}
        </p>
      )}
    </div>
  )
}
