'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import DateTimeField from '@/app/components/DateTimeField'
import {
  anchorFor,
  expiryPresetsFor,
  formatExpiryAbsolute,
  formatReleaseDate,
  toDateTimeLocalValue,
  type AnchorCandidate,
  type ExpiryBounds,
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
  /** The league's window rules -- which chips exist, and what the field allows. */
  bounds: ExpiryBounds
}

/**
 * A selectable expiry chip. Exported because the extend modal renders the same
 * row of choices -- two copies of this className pair drift the moment a token
 * changes in one of them.
 */
export function Chip({
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
 * The release option: a chip that names the movie being waited on, plus a caret
 * that swaps it for another unreleased movie in the trade.
 *
 * The caret only exists when there is a second candidate -- a control that
 * opens an empty list is worse than no control. The menu shows each release
 * date because that is the whole basis for choosing between them.
 */
function ReleaseChip({
  anchor,
  selected,
  chosen,
  onSelect,
}: {
  anchor: ReleaseAnchor
  selected: boolean
  chosen: AnchorCandidate | undefined
  onSelect: (movieId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLButtonElement>(null)

  const label = chosen ? `When ${chosen.title} releases` : 'When it releases'
  const hasChoice = anchor.available && anchor.candidates.length > 1

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Escape belongs to the menu first; without stopping it here the modal
      // behind would close too.
      event.stopPropagation()
      setOpen(false)
      caretRef.current?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const segment = selected
    ? 'btn-secondary'
    : 'bg-elevated border border-border text-foreground-secondary hover:border-border-hover hover:text-foreground'

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => onSelect(chosen?.movieId ?? null)}
        disabled={!anchor.available}
        title={anchor.reason}
        aria-pressed={selected}
        className={`btn px-3 py-1 text-sm ${segment} ${
          hasChoice ? 'rounded-r-none border-r-0' : ''
        }`}
      >
        {label}
      </button>

      {hasChoice && (
        <button
          ref={caretRef}
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Choose which release to wait for"
          className={`btn px-2 py-1 text-sm rounded-l-none border-l border-l-border ${segment}`}
        >
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      )}

      {open && (
        <div
          role="listbox"
          aria-label="Movies this offer can wait for"
          className="absolute top-full left-0 z-10 mt-1 min-w-64 card p-1 shadow-heavy animate-fade-in"
        >
          {anchor.candidates.map((candidate) => {
            const isChosen = candidate.movieId === chosen?.movieId
            return (
              <button
                key={candidate.movieId}
                type="button"
                role="option"
                aria-selected={isChosen}
                onClick={() => {
                  onSelect(candidate.movieId)
                  setOpen(false)
                  caretRef.current?.focus()
                }}
                className={`w-full flex items-baseline justify-between gap-4 px-3 py-2 rounded text-left text-sm transition-colors ${
                  isChosen ? 'bg-surface-hover text-gold' : 'text-foreground hover:bg-surface-hover'
                }`}
              >
                <span>{candidate.title}</span>
                <span className="text-xs text-foreground-muted shrink-0">
                  {formatReleaseDate(candidate.releaseDate)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
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
  bounds,
}: Props) {
  // What the chip names: the picked movie, or the soonest when none was picked.
  const chosenAnchor = anchorFor(
    releaseAnchor,
    value.kind === 'release' ? value.movieId : null
  )

  const presets = useMemo(() => expiryPresetsFor(bounds), [bounds])

  const { minValue, maxValue } = useMemo(() => {
    const now = Date.now()
    return {
      minValue: toDateTimeLocalValue(new Date(now + bounds.minMinutes * 60_000)),
      maxValue: toDateTimeLocalValue(new Date(now + bounds.maxDays * 24 * 60 * 60_000)),
    }
  }, [bounds])

  const resolvedAt = resolution.ok ? resolution.expiry.expires_at : null
  const error = resolution.ok ? null : resolution.error

  return (
    <div>
      <span className="text-sm text-foreground-secondary">Offer expires</span>

      <div className="mt-1 flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Chip
            key={preset.hours}
            selected={value.kind === 'preset' && value.hours === preset.hours}
            onClick={() => onChange({ kind: 'preset', hours: preset.hours })}
          >
            {preset.label}
          </Chip>
        ))}

        <ReleaseChip
          anchor={releaseAnchor}
          selected={value.kind === 'release'}
          chosen={chosenAnchor}
          onSelect={(movieId) => onChange({ kind: 'release', movieId })}
        />

        <Chip
          selected={value.kind === 'custom'}
          onClick={() =>
            onChange({
              kind: 'custom',
              // Seeded at the league's own default rather than a flat 24h: the
              // field then opens on a time that is inside the bounds whatever
              // the commissioner set them to.
              value: toDateTimeLocalValue(new Date(Date.now() + bounds.defaultHours * 60 * 60_000)),
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
          {value.kind === 'release'
            ? `That movie left the trade — now waiting on ${chosenAnchor?.title ?? 'the soonest release'}.`
            : `${releaseAnchor.reason ?? 'That release no longer applies'} — switched to ${bounds.defaultHours} hours.`}
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
