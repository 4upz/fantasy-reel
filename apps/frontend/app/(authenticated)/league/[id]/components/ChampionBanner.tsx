import { Trophy } from 'lucide-react'
import { formatFantasyPoints } from '@/utils/scoring'
import { championName, formatChampionNames, type Champion } from '@/utils/seasons'

interface Props {
  seasonYear: number
  /** Every team at rank 1. More than one means the title is shared. */
  champions: Champion[]
  /** The champions' final total. Co-champions are tied, so there is only one figure. */
  points: number | null
  /**
   * Trailing action - the owner's "Start the next season" button on the league
   * dashboard. A slot rather than a prop so the banner stays presentational and
   * the standings page can render the same banner with no action at all.
   */
  action?: React.ReactNode
}

/**
 * The one loud moment in the season feature: a completed league's result,
 * rendered at the top of its dashboard and its standings page.
 *
 * `.champion-plate` is the only gradient allowed on any page, which is why this
 * component owns it and nothing else does.
 */
export default function ChampionBanner({
  seasonYear,
  champions,
  points,
  action,
}: Props): React.ReactElement {
  const isShared = champions.length > 1
  const eyebrow = `${seasonYear} ${isShared ? 'Co-champions' : 'Champion'}`
  const owners = champions.map((c) => c.ownerName).filter((name): name is string => Boolean(name))

  return (
    <section
      className="champion-plate animate-fade-in rounded-xl p-5"
      aria-label={`${seasonYear} season result`}
      data-testid="champion-banner"
    >
      <div className="flex items-start gap-4">
        <span className="accolade-shine flex h-11 w-11 flex-none items-center justify-center rounded-full bg-gold-muted">
          <Trophy className="h-5 w-5 text-gold" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-gold">{eyebrow}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
            {champions.length === 0
              ? 'No champion recorded'
              : champions.map(championName).join(' · ')}
          </h2>
          {owners.length > 0 && (
            <p className="mt-0.5 text-sm text-foreground-muted">{owners.join(' · ')}</p>
          )}
        </div>

        {/* Mirrors TeamStandingCard's points column, so the eye lands in the
            same place it does on every row of the table below. */}
        <div className="flex-none text-right">
          <div className="font-display text-[28px] font-bold leading-none text-gold">
            {formatFantasyPoints(points)}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.1em] text-foreground-muted">
            Final points
          </div>
        </div>
      </div>

      {/* Load-bearing: without it, two gold "T1" chips in the standings read as
          a rendering bug rather than a shared title. */}
      {isShared && points != null && (
        <p className="mt-3 border-t border-gold/20 pt-3 text-sm text-foreground-secondary">
          Tied on {formatFantasyPoints(points)} pts — {formatChampionNames(champions)}{' '}
          {champions.length === 2 ? 'both' : 'all'} hold the title.
        </p>
      )}

      {action && (
        <div className="mt-4 flex sm:mt-3 sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">{action}</div>
      )}
    </section>
  )
}
