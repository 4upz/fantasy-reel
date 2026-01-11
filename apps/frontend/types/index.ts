// TypeScript interfaces for Fantasy Reel data types

export interface League {
  id: string
  name: string
  owner_id: string
  invite_only: boolean
  status: 'setup' | 'drafting' | 'active' | 'completed'
  max_participants: number
  draft_start_date: string | null
  draft_end_date: string | null
  created_at: string
  updated_at: string
}

export interface LeagueParticipant {
  id: string
  league_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  status: 'pending' | 'active' | 'left' | 'kicked'
  draft_order: number
  joined_at: string
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  participant_id: string
  name: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Movie {
  id: string
  tmdb_id: number
  imdb_id: string | null
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  backdrop_url: string | null
  popularity: number | null
  vote_average: number | null
  vote_count: number | null
  status: 'upcoming' | 'released' | 'canceled'
  last_synced_at: string
  created_at: string
  updated_at: string
}

export interface DraftPick {
  id: string
  league_id: string
  team_id: string
  movie_id: string
  round: number
  pick_number: number
  picked_at: string
  created_at: string
}

export interface Review {
  id: string
  movie_id: string
  source: 'imdb' | 'rotten_tomatoes' | 'metacritic'
  score: number | null
  raw_score: string | null
  review_count: number | null
  fetched_at: string
  created_at: string
  updated_at: string
}

export interface TeamScore {
  id: string
  team_id: string
  total_points: number
  movies_scored: number
  movies_pending: number
  average_score: number
  last_calculated_at: string
  created_at: string
  updated_at: string
}

export interface Invitation {
  id: string
  league_id: string
  invited_by: string
  email: string
  token: string
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  sent_at: string
  expires_at: string
  responded_at: string | null
  created_at: string
  updated_at: string
}

// Joined types for queries with relations
export interface ParticipantWithTeam extends LeagueParticipant {
  teams: Team | null
}

export interface DraftPickWithDetails extends DraftPick {
  movies: Movie
  teams: Team
}

export interface InvitationWithLeague extends Invitation {
  leagues: {
    id: string
    name: string
    status: 'setup' | 'drafting' | 'active' | 'completed'
    owner_id: string
  }
}

export interface NextPickInfo {
  round: number
  pick_number: number
  team_id: string
  participant_id: string
  user_id: string
}
