'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { createClient } from '@/utils/supabase/client'
import { fetchStandings } from '@/utils/seasonQueries'
import { SEASON_YEAR_CLASS, formatSeasonDate } from '@/utils/seasons'
import { trackEvent } from '@/utils/analytics'
import type { League, StandingRow } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import StartNextSeasonButton from '../../components/StartNextSeasonButton'
import { SectionHeader } from './shared'
import EndSeasonModal from './EndSeasonModal'
import type { CompleteLeagueResponse } from './EndSeasonModal'

interface Props {
  league: League
  nextSeasonId?: string
  /** Display names of everyone still in the league, for the rollover confirm. */
  participantNames: string[]
  onUpdate: (league: League) => void
}

interface UpdateSeasonResponse {
  league: League
  message: string
}

/** "Season ended. Academy Aces wins." - the champion, named, or a plain close. */
function seasonEndedMessage(result: CompleteLeagueResponse): string {
  const winners = result.top_teams.filter((team) => result.winner_team_ids.includes(team.teamId))
  if (winners.length === 0) return 'Season ended.'
  if (winners.length === 1) return `Season ended. ${winners[0].teamName} wins.`
  return `Season ended. ${winners.map((team) => team.teamName).join(' and ')} share the title.`
}

/** New season years follow the server's current-or-next-year constraint. */
function seasonYearOptions(): [number, number] {
  const currentYear = new Date().getUTCFullYear()
  return [currentYear, currentYear + 1]
}

/**
 * The season's own settings, and the two controls that move a league between
 * seasons.
 *
 * Deliberately not part of the Danger Zone. Deleting a league destroys data;
 * ending a season completes a record - the league is worth more afterwards, not
 * less. So this card is gold-headed like every other settings card, its action
 * is a `btn-secondary`, and the words "can't be undone" appear only inside the
 * confirm modal.
 */
