import type { League, ParticipantWithProfile, MovieTimelineItem, Review } from '@/types'

/**
 * CSS classes for league status badges
 */
export const STATUS_BADGE_CLASS: Record<League['status'], string> = {
  setup: 'badge-setup',
  drafting: 'badge-drafting',
  counterpicking: 'badge-drafting', // Use same style as drafting
  active: 'badge-active',
  completed: 'badge-completed',
}

/**
 * Get display label for league status (capitalized)
 */
export function getStatusLabel(status: League['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * Get display name for a participant, preferring profile name over team name
 */
export function getParticipantDisplayName(participant: ParticipantWithProfile): string {
  return participant.profiles?.display_name || participant.teams?.name || 'Unknown'
}

/**
 * Determine movie status based on release date and score availability
 */
export function getMovieStatus(
  releaseDate: string | null,
  combinedScore: number | null
): MovieTimelineItem['status'] {
  if (combinedScore !== null) return 'scored'
  if (!releaseDate) return 'upcoming'

  const release = new Date(releaseDate)
  const now = new Date()
  const diffDays = Math.ceil((release.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays <= 30 && diffDays >= 0) return 'releasing_soon'
  return 'upcoming'
}

/**
 * Extract individual review scores from an array of reviews
 */
export function extractScores(reviews: Review[]): MovieTimelineItem['scores'] {
  const scores: MovieTimelineItem['scores'] = {
    imdb: null,
    rotten_tomatoes: null,
    metacritic: null,
  }

  for (const review of reviews) {
    if (review.source === 'imdb') scores.imdb = review.score
    if (review.source === 'rotten_tomatoes') scores.rotten_tomatoes = review.score
    if (review.source === 'metacritic') scores.metacritic = review.score
  }

  return scores
}
