'use client'

import { useMemo, useState } from 'react'
import type { LeagueUpcomingRelease } from '@/types'
import LeagueMovieModal from './LeagueMovieModal'
import { SectionHeader } from './MovieGrid'

interface Props {
  releases: LeagueUpcomingRelease[]
  /** The server's date, so the countdown cannot disagree with the markup. */
  todayIso: string
}

/**
 * How many releases the board shows before it asks to be expanded. Sized to
 * roughly a phone screen of rows, which is far enough ahead to be worth
 * scanning without turning the overview into the whole schedule.
 */
const COLLAPSED_COUNT = 8

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Dates here are handled as `YYYY-MM-DD` text, never as `Date`. `new
 * Date('2026-09-18')` is UTC midnight, so it prints as the 17th anywhere west
 * of UTC - which is fine for a loose "Sep 17, 2026" elsewhere in the app, but
 * not for a board whose whole left column is the day of the month.
 */
function toUtcMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function daysUntil(iso: string, todayIso: string): number {
  return Math.round((toUtcMs(iso) - toUtcMs(todayIso)) / 86_400_000)
}

/** The year only earns its place once the list runs past December. */
function monthLabel(iso: string, todayIso: string): string {
  const [year, month] = iso.split('-')
  const name = MONTH_NAMES[Number(month) - 1]
  return year === todayIso.slice(0, 4) ? name : `${name} ${year}`
}

/**
 * Only the two dates that change what you do today get a word. Everything
 * further out is already answered by the day number and the month rule.
 */
function imminenceLabel(iso: string, todayIso: string): string | null {
  const days = daysUntil(iso, todayIso)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return null
}

/** "Golden Globe Gang · Bob Nolan", collapsed when they say the same thing. */
function holderLine(release: LeagueUpcomingRelease): string {
  const { team_name, owner_name } = release
  if (!owner_name || owner_name === team_name) return team_name
  return `${team_name} · ${owner_name}`
}

function ReleaseRow({
  release,
  todayIso,
  withRule,
  onSelect,
}: {
  release: LeagueUpcomingRelease
  todayIso: string
  withRule: boolean
  onSelect: (release: LeagueUpcomingRelease) => void
}) {
  const imminence = imminenceLabel(release.release_date, todayIso)
  const isYours = release.is_current_user_team

  return (
    <button
      type="button"
      onClick={() => onSelect(release)}
      data-testid="league-release-row"
      // Deliberately not "View {title}": MovieGrid already labels a button that
      // way for the same movie when it is yours, and Playwright's getByRole
      // matches an accessible name by substring - so "View {title}" here would
      // make every such lookup ambiguous and fail on strict mode.
      aria-label={`Details for ${release.title}, held by ${release.team_name}`}
      className={`flex w-full items-center gap-3 border-l-2 py-2.5 pl-2.5 pr-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold ${
        isYours ? 'border-l-gold' : 'border-l-transparent'
      } ${withRule ? 'border-t border-t-border' : ''}`}
    >
      <span className="w-6 flex-none text-center font-mono text-[17px] font-semibold leading-none tabular-nums text-foreground-secondary">
        {Number(release.release_date.slice(8, 10))}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground" title={release.title}>
          {release.title}
        </span>
        <span
          className={`mt-[3px] block truncate text-xs ${isYours ? 'text-gold' : 'text-foreground-muted'}`}
        >
          {holderLine(release)}
        </span>
      </span>

      {imminence && (
        <span className="flex-none text-[11px] font-bold uppercase tracking-[0.08em] text-foreground-secondary">
          {imminence}
        </span>
      )}
    </button>
  )
}

/**
 * Every unreleased movie in the league, in the order it opens.
 *
 * Read as a calendar rather than a shelf: the overview above it is already two
 * poster rails of your own movies, and what this section adds is chronology and
 * ownership - when the next thing lands, and whose it is. Hence the month rules
 * and the day column instead of a third row of posters. Posters live one tap
 * away, in the movie dialog a row opens.
 */
export default function LeagueReleaseBoard({ releases, todayIso }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<LeagueUpcomingRelease | null>(null)

  const months = useMemo(() => {
    const visible = expanded ? releases : releases.slice(0, COLLAPSED_COUNT)
    const groups: { key: string; label: string; releases: LeagueUpcomingRelease[] }[] = []

    for (const release of visible) {
      const key = release.release_date.slice(0, 7)
      const current = groups[groups.length - 1]
      if (current?.key === key) current.releases.push(release)
      else groups.push({ key, label: monthLabel(release.release_date, todayIso), releases: [release] })
    }

    return groups
  }, [releases, expanded, todayIso])

  // Nothing upcoming means the season is over, or has not started. Either way
  // the overview above already says so, and an empty card would just repeat it.
  if (releases.length === 0) return null

  return (
    <section className="mt-[18px] animate-fade-in" data-testid="league-release-board">
      <SectionHeader title="Around the league" count={releases.length} />

      <div className="mx-4 overflow-hidden rounded-[14px] border border-border bg-surface">
        <div className={expanded ? 'max-h-[60vh] overflow-y-auto' : ''}>
          {months.map((month, monthIndex) => (
            <div key={month.key}>
              <div className={`flex items-center gap-2.5 px-3 pb-1.5 ${monthIndex === 0 ? 'pt-3' : 'pt-4'}`}>
                <h4 className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-muted">
                  {month.label}
                </h4>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>

              {month.releases.map((release, index) => (
                <ReleaseRow
                  key={release.id}
                  release={release}
                  todayIso={todayIso}
                  withRule={index > 0}
                  onSelect={setSelected}
                />
              ))}
            </div>
          ))}
        </div>

        {releases.length > COLLAPSED_COUNT && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            data-testid="league-release-expand"
            className="w-full border-t border-border py-2.5 text-sm font-medium text-gold transition-colors hover:bg-surface-hover hover:text-gold-hover"
          >
            {expanded ? 'Show less' : `Show all ${releases.length} releases`}
          </button>
        )}
      </div>

      {/* Looking, not managing: most of these are someone else's movie, and even
          your own is the roster's to act on. */}
      {selected && (
        <LeagueMovieModal
          movie={selected}
          contextHeading={selected.is_current_user_team ? 'On your roster' : `On ${selected.team_name}`}
          contextLabel={selected.owner_name ?? undefined}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}
