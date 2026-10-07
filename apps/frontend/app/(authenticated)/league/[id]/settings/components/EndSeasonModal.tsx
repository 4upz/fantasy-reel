'use client'

import { useCallback, useId, useState } from 'react'
import { X } from 'lucide-react'
import Modal from '@/app/components/Modal'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { podiumChipClass } from '@/utils/league'
import { formatFantasyPoints } from '@/utils/scoring'
import { daysUntil, formatSeasonDate } from '@/utils/seasons'
import type { League, StandingRow } from '@/types'
import { ButtonSpinner } from '../../components/Icons'

export interface CompleteLeagueResponse {
  league: League
  message: string
  /** The final podium, in rank order, as `complete_league` reports it. */
  top_teams: { teamId: string; teamName: string; points: number; rank: number }[]
  winner_team_ids: string[]
}

interface Props {
  leagueId: string
  seasonYear: number
  /** `YYYY-MM-DD`. Drives the "you're ending it early" warning. */
  seasonEnd: string
  /** Current standings, so the modal can name the team that would win. */
  standings: StandingRow[]
  isLoadingStandings: boolean
  standingsError?: string | null
  onClose: () => void
  onCompleted: (result: CompleteLeagueResponse) => void
}

/**
 * The confirmation for ending a season.
 *
 * Ending is irreversible in this version, so the modal is built to make a
 * *mistimed* end visibly wrong before it happens: it names the team that would
 * win, counts the days being cut short, and gates the button behind typing the
 * season year. Typing the year rather than the league name is deliberate - it
 * is the one value that distinguishes this season from its siblings, so it
 * makes ending the wrong season impossible rather than merely tedious.
 */
/** @design-system Modals */
export default function EndSeasonModal({
  leagueId,
  seasonYear,
  seasonEnd,
  standings,
  isLoadingStandings,
  standingsError = null,
  onClose,
  onCompleted,
}: Props): React.ReactElement {
  const [confirmText, setConfirmText] = useState('')

  const endSeason = useCallback(async () => {
    const { data, error } = await callEdgeFunction<CompleteLeagueResponse>('update-league', {
      body: { action: 'complete_league', league_id: leagueId },
    })

    if (error) throw new Error(error)
    if (data?.league) onCompleted(data)
    return data
  }, [leagueId, onCompleted])

  const { execute, isLoading, error } = useAsyncAction(endSeason)
  const titleId = useId()
  const outcomeId = useId()
  const standingsErrorId = useId()
  const earlyId = useId()

  const topThree = standings.slice(0, 3)
  const leaders = standings.filter((row) => row.rank === 1)
  const leaderNames = leaders.map((row) => row.team_name)
  const titleLine =
    leaderNames.length === 0
      ? 'No participating teams, so no champion would be recorded.'
      : leaderNames.length === 1
        ? `${leaderNames[0]} wins the ${seasonYear} title.`
        : `${leaderNames.join(' and ')} share the ${seasonYear} title.`

  const daysEarly = daysUntil(seasonEnd)
  const isConfirmed = confirmText.trim() === String(seasonYear)
  const summaryId = standingsError ? standingsErrorId : outcomeId

  return (
    // Escape closes it, but never mid-request: the season is already being
    // ended and the result still has to land somewhere.
    <Modal
      onClose={onClose}
      preventClose={isLoading}
      labelledBy={titleId}
      describedBy={daysEarly > 0 ? `${summaryId} ${earlyId}` : summaryId}
    >
      <div className="glass card modal-panel max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-md animate-slide-up motion-reduce:animate-none p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="type-meta text-foreground-secondary">
              {seasonYear} season
            </p>
            <h2 id={titleId} className="mt-1 type-panel text-foreground">
              End the season?
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close end season dialog"
            className="cursor-pointer p-1 text-foreground-secondary transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Who wins, as the standings stand right now. A live region from the
            start, so the result is read out when it replaces "Loading". A
            failure replaces the region with an alert of its own rather than
            nesting one inside it, which would read the error out twice. */}
        {standingsError ? (
          <p id={standingsErrorId} role="alert" className="mb-4 type-body-sm text-error">
            {standingsError} Close this dialog and try again.
          </p>
        ) : (
          <div
            id={outcomeId}
            className="mb-4 rounded-lg border border-border bg-elevated p-3"
            role="status"
            aria-busy={isLoadingStandings}
          >
            {isLoadingStandings ? (
              <div className="space-y-2">
                <span className="sr-only">Loading standings…</span>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-6 rounded" aria-hidden="true" />
                ))}
              </div>
            ) : (
              <>
                <ul role="list" className="space-y-1.5">
                  {topThree.map((row) => (
                    <li key={row.team_id} className="flex items-center gap-2.5">
                      <span
                        className={`flex h-6 w-6 flex-none items-center justify-center rounded-md type-number ${podiumChipClass(row.rank)}`}
                      >
                        <span aria-hidden="true">
                          {row.is_tied ? 'T' : ''}
                          {row.rank}
                        </span>
                        <span className="sr-only">{row.is_tied ? 'Tied for ' : ''}rank {row.rank}:</span>
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${row.rank === 1 ? 'font-semibold text-gold' : 'text-foreground-secondary'}`}
                      >
                        {row.team_name}
                      </span>
                      <span className="flex-none type-number text-foreground-secondary">
                        {formatFantasyPoints(row.total_points)}
                        <span className="sr-only"> points</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-border pt-2.5 text-sm text-foreground-secondary">
                  {titleLine}
                </p>
              </>
            )}
          </div>
        )}

        <ul role="list" className="mb-4 space-y-1 text-sm text-foreground-secondary">
          <li><span aria-hidden="true">• </span>Scores stop updating.</li>
          <li><span aria-hidden="true">• </span>Bids, trades and drops close.</li>
          <li><span aria-hidden="true">• </span>Everyone gets the final standings.</li>
        </ul>

        {daysEarly > 0 && (
          <div id={earlyId} className="alert alert-warning mb-4">
            This season isn&apos;t scheduled to end until {formatSeasonDate(seasonEnd)} — you&apos;re
            freezing scores {daysEarly} {daysEarly === 1 ? 'day' : 'days'} early.
          </div>
        )}

        <div className="mb-5">
          <label htmlFor="confirm_season_year" className="mb-2 block text-sm text-foreground-secondary">
            Type{' '}
            <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-foreground">
              {seasonYear}
            </span>{' '}
            to confirm
          </label>
          <input
            type="text"
            inputMode="numeric"
            id="confirm_season_year"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={String(seasonYear)}
            className="input"
            autoComplete="off"
            disabled={isLoading}
            data-dialog-initial-focus
          />
          {error && (
            <p role="alert" className="mt-2 text-sm text-error">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={isLoading} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              execute().catch(() => {
                /* surfaced in `error` above */
              })
            }}
            disabled={isLoading || isLoadingStandings || Boolean(standingsError) || !isConfirmed}
            className="btn btn-primary"
            data-testid="confirm-end-season"
          >
            {isLoading ? (
              <>
                <ButtonSpinner />
                Ending...
              </>
            ) : (
              'End season'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
