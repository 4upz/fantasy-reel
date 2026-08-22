import { Target } from 'lucide-react'

/**
 * The crimson target that marks a counterpick.
 *
 * A counterpick and the movie it bets against carry the same title and the same
 * poster, so in any list that mixes them the mark is the only thing telling them
 * apart. Lifted out of MovieScoreCard's corner badge (standings) so the trade
 * screens speak the league's existing visual language rather than a second one:
 * crimson is already how this app says "against".
 *
 * Sits in the poster's top-left corner, so its container needs `relative`.
 */
export default function CounterpickMark({ label = 'Counterpick' }: { label?: string }) {
  return (
    <div
      className="absolute -top-[7px] -left-[7px] flex h-[22px] w-[22px] items-center justify-center rounded-full border border-crimson/40 bg-crimson/20 text-crimson"
      title={label}
    >
      <Target className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
