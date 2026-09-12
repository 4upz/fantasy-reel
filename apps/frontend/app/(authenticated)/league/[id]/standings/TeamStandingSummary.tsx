import Image from 'next/image'
import ChampionCrown from '../components/ChampionCrown'
import { ChevronDown } from 'lucide-react'
import { formatFantasyPoints } from '@/utils/scoring'
import { budgetTone, formatBudget } from './TeamBudget'

interface Props {
  rank: number
  isTied: boolean
  displayName: string
  ownerHandle?: string | null
  avatarUrl?: string | null
  isCurrentUser: boolean
  reigningChampionSeason?: number | null
  movieCount: number
  moviesScored: number
  moviesPending: number
  budgetLeft: number | null
  totalPoints: number
  isExpanded?: boolean
  /** A fixed canvas uses the same desktop row at every viewport size. */
  inline?: boolean
  scoreFocus?: string
  budgetFocus?: string
}

const PODIUM_CHIP: Record<number, string> = {
  1: 'bg-[linear-gradient(135deg,#ffd700,#a88c1f)] text-[#0f0f0f]',
  2: 'bg-[linear-gradient(135deg,#e8e8e8,#a8a8a8)] text-[#0f0f0f]',
  3: 'bg-[linear-gradient(135deg,#cd9b61,#a56b2d)] text-[#0f0f0f]',
}

/** The display-only part of a standings row, shared with public examples. */
/** @design-system League */
export default function TeamStandingSummary({
  rank,
  isTied,
  displayName,
  ownerHandle,
  avatarUrl,
  isCurrentUser,
  reigningChampionSeason = null,
  movieCount,
  moviesScored,
  moviesPending,
  budgetLeft,
  totalPoints,
  isExpanded = false,
  inline = false,
  scoreFocus,
  budgetFocus,
}: Props) {
  const initials = displayName.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase()

  return (
    <>
      <div className={`flex items-center ${inline ? 'gap-3.5' : 'gap-2.5 lg:gap-3.5'}`}>
        <div
          className={`type-number flex flex-none items-center justify-center ${
            inline ? 'h-[38px] w-[38px] rounded-[11px]' : 'h-[34px] w-[34px] rounded-[10px] lg:h-[38px] lg:w-[38px] lg:rounded-[11px]'
          } ${PODIUM_CHIP[rank] ?? 'border border-border bg-elevated text-foreground-secondary'}`}
        >
          {isTied ? 'T' : '#'}{rank}
        </div>

        <div className={`relative flex-none overflow-hidden rounded-full border-[1.5px] border-gold bg-gold-muted ${inline ? 'h-[38px] w-[38px]' : 'h-[34px] w-[34px] lg:h-[38px] lg:w-[38px]'}`}>
          {avatarUrl ? (
            <Image src={avatarUrl} alt={displayName} fill sizes="38px" className="object-cover" unoptimized />
          ) : (
            <div className="type-meta flex h-full w-full items-center justify-center text-gold">{initials}</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="type-row-title truncate text-foreground">{displayName}</span>
            {reigningChampionSeason !== null && <ChampionCrown seasonYear={reigningChampionSeason} />}
            {isCurrentUser && <span className="type-meta flex-none rounded-full bg-gold-muted px-1.5 py-px text-gold">You</span>}
          </div>
          {ownerHandle && <div className="type-meta truncate text-foreground-secondary">{ownerHandle}</div>}
        </div>

        <div className={`flex-none text-right ${inline ? 'w-[72px]' : 'hidden lg:block lg:w-[72px]'}`}>
          <div className="type-meta text-foreground-secondary">Movies</div>
          <div className="type-number text-foreground-secondary">{movieCount}</div>
        </div>

        {budgetLeft !== null && (
          <div data-preview-focus={budgetFocus} className={`flex-none text-right ${inline ? 'w-[72px]' : 'hidden lg:block lg:w-[72px]'}`}>
            <div className="type-meta text-foreground-secondary">Budget</div>
            <div className={`type-number ${budgetTone(budgetLeft)}`}>{formatBudget(budgetLeft)}</div>
          </div>
        )}

        <div data-preview-focus={scoreFocus} className={`flex-none text-right ${inline ? 'min-w-[86px]' : 'lg:min-w-[86px]'}`}>
          <div className={`type-number-lg ${totalPoints >= 0 ? 'text-gold' : 'text-crimson'}`}>{formatFantasyPoints(totalPoints)}</div>
          <div className="type-meta mt-0.5 text-foreground-secondary">Points</div>
        </div>
      </div>

      {!inline && (
        <div className="flex items-center gap-2 border-t border-border pt-[9px] lg:hidden">
          <span className="type-meta text-foreground-secondary">{movieCount} movies</span>
          <span className="h-[3px] w-[3px] flex-none rounded-full bg-border-hover" />
          <span className="type-meta truncate text-foreground-secondary">{moviesScored} scored · {moviesPending} pending</span>
          <span className="flex-1" />
          {budgetLeft !== null && <span className={`type-meta type-numeric flex-none ${budgetTone(budgetLeft)}`}>{formatBudget(budgetLeft)}</span>}
          <ChevronDown className={`h-4 w-4 flex-none text-foreground-muted transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      )}
    </>
  )
}