export default function SeasonSection({
  league,
  nextSeasonId,
  participantNames,
  onUpdate,
}: Props): React.ReactElement {
  const [thisYear, nextYear] = seasonYearOptions()
  const yearOptions = [...new Set([league.season_year, thisYear, nextYear])].sort()
  const [seasonYear, setSeasonYear] = useState(league.season_year)
  const [seasonEnd, setSeasonEnd] = useState(league.season_end)
  const [isEnding, setIsEnding] = useState(false)
  const [standingsError, setStandingsError] = useState<string | null>(null)
  const [standings, setStandings] = useState<StandingRow[] | null>(null)

  const isSetup = league.status === 'setup'
  const isActive = league.status === 'active'
  const isCompleted = league.status === 'completed'

  const hasChanges =
    (isSetup && seasonYear !== league.season_year) || seasonEnd !== league.season_end

  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const openEndSeason = useCallback(async () => {
    setStandings(null)
    setStandingsError(null)
    setIsEnding(true)
    try {
      setStandings(await fetchStandings(supabase, league.id))
    } catch (error) {
      setStandingsError(error instanceof Error ? error.message : 'Could not load standings. Please try again.')
    }
  }, [supabase, league.id])

  const saveSeason = useCallback(async () => {
    if (isCompleted) return

    const { data, error } = await callEdgeFunction<UpdateSeasonResponse>('update-league', {
      body: {
        action: 'update_season_config',
        league_id: league.id,
        // The year is only sent while it is still editable, so a later save
        // cannot resubmit a value the server would refuse.
        ...(isSetup && seasonYear !== league.season_year ? { season_year: seasonYear } : {}),
        season_end: seasonEnd,
      },
    })

    if (error) throw new Error(error)

    if (data?.league) {
      onUpdate(data.league)
      setSeasonYear(data.league.season_year)
      setSeasonEnd(data.league.season_end)
      toast.success('Season settings updated')
      router.refresh()
    }
  }, [isCompleted, isSetup, league.id, league.season_year, onUpdate, router, seasonEnd, seasonYear])

  const { execute: save, isLoading: isSubmitting } = useAsyncAction(saveSeason)
  const isSubmitDisabled = isCompleted || isSubmitting || !hasChanges || !seasonEnd

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    void save().catch((error: Error) => toast.error(error.message))
  }

  return (
    <>
      <section className="card p-6">
        <SectionHeader
          icon={CalendarDays}
          title="Season"
          description="Which season this is, and when it ends"
        />

        <form onSubmit={handleSubmit}>
          <fieldset disabled={isCompleted || isSubmitting}>
            <div className="mb-6">
              {/* Not a <label>: neither branch renders a form control to point
                  at - a group of radios, or a read-only value. */}
              <p
                id="season_year_label"
                className="mb-2 block text-sm font-medium text-foreground-secondary"
              >
                Season Year
              </p>
              {isSetup ? (
                <>
                  <div
                    className="flex gap-2"
                    role="radiogroup"
                    aria-labelledby="season_year_label"
                    aria-describedby="season_year_help"
                  >
                    {yearOptions.map((year) => {
                      const selected = seasonYear === year
                      return (
                        <button
                          key={year}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setSeasonYear(year)}
                          className={`btn px-4 py-1.5 type-control ${
                            selected
                              ? 'btn-secondary'
                              : 'border border-border bg-elevated text-foreground-secondary hover:border-border-hover hover:text-foreground'
                          }`}
                          data-testid={`season-year-${year}`}
                        >
                          {year}
                        </button>
                      )
                    })}
                  </div>
                  <p id="season_year_help" className="mt-1.5 text-xs text-foreground-secondary">
                    Decides which movies are in play — anything released before this season is off
                    the board. Creating this league for next year&apos;s movies? Pick {nextYear}.
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-md border border-border bg-elevated px-2.5 py-1 text-foreground ${SEASON_YEAR_CLASS}`}
                  >
                    {league.season_year}
                  </span>
                  <p className="text-xs text-foreground-secondary">
                    The season year is fixed once the draft starts.
                  </p>
                </div>
              )}
            </div>

            <div className="mb-6">
              <label
                htmlFor="season_end"
                className="mb-2 block text-sm font-medium text-foreground-secondary"
              >
                Season Ends
              </label>
              <input
                type="date"
                id="season_end"
                value={seasonEnd}
                min={`${seasonYear}-01-01`}
                onChange={(e) => setSeasonEnd(e.target.value)}
                className="input w-48"
                aria-describedby="season_end_help"
              />
              <p id="season_end_help" className="mt-1.5 text-xs text-foreground-secondary">
                {isCompleted
                  ? 'This season is complete. Its dates and results are final.'
                  : 'Scores freeze after this date and the champion is recorded.'}
                {!isCompleted && (league.trade_deadline
                  ? ` Trades close ${formatSeasonDate(league.trade_deadline)}.`
                  : ' Trades run until then unless you set a deadline.')}
              </p>
            </div>

            <button type="submit" disabled={isSubmitDisabled} className="btn btn-primary">
              {isSubmitting ? (
                <>
                  <ButtonSpinner />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </fieldset>
        </form>

        {(isActive || isCompleted) && (
          <div className="mt-6 border-t border-border pt-5">
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4 sm:flex-row sm:items-center sm:justify-between">
              {isActive ? (
                <>
                  <div>
                    <p className="text-sm font-medium text-foreground">End season now</p>
                    <p className="mt-0.5 text-xs text-foreground-secondary">
                      Freezes scores, records the champion, and tells everyone.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openEndSeason}
                    className="btn btn-secondary"
                    data-testid="end-season-button"
                  >
                    End season
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {nextSeasonId ? 'Open' : 'Start'} the {league.season_year + 1} season
                    </p>
                    <p className="mt-0.5 text-xs text-foreground-secondary">
                      Carries everyone over with their team names. Rosters start empty.
                    </p>
                  </div>
                  <StartNextSeasonButton
                    leagueId={league.id}
                    seasonYear={league.season_year}
                    nextSeasonId={nextSeasonId}
                    participantNames={participantNames}
                    variant="secondary"
                  />
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {isEnding && (
        <EndSeasonModal
          leagueId={league.id}
          seasonYear={league.season_year}
          seasonEnd={league.season_end}
          standings={standings ?? []}
          isLoadingStandings={standings === null && !standingsError}
          standingsError={standingsError}
          onClose={() => setIsEnding(false)}
          onCompleted={(result) => {
            setIsEnding(false)
            onUpdate(result.league)
            trackEvent('season_completed', { league_id: result.league.id })
            toast.success(seasonEndedMessage(result))
            // The page renders the completed state - champion banner, closed
            // write paths - from server data, so it has to come back.
            router.refresh()
          }}
        />
      )}
    </>
  )
}
