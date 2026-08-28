'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { trackEvent } from '@/utils/analytics'
import ConfirmStartSeasonModal from './ConfirmStartSeasonModal'

interface StartNextSeasonResponse {
  league_id: string
  season_year: number
}

interface Props {
  /** The completed season being rolled over. */
  leagueId: string
  seasonYear: number
  participantNames: string[]
  /**
   * `primary` is the champion banner's single loud CTA; `secondary` is the
   * quiet copy in league settings. There is never more than one primary.
   */
  variant?: 'primary' | 'secondary'
}

/**
 * The owner's rollover control: confirm, create next season, go set its dates.
 *
 * It lands the owner on the new season's settings rather than its dashboard
 * because the new league is in setup with empty rosters - there is nothing to
 * look at, and the next real job is picking draft dates.
 */
export default function StartNextSeasonButton({
  leagueId,
  seasonYear,
  participantNames,
  variant = 'primary',
}: Props): React.ReactElement {
  const router = useRouter()
  const [isConfirming, setIsConfirming] = useState(false)
  const nextSeasonYear = seasonYear + 1

  const startSeason = useCallback(async () => {
    const { data, error } = await callEdgeFunction<StartNextSeasonResponse>('start-next-season', {
      body: { league_id: leagueId },
    })

    if (error) throw new Error(error)
    if (!data) throw new Error('The next season could not be created')

    trackEvent('season_started', { league_id: data.league_id })
    toast.success(`${data.season_year} season created. Set your draft dates.`)
    router.push(`/league/${data.league_id}/settings`)
    return data
  }, [leagueId, router])

  const { execute, isLoading, error } = useAsyncAction(startSeason)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}
        data-testid="start-next-season"
      >
        Start the {nextSeasonYear} season
      </button>

      {isConfirming && (
        <ConfirmStartSeasonModal
          seasonYear={nextSeasonYear}
          previousSeasonYear={seasonYear}
          participantNames={participantNames}
          isLoading={isLoading}
          error={error}
          onConfirm={() => {
            execute().catch(() => {
              /* surfaced in the modal's error line */
            })
          }}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </>
  )
}
