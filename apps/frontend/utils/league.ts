import type { League, ParticipantWithProfile, MovieTimelineItem } from '@/types'

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
 * Ranks 1-3 get the medal gradient. Everything below is a plain elevated chip -
 * a podium that includes eighth place isn't a podium. Shared so the standings
 * table and the end-of-season champion preview show the same three medals.
 */
export const PODIUM_CHIP: Record<number, string> = {
  1: 'bg-[linear-gradient(135deg,#ffd700,#a88c1f)] text-background',
  2: 'bg-[linear-gradient(135deg,#e8e8e8,#a8a8a8)] text-background',
  3: 'bg-[linear-gradient(135deg,#cd9b61,#a56b2d)] text-background',
}

/** The chip for any rank, medal or not. */
export function podiumChipClass(rank: number): string {
  return PODIUM_CHIP[rank] ?? 'border border-border bg-elevated text-foreground-secondary'
}

/**
 * Get display label for league status (capitalized)
 */
export function getStatusLabel(status: League['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * Get display name for a participant, preferring profile name over team name.
 *
 * `fallback` is for the surfaces that name people in a sentence rather than in
 * a row - "Unknown" reads as a data error in a list of who is being carried
 * into next season.
 */
export function getParticipantDisplayName(
  participant: ParticipantWithProfile,
  fallback = 'Unknown'
): string {
  return participant.profiles?.display_name || participant.teams?.name || fallback
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

