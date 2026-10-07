'use client'

import { Fragment, useId } from 'react'
import { X } from 'lucide-react'
import { useModalDialog } from '@/hooks/useModalDialog'
import BetaBadge from '@/app/components/projections/BetaBadge'
import ProjectionChip from '@/app/components/projections/ProjectionChip'
import { ordinal } from '@/utils/franchise'
import { formatReleaseDateShort } from '@/utils/date'
import { formatFantasyPoints, formatSignedPoints, pointsTone } from '@/utils/scoring'
import { PROJECTION_DISCLAIMER } from '@/utils/projections'
import type { ProjectedLeg, ProjectedStanding } from '@/utils/projectedStandings'

interface Props {
  team: ProjectedStanding
  /** The whole projected table, for "projected 2nd of 6" and the next-closest team. */
  standings: ProjectedStanding[]
  onClose: () => void
}

/**
 * How a team's projected total adds up: what it has earned, then each movie
 * still to come at its most likely points. A centred dialog on wider screens
 * and a bottom sheet on a phone, opened from the projected score or bar on
 * the standings and from "How it adds up" on the roster.
 */
/** @design-system League */
export default function TeamProjectionSheet({ team, standings, onClose }: Props) {
  const titleId = useId()
  // A read-only view, so a tap on the dimmed area may close it too.
  const { dialogRef, requestClose } = useModalDialog(onClose, false, true)
  const earnedLegs = team.legs.filter((leg) => leg.basis === 'earned')
  const pendingLegs = team.legs
    .filter((leg) => leg.basis !== 'earned')
    .sort((a, b) => (a.release_date ?? '9999').localeCompare(b.release_date ?? '9999'))
  const index = standings.findIndex((row) => row.team_id === team.team_id)
  const nextClosest = standings[index === 0 ? 1 : index - 1]

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      data-testid="team-projection-sheet"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-foreground backdrop:bg-overlay backdrop:backdrop-blur-sm open:flex open:items-end sm:p-4 sm:open:items-center sm:open:justify-center"
    >
      <div className="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-border bg-surface shadow-heavy animate-slide-up motion-reduce:animate-none sm:max-w-lg sm:rounded-xl sm:border">
        <div className="mx-auto mt-2 h-1 w-10 flex-none rounded-full bg-border-hover sm:hidden" aria-hidden="true" />
        <div className="flex flex-none items-start justify-between gap-3 border-b border-border px-4 pb-4 pt-3 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            <h2 id={titleId} tabIndex={-1} data-dialog-initial-focus className="type-panel break-words text-foreground focus:outline-none">
              {team.team_name}
            </h2>
            <p className="type-body-sm mt-1 flex flex-wrap items-center gap-2 text-foreground-secondary">
              <span>
                Projected{' '}
                <span className="type-numeric font-bold text-gold">
                  <span aria-hidden="true">
                    {team.isTied ? 'T-' : ''}
                    {ordinal(team.projectedRank)}
                  </span>
                  <span className="sr-only">
                    {team.isTied ? 'tied for ' : ''}
                    {ordinal(team.projectedRank)}
                  </span>
                </span>{' '}
                of {standings.length}
              </span>
              <BetaBadge />
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="flex-none rounded-full border border-border p-2 text-foreground-secondary transition-colors hover:border-border-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <section className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="type-label text-foreground">Earned so far</h3>
              <p className="type-meta mt-1 break-words text-foreground-secondary">
                {earnedLegs.length > 0
                  ? earnedLegs.map((leg, legIndex) => (
                      <Fragment key={`${leg.counterpick ? 'cp' : 'h'}-${leg.tmdb_id}`}>
                        {legIndex > 0 && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="sr-only">, </span>
                          </>
                        )}
                        {leg.title} {formatSignedPoints(leg.points)}
                      </Fragment>
                    ))
                  : 'Nothing has counted yet.'}
              </p>
            </div>
            <span className="type-number flex-none text-foreground">
              {formatFantasyPoints(team.earned)}
              <span className="sr-only"> points earned</span>
            </span>
          </section>

          <section className="mt-5 border-t border-border pt-4">
            <h3 className="type-label text-foreground">Still to release</h3>
            {pendingLegs.length === 0 ? (
              <p className="type-body-sm mt-2 text-foreground-secondary">Every movie has counted.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {pendingLegs.map((leg) => (
                  <PendingLegRow key={`${leg.counterpick ? 'cp' : 'h'}-${leg.tmdb_id}`} leg={leg} />
                ))}
              </ul>
            )}
          </section>

          <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-border-hover pt-4">
            <span className="type-row-title text-foreground">Projected total</span>
            <span className="type-number-lg text-gold" data-testid="team-projection-total">
              <span aria-hidden="true">≈ </span>
              <span className="sr-only">about </span>
              {formatFantasyPoints(team.projected)}
            </span>
          </div>

          <p className="type-meta mt-4 text-foreground-secondary">
            Each unreleased movie counts at its most likely score.
            {nextClosest && (
              <>
                {' '}
                Next closest: {nextClosest.team_name} at about {formatFantasyPoints(nextClosest.projected)}.
              </>
            )}{' '}
            Rank and champions still come from real points only. {PROJECTION_DISCLAIMER}
          </p>
        </div>
      </div>
    </dialog>
  )
}

function PendingLegRow({ leg }: { leg: ProjectedLeg }) {
  return (
    <li className="flex items-center gap-3 py-3" data-testid="team-projection-leg">
      <div className="min-w-0 flex-1">
        <p className="type-row-title break-words text-foreground">{leg.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {leg.counterpick && <span className="type-meta text-crimson-text">Counterpick</span>}
          {leg.release_date && (
            <span className="type-meta text-foreground-secondary">{formatReleaseDateShort(leg.release_date)}</span>
          )}
          {leg.basis === 'projection' && leg.projection && (
            <ProjectionChip projection={leg.projection} counterpick={leg.counterpick} size="sm" />
          )}
          {leg.basis === 'pre_release' && <span className="type-meta text-foreground-secondary">Pre-release score</span>}
          {leg.basis === 'none' && <span className="type-meta text-foreground-secondary">No projection yet</span>}
        </div>
      </div>
      <span
        className={`type-number flex-none ${leg.basis === 'none' ? 'text-foreground-secondary' : pointsTone(leg.points, { positive: 'text-gold' })}`}
      >
        {leg.basis === 'none' ? (
          <span aria-hidden="true">—</span>
        ) : (
          <>
            <span aria-hidden="true">≈ </span>
            <span className="sr-only">about </span>
            {formatSignedPoints(leg.points)}
            <span className="sr-only"> points</span>
          </>
        )}
      </span>
    </li>
  )
}
