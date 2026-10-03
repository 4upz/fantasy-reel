import { formatPointsText, isPreReleaseScore, pointsTone } from '@/utils/scoring'

interface Props {
  points: number
  /** The release date of the movie the points belong to; for a counterpick, the movie it targets. */
  releaseDate: string | null | undefined
  className?: string
}

/**
 * A movie's fantasy points as inline text, "24 pts". Before the movie releases
 * they are a pre-release score that doesn't count toward the team total yet,
 * so they read "24 pts at release", muted.
 */
export default function FantasyPoints({ points, releaseDate, className = '' }: Props) {
  const preRelease = isPreReleaseScore(points, releaseDate)
  return (
    <span className={`type-numeric ${pointsTone(points, { preRelease })} ${className}`}>
      {formatPointsText(points, preRelease)}
    </span>
  )
}

/**
 * A pre-release score on a line of its own, for places that otherwise show a
 * countdown rather than points. Renders nothing once the points count.
 */
export function PreReleasePoints({
  points,
  releaseDate,
  className = '',
}: {
  points: number | null
  releaseDate: string | null
  className?: string
}) {
  if (!isPreReleaseScore(points, releaseDate)) return null
  return <FantasyPoints points={points!} releaseDate={releaseDate} className={`block type-meta ${className}`} />
}
