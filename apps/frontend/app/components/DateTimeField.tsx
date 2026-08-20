'use client'

import { useId } from 'react'

interface Props {
  label: string
  /** `datetime-local` wall-clock value, `YYYY-MM-DDTHH:mm`. */
  value: string
  onChange: (value: string) => void
  /** Earliest selectable value, same format as `value`. */
  min?: string
  /** Latest selectable value, same format as `value`. */
  max?: string
  error?: string | null
  className?: string
}

/**
 * A date + time field in the Cinematic Dark style.
 *
 * The app's first date/time input -- league draft and bidding windows are the
 * obvious next callers, which is why it lives here rather than inside the trade
 * modal that needed it.
 *
 * Native `<input type="datetime-local">` on purpose: it brings the native wheel
 * picker on iOS and Android, costs no bundle weight, and is keyboard accessible
 * without any work. The price is that it looks slightly different per browser,
 * which is a fair trade for a field used once per trade proposal.
 *
 * `min`/`max` are a convenience for the native picker, NOT a guarantee -- they
 * are trivially edited and are not honored uniformly. Callers must validate the
 * value themselves, and the server must validate it again.
 */
export default function DateTimeField({
  label,
  value,
  onChange,
  min,
  max,
  error,
  className = '',
}: Props) {
  const id = useId()

  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm text-foreground-secondary">
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="input mt-1 w-full"
      />
      {error && (
        // role="alert" so the message is announced when it appears, and a
        // leading marker so the invalid state is not carried by color alone.
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-error">
          <span aria-hidden="true">! </span>
          {error}
        </p>
      )}
    </div>
  )
}
