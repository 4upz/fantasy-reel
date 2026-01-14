import type { League } from '@/types'

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
