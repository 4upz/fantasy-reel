import type { League } from '@/types'

/** Shape of the `admin_growth_stats()` RPC (20261004120000_admin_growth_stats.sql). */

export interface PeriodCount {
  total: number
  last_30d: number
}

export interface MonthlyGrowth {
  /** First day of the month, UTC (YYYY-MM-DD). */
  month: string
  signups: number
  leagues: number
}

/** A league's current season; created_at is when its first season was. */
export interface AdminLeagueRow {
  id: string
  name: string
  owner: string | null
  status: League['status']
  season_year: number
  players: number
  max_players: number
  invited: boolean
  created_at: string
}

export interface AdminUserRow {
  id: string
  display_name: string | null
  provider: string | null
  signed_up_at: string
  last_active_at: string | null
  leagues: number
}

export interface AdminGrowthStats {
  generated_at: string
  users: { total: number; new_30d: number; active_7d: number; active_30d: number }
  leagues: { total: number; new_30d: number }
  rosters: { holdings: number; drafted: number; picked_up: number }
  monthly: MonthlyGrowth[]
  league_funnel: { created: number; invited: number; second_player: number; drafted: number; live: number }
  user_funnel: { in_league: number; with_others: number; drafted: number }
  activity: {
    draft_picks: PeriodCount
    pickups: PeriodCount
    bids: PeriodCount
    counterpicks: PeriodCount
    trades_proposed: PeriodCount
    trades_completed: PeriodCount
  }
  league_list: AdminLeagueRow[]
  recent_users: AdminUserRow[]
}
