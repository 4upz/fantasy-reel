'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays } from 'lucide-react'
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

const MIN_SEASON_YEAR = 2000
const MAX_SEASON_YEAR = 2100

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
  participantNames,
  onUpdate,
}: Props): React.ReactElement {
  const [seasonYear, setSeasonYear] = useState(String(league.season_year))
  const [seasonEnd, setSeasonEnd] = useState(league.season_end)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [standings, setStandings] = useState<StandingRow[] | null>(null)

  const isSetup = league.status === 'setup'
  const isActive = league.status === 'active'
  const isCompleted = league.status === 'completed'

  const parsedYear = Number(seasonYear)
  const yearOutOfRange =
    !Number.isInteger(parsedYear) || parsedYear < MIN_SEASON_YEAR || parsedYear > MAX_SEASON_YEAR

  const hasChanges =
    (isSetup && parsedYear !== league.season_year) || seasonEnd !== league.season_end
  const isSubmitDisabled = isSubmitting || !hasChanges || !seasonEnd || (isSetup && yearOutOfRange)

  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const openEndSeason = useCallback(async () => {
    setIsEnding(true)
    setStandings(await fetchStandings(supabase, league.id))
  }, [supabase, league.id])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setIsSubmitting(true)

    const { data, error } = await callEdgeFunction<UpdateSeasonResponse>('update-league', {
      body: {
        action: 'update_season_config',
        league_id: league.id,
        // The year is only sent while it is still editable, so a later save
        // cannot resubmit a value the server would refuse.
        ...(isSetup ? { season_year: parsedYear } : {}),
        season_end: seasonEnd,
      },
    })

    setIsSubmitting(false)

    if (error) {
      toast.error(error)
      return
    }

    if (data?.league) {
      onUpdate(data.league)
      setSeasonYear(String(data.league.season_year))
      setSeasonEnd(data.league.season_end)
      toast.success('Season settings updated')
    }
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
          <div className="mb-6">
            <label
              htmlFor="season_year"
              className="mb-2 block text-sm font-medium text-foreground-secondary"
            >
              Season Year
            </label>
            {isSetup ? (
              <>
                <input
                  type="number"
                  id="season_year"
                  value={seasonYear}
                  onChange={(e) => setSeasonYear(e.target.value)}
                  min={MIN_SEASON_YEAR}
                  max={MAX_SEASON_YEAR}
                  className={`input w-40 ${yearOutOfRange ? 'border-error' : ''}`}
                  aria-describedby="season_year_help"
                />
                <p id="season_year_help" className="mt-1.5 text-xs text-foreground-muted">
                  Decides which movies are in play — anything released before this season is off
                  the board.
                </p>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-md border border-border bg-elevated px-2.5 py-1 text-sm text-foreground ${SEASON_YEAR_CLASS}`}
                >
                  {league.season_year}
                </span>
                <p className="text-xs text-foreground-muted">
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
              onChange={(e) => setSeasonEnd(e.target.value)}
              className="input w-48"
              aria-describedby="season_end_help"
            />
            <p id="season_end_help" className="mt-1.5 text-xs text-foreground-muted">
              Scores freeze on this date and the champion is recorded.
              {league.trade_deadline
                ? ` Trades close ${formatSeasonDate(league.trade_deadline)}.`
                : ' Trades run until then unless you set a deadline.'}
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
        </form>

        {(isActive || isCompleted) && (
          <div className="mt-6 border-t border-border pt-5">
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4 sm:flex-row sm:items-center sm:justify-between">
              {isActive ? (
                <>
                  <div>
                    <p className="text-sm font-medium text-foreground">End season now</p>
                    <p className="mt-0.5 text-xs text-foreground-muted">
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
                      Start the {league.season_year + 1} season
                    </p>
                    <p className="mt-0.5 text-xs text-foreground-muted">
                      Carries everyone over with their team names. Rosters start empty.
                    </p>
                  </div>
                  <StartNextSeasonButton
                    leagueId={league.id}
                    seasonYear={league.season_year}
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
          isLoadingStandings={standings === null}
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
