'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import DateTimeField from '@/app/components/DateTimeField'
import { announce } from '@/utils/announce'
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

/** An unselected chip, shared by the radio chips and the release chip's caret. */
const CHIP_IDLE =
  'bg-elevated border border-border text-foreground-secondary hover:border-border-hover hover:text-foreground'

/** The ring a chip shows while its visually hidden radio has keyboard focus. */
const CHIP_FOCUS =
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold'

/**
 * A selectable expiry chip: a native radio styled as a button, so a row of
 * chips is one radio group -- one Tab stop, arrow keys to choose, and the
 * choice announced as selected. Exported because the extend modal renders the
 * same row of choices -- two copies of this className pair drift the moment a
 * token changes in one of them.
 */
/** @design-system League */
export function Chip({
  name,
  checked,
  disabled,
  title,
  onSelect,
  className = '',
  children,
}: {
  /** Shared by every chip in one group. */
  name: string
  checked: boolean
  disabled?: boolean
  title?: string
  onSelect: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <label
      title={title}
      className={`type-control btn px-3 py-1 ${checked ? 'btn-secondary' : CHIP_IDLE} ${CHIP_FOCUS} ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      {children}
    </label>
  )
}

/**
 * The release option: a chip that names the movie being waited on, plus a caret
 * that swaps it for another unreleased movie in the trade.
 *
 * The caret only exists when there is a second candidate -- a control that
 * opens an empty list is worse than no control. The menu shows each release
 * date because that is the whole basis for choosing between them. It is a
 * plain disclosure of buttons rather than an ARIA listbox: Tab moves through
 * it, and Escape or tabbing away closes it.
 */
function ReleaseChip({
  name,
  anchor,
  selected,
  chosen,
  onSelect,
}: {
  name: string
  anchor: ReleaseAnchor
  selected: boolean
  chosen: AnchorCandidate | undefined
  onSelect: (movieId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const menuId = useId()

  const label = chosen ? `When ${chosen.title} releases` : 'When it releases'
  const hasChoice = anchor.available && anchor.candidates.length > 1

  useEffect(() => {
    if (!open) return

    // Open on the movie already chosen, so the menu starts where the choice is.
    const menu = menuRef.current
    const current =
      menu?.querySelector<HTMLButtonElement>('[aria-current="true"]') ??
      menu?.querySelector<HTMLButtonElement>('button')
    current?.focus()

    // A click or Tab that lands outside closes the menu rather than leaving it hanging.
    const onOutside = (event: Event) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Escape belongs to the menu first. preventDefault stops the dialog
      // behind from treating it as its own cancel.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      caretRef.current?.focus()
    }

    document.addEventListener('mousedown', onOutside)
    document.addEventListener('focusin', onOutside)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('focusin', onOutside)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const segment = selected ? 'btn-secondary' : CHIP_IDLE

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Chip
        name={name}
        checked={selected}
        onSelect={() => onSelect(chosen?.movieId ?? null)}
        disabled={!anchor.available}
        title={anchor.reason}
        className={hasChoice ? 'rounded-r-none border-r-0' : ''}
      >
        {label}
        {/* Otherwise the reason is only a hover tooltip on a control that can't take focus. */}
        {!anchor.available && anchor.reason && (
          <span className="sr-only"> (unavailable: {anchor.reason})</span>
        )}
      </Chip>

      {hasChoice && (
        <button
          ref={caretRef}
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label="Choose which release to wait for"
          className={`type-control btn px-2 py-1 rounded-l-none border-l border-l-border ${segment}`}
        >
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      )}

      {open && (
        <ul
          ref={menuRef}
          role="list"
          id={menuId}
          aria-label="Movies this offer can wait for"
          className="absolute top-full left-0 z-10 mt-1 min-w-64 card p-1 shadow-heavy animate-fade-in"
        >
          {anchor.candidates.map((candidate) => {
            const isChosen = candidate.movieId === chosen?.movieId
            return (
              <li key={candidate.movieId}>
                <button
                  type="button"
                  aria-current={isChosen ? 'true' : undefined}
                  onClick={() => {
                    onSelect(candidate.movieId)
                    setOpen(false)
                    caretRef.current?.focus()
                  }}
                  className={`type-control w-full flex items-baseline justify-between gap-4 px-3 py-2 rounded text-left transition-colors cursor-pointer ${
                    isChosen ? 'bg-surface-hover text-gold' : 'text-foreground hover:bg-surface-hover'
                  }`}
                >
                  <span>{candidate.title}</span>
                  <span className="type-meta text-foreground-secondary shrink-0">
                    {formatReleaseDate(candidate.releaseDate)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
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
/** @design-system League */
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
  const name = useId()

  // A radio says which chip is selected but never when the offer lapses, so
  // the resolved instant is spoken once per choice. Not a live region: a
  // preset re-resolves against the clock on every render, and a region would
  // read the time out again each minute while the user types elsewhere.
  const spokenChoice = useRef(value)
  useEffect(() => {
    const previous = spokenChoice.current
    if (previous === value) return
    spokenChoice.current = value
    // Edits inside the custom field are voiced by the field itself.
    if (value.kind === 'custom' && previous.kind === 'custom') return
    if (resolvedAt) announce(`Expires ${formatExpiryAbsolute(resolvedAt)}`)
    else if (value.kind === 'none') announce('This offer will stand until answered.')
  }, [value, resolvedAt])

  return (
    <fieldset>
      <legend className="type-body-sm text-foreground-secondary">Offer expires</legend>

      <div className="mt-1 flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Chip
            key={preset.hours}
            name={name}
            checked={value.kind === 'preset' && value.hours === preset.hours}
            onSelect={() => onChange({ kind: 'preset', hours: preset.hours })}
          >
            {preset.label}
          </Chip>
        ))}

        <ReleaseChip
          name={name}
          anchor={releaseAnchor}
          selected={value.kind === 'release'}
          chosen={chosenAnchor}
          onSelect={(movieId) => onChange({ kind: 'release', movieId })}
        />

        <Chip
          name={name}
          checked={value.kind === 'custom'}
          onSelect={() =>
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

        <Chip name={name} checked={value.kind === 'none'} onSelect={() => onChange({ kind: 'none' })}>
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
        <p className="type-body-sm mt-2 text-foreground-secondary">
          Expires <time dateTime={resolvedAt}>{formatExpiryAbsolute(resolvedAt)}</time>
        </p>
      )}

      {value.kind === 'none' && (
        <p className="type-body-sm mt-2 text-foreground-secondary">This offer will stand until answered.</p>
      )}

      {/* Always mounted, so the notice is announced when it appears. */}
      <div role="status">
        {fellBack && (
          <p className="type-body-sm mt-2 text-warning">
            {value.kind === 'release'
              ? `That movie left the trade — now waiting on ${chosenAnchor?.title ?? 'the soonest release'}.`
              : `${releaseAnchor.reason ?? 'That release no longer applies'} — switched to ${bounds.defaultHours} hours.`}
          </p>
        )}
      </div>

      {error && value.kind !== 'custom' && (
        <p role="alert" className="type-body-sm mt-2 text-error">
          {error}
        </p>
      )}
    </fieldset>
  )
}
