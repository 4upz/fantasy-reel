'use client'

import { useMemo } from 'react'
import DateTimeField from '@/app/components/DateTimeField'
import {
  DEFAULT_EXPIRY_HOURS,
  EXPIRY_PRESETS,
  MAX_EXPIRY_DAYS,
  MIN_EXPIRY_MINUTES,
  formatExpiryAbsolute,
  toDateTimeLocalValue,
  type ExpiryChoice,
  type ExpiryResolution,
  type ReleaseAnchor,
} from '@/utils/tradeExpiry'

/** Everything here comes from useOfferExpiry; this component only renders. */
interface Props {
  releaseAnchor: ReleaseAnchor
  value: ExpiryChoice
  onChange: (choice: ExpiryChoice) => void
  resolution: ExpiryResolution
  fellBack: boolean
}

function Chip({
  selected,
  disabled,
  title,
  onClick,
  children,
}: {
  selected: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={selected}
      className={`btn px-3 py-1 text-sm ${
        selected
          ? 'btn-secondary'
          : 'bg-elevated border border-border text-foreground-secondary hover:border-border-hover hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * How long an offer stands before it lapses.
 *
 * Presets, a release anchor and a custom time all resolve to one instant, which
 * is always spelled out underneath -- `datetime-local` shows no timezone, and
 * "3 days" is otherwise date math the user has to do themselves.
 */
export default function OfferExpiryPicker({
  releaseAnchor,
  value,
  onChange,
  resolution,
  fellBack,
}: Props) {
  const { minValue, maxValue } = useMemo(() => {
    const now = Date.now()
    return {
      minValue: toDateTimeLocalValue(new Date(now + MIN_EXPIRY_MINUTES * 60_000)),
      maxValue: toDateTimeLocalValue(new Date(now + MAX_EXPIRY_DAYS * 24 * 60 * 60_000)),
    }
  }, [])

  const resolvedAt = resolution.ok ? resolution.expiry.expires_at : null
  const error = resolution.ok ? null : resolution.error

  return (
    <div>
      <span className="text-sm text-foreground-secondary">Offer expires</span>

      <div className="mt-1 flex flex-wrap gap-2">
        {EXPIRY_PRESETS.map((preset) => (
          <Chip
            key={preset.hours}
            selected={value.kind === 'preset' && value.hours === preset.hours}
            onClick={() => onChange({ kind: 'preset', hours: preset.hours })}
          >
            {preset.label}
          </Chip>
        ))}

        <Chip
          selected={value.kind === 'release'}
          disabled={!releaseAnchor.available}
          // The reason is on the chip itself rather than left to a silently
          // greyed control -- "already out" and "no release date" are ordinary
          // situations a proposer should be able to understand at a glance.
          title={releaseAnchor.reason}
          onClick={() => onChange({ kind: 'release' })}
        >
          {releaseAnchor.title ? `When ${releaseAnchor.title} releases` : 'When it releases'}
        </Chip>

        <Chip
          selected={value.kind === 'custom'}
          onClick={() =>
            onChange({
              kind: 'custom',
              value: toDateTimeLocalValue(new Date(Date.now() + 24 * 60 * 60_000)),
            })
          }
        >
          Custom…
        </Chip>

        <Chip selected={value.kind === 'none'} onClick={() => onChange({ kind: 'none' })}>
          No expiry
        </Chip>
      </div>

      {value.kind === 'custom' && (
        <DateTimeField
          className="mt-2"
          label="Expires at"
          value={value.value}
          min={minValue}
          max={maxValue}
          onChange={(next) => onChange({ kind: 'custom', value: next })}
          error={error}
        />
      )}

      {/* The resolved instant, always. A chip alone never says when. */}
      {resolvedAt && (
        <p className="mt-2 text-sm text-foreground-muted">
          Expires <time dateTime={resolvedAt}>{formatExpiryAbsolute(resolvedAt)}</time>
        </p>
      )}

      {value.kind === 'none' && (
        <p className="mt-2 text-sm text-foreground-muted">This offer will stand until answered.</p>
      )}

      {fellBack && (
        <p role="status" className="mt-2 text-sm text-warning">
          {releaseAnchor.reason ?? 'That release no longer applies'} — switched to{' '}
          {DEFAULT_EXPIRY_HOURS} hours.
        </p>
      )}

      {error && value.kind !== 'custom' && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  )
}
