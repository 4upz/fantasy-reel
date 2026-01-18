import type { League, ParticipantWithProfile } from '@/types'

/**
 * CSS classes for league status badges
 */
export const STATUS_BADGE_CLASS: Record<League['status'], string> = {
  setup: 'badge-setup',
  drafting: 'badge-drafting',
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
