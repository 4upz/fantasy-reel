import { Crown } from 'lucide-react'

interface Props {
  /** The season they won, which is what the label says. */
  seasonYear: number
  className?: string
}

/**
 * The reigning champion's mark, shown beside their name during the season that
 * follows their win.
 *
 * Deliberately tiny and monochrome. The rows it appears in already carry a
 * podium chip and possibly a gold current-user edge; a third gold surface would
 * flatten all three. It is a footnote on a name, not an award in its own right
 * - the champion banner is where a title gets celebrated.
 */
export default function ChampionCrown({ seasonYear, className = '' }: Props): React.ReactElement {
  const label = `${seasonYear} champion`

  return (
    <span className={`inline-flex flex-none items-center ${className}`} title={label}>
      <Crown className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}
