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
  // Bidding configuration
  total_slots: number
  draft_slots: number
  drop_limit: number
  counterbid_hours: number
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
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'
  sent_at: string
  expires_at: string
  responded_at: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  user_id: string
  display_name: string | null
  avatar_url: string | null
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
  } | null
}

// Standings page types
export interface MovieWithScores extends Movie {
  combined_score: number | null
  scores_updated_at: string | null
  reviews: Review[]
}

export interface TeamWithScore extends Team {
  team_scores: TeamScore | null
}

export interface ParticipantWithTeamScore extends LeagueParticipant {
  teams: TeamWithScore | null
  profiles: Profile | null
}

export interface DraftPickWithScores extends DraftPick {
  movies: MovieWithScores
}

export interface RankedTeam {
  rank: number
  participant: ParticipantWithTeamScore
  draftPicks: DraftPickWithScores[]
  isTied: boolean
}

// Settings page types
export interface ParticipantWithProfile extends LeagueParticipant {
  teams: Team | null
  profiles: Profile | null
}

export interface NextPickInfo {
  round: number
  pick_number: number
  team_id: string
  participant_id: string
  user_id: string
}

// TMDb API types (from Edge Functions)
export interface TMDbSearchResult {
  tmdb_id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

export interface TMDbSearchResponse {
  page: number
  total_pages: number
  total_results: number
  results: TMDbSearchResult[]
}

export interface TMDbCastMember {
  id: number
  name: string
  character: string
  profile_url: string | null
}

export interface TMDbMovieDetails {
  tmdb_id: number
  imdb_id: string | null
  title: string
  tagline: string | null
  overview: string | null
  release_date: string | null
  runtime: number | null
  status: string
  poster_url: string | null
  backdrop_url: string | null
  vote_average: number
  vote_count: number
  genres: Array<{ id: number; name: string }>
  cast: TMDbCastMember[]
  director: string | null
}

// TMDb genre IDs for filtering
export const TMDB_GENRES = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Science Fiction' },
  { id: 10770, name: 'TV Movie' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' },
] as const

// ============================================================================
// Bidding system types
// ============================================================================

export type BidStatus = 'active' | 'outbid' | 'won' | 'lost' | 'cancelled'

export interface PickupBid {
  id: string
  league_id: string
  team_id: string
  tmdb_id: number
  movie_data: TMDbSearchResult | null
  amount: number
  status: BidStatus
  created_at: string
  countered_at: string | null
  response_deadline: string | null
  processing_deadline: string
}

export interface TeamBudget {
  id: string
  team_id: string
  remaining_budget: number
  total_spent: number
  created_at: string
  updated_at: string
}

export interface Pickup {
  id: string
  league_id: string
  team_id: string
  movie_id: string
  bid_id: string
  amount_paid: number
  picked_up_at: string
  dropped_at: string | null
  created_at: string
}

export interface TeamDrop {
  id: string
  team_id: string
  movie_id: string
  pickup_id: string
  dropped_at: string
  created_at: string
}

export type NotificationType = 'outbid' | 'bid_won' | 'bid_lost' | 'pickup_available'

export interface Notification {
  id: string
  user_id: string
  league_id: string | null
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

// Extended bidding types for queries with relations
export interface PickupWithMovie extends Pickup {
  movies: Movie
}

export interface PickupBidWithTeam extends PickupBid {
  teams: Team
}

export interface TeamWithBudget extends Team {
  team_budgets: TeamBudget | null
}

export interface ParticipantWithTeamBudget extends LeagueParticipant {
  teams: TeamWithBudget | null
  profiles: Profile | null
}

// Extended ranked team type that includes pickups
export interface RankedTeamWithPickups extends RankedTeam {
  pickups: PickupWithMovie[]
}
