'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, Trophy } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { fantasyPointsForTomatometer, formatSignedPoints } from '@/utils/scoring'
import type { League } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, LockedMessage } from './shared'

interface Props {
  league: League
  onUpdate: (league: League) => void
}

interface UpdateScoringConfigResponse {
  league: League
  message: string
}

/** The Tomatometer the worked example uses: far enough above 90 to show the gap. */
const EXAMPLE_RT = 96

/** What the example movie earns under a rule, e.g. "+42". */
function examplePoints(doublePointsOver90: boolean): string {
  return formatSignedPoints(fantasyPointsForTomatometer(EXAMPLE_RT, doublePointsOver90))
}

/**
 * The season's 90+ points rule: whether each Tomatometer point above 90 earns
 * 2 fantasy points or 1. Counterpicks have no rule of their own -- they lose
 * whatever the movie earns under this one.
 *
 * Editable until the season completes, like the trade settings. Unlike them, a
 * change reaches back: the database re-scores every team the moment it is
 * saved, so once teams hold movies the card says so before you save.
 */
export default function ScoringConfigSection({ league, onUpdate }: Props): React.ReactElement {
  const router = useRouter()
  const [doublePoints, setDoublePoints] = useState(league.double_points_over_90)

  const isCompleted = league.status === 'completed'
  // Past setup, teams hold movies for a change to re-score.
  const isUnderway = league.status !== 'setup'
  const hasChanges = doublePoints !== league.double_points_over_90

  const saveScoring = useCallback(async () => {
    if (isCompleted) return

    const { data, error } = await callEdgeFunction<UpdateScoringConfigResponse>('update-league', {
      body: {
        action: 'update_scoring_config',
        league_id: league.id,
        double_points_over_90: doublePoints,
      },
    })

    if (error) throw new Error(error)

    if (data?.league) {
      onUpdate(data.league)
      setDoublePoints(data.league.double_points_over_90)
      toast.success(isUnderway ? 'Scoring updated. Every team has been re-scored.' : 'Scoring updated')
      // Every team total just moved; drop any cached page still showing the old ones.
      router.refresh()
    }
  }, [doublePoints, isCompleted, isUnderway, league.id, onUpdate, router])

  const { execute: save, isLoading: isSubmitting } = useAsyncAction(saveScoring)
  const isSubmitDisabled = isCompleted || isSubmitting || !hasChanges

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    void save().catch((error: Error) => toast.error(error.message))
  }

  return (
    <section className="card p-6">
      <SectionHeader
        icon={Trophy}
        title="Scoring"
        description={isCompleted ? 'Locked after the season ends' : 'How Tomatometer scores become fantasy points'}
        isLocked={isCompleted}
      />

      {isCompleted ? (
        <LockedMessage
          message={`Scoring cannot be changed after the season is complete. This season paid ${
            league.double_points_over_90 ? 'double points above 90%' : '1 point per Tomatometer point above 90%'
          }: a ${EXAMPLE_RT}% movie earned ${examplePoints(league.double_points_over_90)}.`}
        />
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset disabled={isSubmitting}>
            <div className="space-y-6">
              {/* Double points toggle */}
              <div className="flex items-start gap-3">
                <div className="pt-0.5">
                  <input
                    type="checkbox"
                    id="double_points_over_90"
                    checked={doublePoints}
                    onChange={(e) => setDoublePoints(e.target.checked)}
                    aria-describedby="double_points_over_90_help"
                    className="w-4 h-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-0 focus:ring-2 cursor-pointer"
                  />
                </div>
                <div>
                  <label
                    htmlFor="double_points_over_90"
                    className="type-label block text-foreground cursor-pointer"
                  >
                    Double points above 90%
                  </label>
                  <p id="double_points_over_90_help" className="type-meta text-foreground-secondary mt-1">
                    {doublePoints
                      ? 'Each Tomatometer point above 90% earns 2 fantasy points instead of 1.'
                      : 'Each Tomatometer point above 90% earns 1 fantasy point, the same as below it.'}
                  </p>
                </div>
              </div>

              {/* The rule worked through one movie, and the counterpick on it. */}
              <div className="p-3 bg-surface-hover rounded-lg border border-border">
                <div className="type-body-sm flex items-center justify-between gap-3">
                  <span className="text-foreground-secondary">A {EXAMPLE_RT}% movie earns</span>
                  <span className="type-numeric font-semibold text-gold">{examplePoints(doublePoints)} pts</span>
                </div>
                <div className="type-body-sm mt-1 flex items-center justify-between gap-3">
                  <span className="text-foreground-secondary">A counterpick on it scores</span>
                  <span className="type-numeric font-semibold text-crimson">
                    {formatSignedPoints(-fantasyPointsForTomatometer(EXAMPLE_RT, doublePoints))} pts
                  </span>
                </div>
                <p className="type-meta text-foreground-secondary mt-2">
                  It would earn {examplePoints(!doublePoints)} with double points {doublePoints ? 'off' : 'on'}.
                  A counterpick always loses whatever the movie earns.
                </p>
              </div>

              {isUnderway && hasChanges && (
                <p
                  role="status"
                  className="type-body-sm alert alert-warning flex items-start gap-2"
                  data-testid="scoring-rescore-warning"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                  <span>Saving re-scores every team right away, so the standings can change.</span>
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="btn btn-primary mt-6"
              data-testid="save-scoring-config"
            >
              {isSubmitting ? (
                <>
                  <ButtonSpinner />
                  Saving...
                </>
              ) : (
                'Save changes'
              )}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  )
}
