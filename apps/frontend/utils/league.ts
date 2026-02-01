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
 * Team display info for UI components that show both team name and owner name
 */
export interface TeamDisplayInfo {
  teamName: string
  ownerName: string | null
}

/**
 * Get team name and owner display name from a participant
 * Used for showing "Team Name" with "by Owner Name" underneath
 */
export function getTeamDisplayInfo(participant: ParticipantWithProfile): TeamDisplayInfo {
  return {
    teamName: participant.teams?.name || 'Unknown Team',
    ownerName: participant.profiles?.display_name || null,
  }
}

/**
 * Build a map of user_id to TeamDisplayInfo from an array of participants
 * Useful for looking up team info by user ID in draft/counterpick components
 */
export function buildTeamInfoByUserId(
  participants: ParticipantWithProfile[]
): Map<string, TeamDisplayInfo> {
  const map = new Map<string, TeamDisplayInfo>()
  for (const participant of participants) {
    map.set(participant.user_id, getTeamDisplayInfo(participant))
  }
  return map
}

/**
 * Build a map of team_id to TeamDisplayInfo from an array of participants
 * Useful for looking up team info by team ID in pick history components
 */
export function buildTeamInfoByTeamId(
  participants: ParticipantWithProfile[]
): Map<string, TeamDisplayInfo> {
  const map = new Map<string, TeamDisplayInfo>()
  for (const participant of participants) {
    if (participant.teams) {
      map.set(participant.teams.id, {
        teamName: participant.teams.name,
        ownerName: participant.profiles?.display_name || null,
      })
    }
  }
  return map
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
