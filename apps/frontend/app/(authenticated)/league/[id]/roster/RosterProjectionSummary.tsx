'use client'

import { useState } from 'react'
import { Calculator } from 'lucide-react'
import BetaBadge from '@/app/components/projections/BetaBadge'
import { useLeagueProjectedStandings } from '@/hooks/useProjectedStandings'
import { ordinal } from '@/utils/franchise'
import { formatFantasyPoints } from '@/utils/scoring'
import TeamProjectionSheet from '../components/TeamProjectionSheet'

interface Props {
  leagueId: string
  teamId: string
  doublePointsOver90: boolean
  /** Only a running season has anything left to project. */
  active: boolean
}

/**
 * Where this team is projected to finish (Beta), with the sum behind it a
 * tap away. Renders nothing unless the league has projections on and some of
 * its movies still to come rest on one.
 */
/** @design-system League */
export default function RosterProjectionSummary({ leagueId, teamId, doublePointsOver90, active }: Props) {
  const standings = useLeagueProjectedStandings(leagueId, doublePointsOver90, active)
  const [open, setOpen] = useState(false)
  const team = standings?.find((row) => row.team_id === teamId)
  if (!standings || !team) return null

  return (
    <section
      aria-label="Projected finish"
      className="card flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 animate-fade-in"
      data-testid="roster-projection"
    >
      <div className="min-w-0">
        <p className="type-meta flex items-center gap-2 text-foreground-secondary">
          Projected finish <BetaBadge />
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
          <span className="type-number-lg text-gold" data-testid="roster-projected-position">
            {team.isTied ? 'T-' : ''}
            {ordinal(team.projectedRank)}
          </span>
          <span className="type-number text-foreground-secondary">≈ {formatFantasyPoints(team.projected)} pts</span>
        </p>
        <p className="type-meta mt-0.5 text-foreground-secondary">
          of {standings.length} · {team.remaining} still to count · rank uses real points only
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-testid="how-it-adds-up"
        className="type-control inline-flex h-11 items-center gap-2 rounded-lg border border-dashed border-gold/60 px-3.5 text-gold transition-colors hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <Calculator className="h-4 w-4" aria-hidden="true" />
        How it adds up
      </button>
      {open && <TeamProjectionSheet team={team} standings={standings} onClose={() => setOpen(false)} />}
    </section>
  )
}
