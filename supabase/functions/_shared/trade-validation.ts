import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isValidUUID, errorResponse } from './utils.ts'

// ============================================================================
// Types
// ============================================================================

export interface TradeMovieItem {
  movie_id: string
  source: 'draft_pick' | 'pickup'
  source_id: string
  title?: string
  poster_url?: string | null
  release_date?: string | null
}

export interface TradeItems {
  movies: TradeMovieItem[]
  faab: number
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface LeagueTradeConfig {
  trades_enabled: boolean
  trade_deadline: string | null
  trade_veto_hours: number
  trade_review_enabled: boolean
  total_slots: number
}

export interface TeamInfo {
  id: string
  name: string
  league_id: string
  user_id: string
  remaining_budget: number
}

export interface TradeOffer {
  id: string
  league_id: string
  initiator_team_id: string
  recipient_team_id: string
  initiator_items: TradeItems
  recipient_items: TradeItems
  status: string
  proposed_at: string
  responded_at: string | null
  accepted_at: string | null
  review_ends_at: string | null
  initiator_message: string | null
  response_message: string | null
  veto_reason: string | null
}

export interface TradeNotification {
  user_id: string
  league_id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
}

// ============================================================================
// Client Creation
// ============================================================================

/**
 * Create a service role Supabase client for admin operations
 */
export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )
}

// ============================================================================
// Trade Offer Operations
// ============================================================================

/**
 * Fetch a trade offer by ID
 */
export async function getTradeOffer(
  supabase: SupabaseClient,
  tradeOfferId: string
): Promise<{ offer: TradeOffer; error: null } | { offer: null; error: Response }> {
  if (!tradeOfferId || !isValidUUID(tradeOfferId)) {
    return { offer: null, error: errorResponse('Valid trade_offer_id is required', 400) }
  }

  const { data, error } = await supabase
    .from('trade_offers')
    .select('*')
    .eq('id', tradeOfferId)
    .single()

  if (error || !data) {
    return { offer: null, error: errorResponse('Trade offer not found', 404) }
  }

  return { offer: data as TradeOffer, error: null }
}

/**
 * Validate trade offer is in an allowed status
 */
export function validateTradeStatus(
  offer: TradeOffer,
  allowedStatuses: string[],
  actionDescription: string
): Response | null {
  if (!allowedStatuses.includes(offer.status)) {
    return errorResponse(
      `Cannot ${actionDescription} a trade with status "${offer.status}"`,
      400
    )
  }
  return null
}

// ============================================================================
// Notification Helpers
// ============================================================================

/**
 * Create and insert trade notifications for one or both teams
 */
export async function notifyTradeParties(
  supabase: SupabaseClient,
  options: {
    tradeOffer: TradeOffer
    notifyInitiator?: {
      type: string
      title: string
      bodyFn: (otherTeamName: string) => string
      data?: Record<string, unknown>
    }
    notifyRecipient?: {
      type: string
      title: string
      bodyFn: (otherTeamName: string) => string
      data?: Record<string, unknown>
    }
  }
): Promise<void> {
  const { tradeOffer, notifyInitiator, notifyRecipient } = options
  const notifications: TradeNotification[] = []

  if (notifyInitiator) {
    const initiatorInfo = await getTeamInfo(supabase, tradeOffer.initiator_team_id)
    const recipientTeamName = await getTeamName(supabase, tradeOffer.recipient_team_id)
    if (initiatorInfo) {
      notifications.push({
        user_id: initiatorInfo.user_id,
        league_id: tradeOffer.league_id,
        type: notifyInitiator.type,
        title: notifyInitiator.title,
        body: notifyInitiator.bodyFn(recipientTeamName),
        data: { trade_offer_id: tradeOffer.id, ...notifyInitiator.data },
      })
    }
  }

  if (notifyRecipient) {
    const recipientInfo = await getTeamInfo(supabase, tradeOffer.recipient_team_id)
    const initiatorTeamName = await getTeamName(supabase, tradeOffer.initiator_team_id)
    if (recipientInfo) {
      notifications.push({
        user_id: recipientInfo.user_id,
        league_id: tradeOffer.league_id,
        type: notifyRecipient.type,
        title: notifyRecipient.title,
        body: notifyRecipient.bodyFn(initiatorTeamName),
        data: { trade_offer_id: tradeOffer.id, ...notifyRecipient.data },
      })
    }
  }

  if (notifications.length > 0) {
    const { error } = await supabase.from('notifications').insert(notifications)
    if (error) {
      console.error('Failed to create trade notifications:', error)
    }
  }
}

/**
 * Get team name by ID
 */
export async function getTeamName(
  supabase: SupabaseClient,
  teamId: string
): Promise<string> {
  const { data } = await supabase
    .from('teams')
    .select('name')
    .eq('id', teamId)
    .single()

  return data?.name ?? 'A team'
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that a string is a valid trade items structure
 */
export function validateTradeItemsStructure(items: unknown): ValidationResult {
  if (!items || typeof items !== 'object') {
    return { valid: false, error: 'Invalid items structure' }
  }

  const typedItems = items as TradeItems

  // Validate faab
  if (typeof typedItems.faab !== 'number' || typedItems.faab < 0 || typedItems.faab > 100) {
    return { valid: false, error: 'FAAB must be a number between 0 and 100' }
  }

  if (!Number.isInteger(typedItems.faab)) {
    return { valid: false, error: 'FAAB must be a whole number' }
  }

  // Validate movies array
  if (!Array.isArray(typedItems.movies)) {
    return { valid: false, error: 'Movies must be an array' }
  }

  for (const movie of typedItems.movies) {
    if (!movie.movie_id || !isValidUUID(movie.movie_id)) {
      return { valid: false, error: 'Invalid movie_id in trade items' }
    }
    if (!movie.source || !['draft_pick', 'pickup'].includes(movie.source)) {
      return { valid: false, error: 'Invalid source type (must be draft_pick or pickup)' }
    }
    if (!movie.source_id || !isValidUUID(movie.source_id)) {
      return { valid: false, error: 'Invalid source_id in trade items' }
    }
  }

  return { valid: true }
}

/**
 * Validate that trade has at least one item
 */
export function validateTradeNotEmpty(
  initiatorItems: TradeItems,
  recipientItems: TradeItems
): ValidationResult {
  const hasInitiatorItems = initiatorItems.faab > 0 || initiatorItems.movies.length > 0
  const hasRecipientItems = recipientItems.faab > 0 || recipientItems.movies.length > 0

  if (!hasInitiatorItems && !hasRecipientItems) {
    return { valid: false, error: 'Trade must include at least one item' }
  }

  return { valid: true }
}

/**
 * Validate league allows trading and is before deadline
 */
export function validateLeagueTradingEnabled(
  config: LeagueTradeConfig,
  leagueStatus: string
): ValidationResult {
  if (!config.trades_enabled) {
    return { valid: false, error: 'Trading is not enabled for this league' }
  }

  if (leagueStatus !== 'active') {
    return { valid: false, error: 'League must be active to trade' }
  }

  // Check trade deadline
  if (config.trade_deadline) {
    const deadline = new Date(config.trade_deadline)
    const today = new Date()
    today.setHours(23, 59, 59, 999) // End of day

    if (today > deadline) {
      return { valid: false, error: 'Trade deadline has passed' }
    }
  }

  return { valid: true }
}

/**
 * Validate team owns the movies they're offering
 */
export async function validateMovieOwnership(
  supabase: SupabaseClient,
  teamId: string,
  items: TradeItems
): Promise<ValidationResult> {
  for (const movie of items.movies) {
    if (movie.source === 'draft_pick') {
      const { data, error } = await supabase
        .from('draft_picks')
        .select('id, team_id, dropped_at')
        .eq('id', movie.source_id)
        .single()

      if (error || !data) {
        return { valid: false, error: `Draft pick not found: ${movie.source_id}` }
      }
      if (data.team_id !== teamId) {
        return { valid: false, error: `Draft pick not owned by team: ${movie.source_id}` }
      }
      if (data.dropped_at) {
        return { valid: false, error: `Draft pick has been dropped: ${movie.source_id}` }
      }
    } else if (movie.source === 'pickup') {
      const { data, error } = await supabase
        .from('pickups')
        .select('id, team_id, dropped_at')
        .eq('id', movie.source_id)
        .single()

      if (error || !data) {
        return { valid: false, error: `Pickup not found: ${movie.source_id}` }
      }
      if (data.team_id !== teamId) {
        return { valid: false, error: `Pickup not owned by team: ${movie.source_id}` }
      }
      if (data.dropped_at) {
        return { valid: false, error: `Pickup has been dropped: ${movie.source_id}` }
      }
    }
  }

  return { valid: true }
}

/**
 * Validate team has enough FAAB budget
 */
export function validateFaabBudget(
  remainingBudget: number,
  faabAmount: number
): ValidationResult {
  if (faabAmount > remainingBudget) {
    return {
      valid: false,
      error: `Insufficient FAAB budget. Have $${remainingBudget}, trying to trade $${faabAmount}`
    }
  }
  return { valid: true }
}

/**
 * Validate both teams will have valid roster sizes after trade
 */
export async function validateRosterSpace(
  supabase: SupabaseClient,
  initiatorTeamId: string,
  recipientTeamId: string,
  initiatorItems: TradeItems,
  recipientItems: TradeItems,
  totalSlots: number
): Promise<ValidationResult> {
  // Get current movie counts
  const { data: initiatorCount } = await supabase.rpc('get_team_movie_count', {
    p_team_id: initiatorTeamId
  })

  const { data: recipientCount } = await supabase.rpc('get_team_movie_count', {
    p_team_id: recipientTeamId
  })

  const initiatorMovieCount = initiatorCount ?? 0
  const recipientMovieCount = recipientCount ?? 0

  // Calculate post-trade counts
  const initiatorGiving = initiatorItems.movies.length
  const initiatorReceiving = recipientItems.movies.length
  const recipientGiving = recipientItems.movies.length
  const recipientReceiving = initiatorItems.movies.length

  const newInitiatorCount = initiatorMovieCount - initiatorGiving + initiatorReceiving
  const newRecipientCount = recipientMovieCount - recipientGiving + recipientReceiving

  if (newInitiatorCount > totalSlots) {
    return {
      valid: false,
      error: `Trade would exceed initiator's roster limit (${newInitiatorCount}/${totalSlots})`
    }
  }

  if (newRecipientCount > totalSlots) {
    return {
      valid: false,
      error: `Trade would exceed recipient's roster limit (${newRecipientCount}/${totalSlots})`
    }
  }

  return { valid: true }
}

/**
 * Get team info including league_id and budget
 */
export async function getTeamInfo(
  supabase: SupabaseClient,
  teamId: string
): Promise<TeamInfo | null> {
  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select(`
      id,
      name,
      participant_id,
      league_participants!inner(league_id, user_id)
    `)
    .eq('id', teamId)
    .single()

  if (teamError || !team) return null

  const { data: budget } = await supabase
    .from('team_budgets')
    .select('remaining_budget')
    .eq('team_id', teamId)
    .single()

  const participant = team.league_participants as unknown as { league_id: string; user_id: string }

  return {
    id: team.id,
    name: team.name,
    league_id: participant.league_id,
    user_id: participant.user_id,
    remaining_budget: budget?.remaining_budget ?? 100,
  }
}

/**
 * Get league trade configuration
 */
export async function getLeagueTradeConfig(
  supabase: SupabaseClient,
  leagueId: string
): Promise<(LeagueTradeConfig & { status: string }) | null> {
  const { data, error } = await supabase
    .from('leagues')
    .select('status, trades_enabled, trade_deadline, trade_veto_hours, trade_review_enabled, total_slots')
    .eq('id', leagueId)
    .single()

  if (error || !data) return null

  return data as LeagueTradeConfig & { status: string }
}

/**
 * Validate a trade proposal completely
 */
export async function validateTradeProposal(
  supabase: SupabaseClient,
  leagueId: string,
  initiatorTeamId: string,
  recipientTeamId: string,
  initiatorItems: TradeItems,
  recipientItems: TradeItems
): Promise<ValidationResult> {
  // 1. Validate items structure
  let result = validateTradeItemsStructure(initiatorItems)
  if (!result.valid) return result

  result = validateTradeItemsStructure(recipientItems)
  if (!result.valid) return result

  // 2. Validate trade not empty
  result = validateTradeNotEmpty(initiatorItems, recipientItems)
  if (!result.valid) return result

  // 3. Get league config and validate trading enabled
  const config = await getLeagueTradeConfig(supabase, leagueId)
  if (!config) {
    return { valid: false, error: 'League not found' }
  }

  result = validateLeagueTradingEnabled(config, config.status)
  if (!result.valid) return result

  // 4. Get team info
  const initiatorInfo = await getTeamInfo(supabase, initiatorTeamId)
  const recipientInfo = await getTeamInfo(supabase, recipientTeamId)

  if (!initiatorInfo) {
    return { valid: false, error: 'Initiator team not found' }
  }
  if (!recipientInfo) {
    return { valid: false, error: 'Recipient team not found' }
  }

  // 5. Validate teams are in the same league
  if (initiatorInfo.league_id !== leagueId || recipientInfo.league_id !== leagueId) {
    return { valid: false, error: 'Both teams must be in the same league' }
  }

  // 6. Validate movie ownership
  result = await validateMovieOwnership(supabase, initiatorTeamId, initiatorItems)
  if (!result.valid) return result

  result = await validateMovieOwnership(supabase, recipientTeamId, recipientItems)
  if (!result.valid) return result

  // 7. Validate FAAB budgets
  result = validateFaabBudget(initiatorInfo.remaining_budget, initiatorItems.faab)
  if (!result.valid) return result

  result = validateFaabBudget(recipientInfo.remaining_budget, recipientItems.faab)
  if (!result.valid) return result

  // 8. Validate roster space
  result = await validateRosterSpace(
    supabase,
    initiatorTeamId,
    recipientTeamId,
    initiatorItems,
    recipientItems,
    config.total_slots
  )
  if (!result.valid) return result

  return { valid: true }
}

interface MovieData {
  title: string
  poster_url: string | null
  release_date: string | null
}

/**
 * Format trade items for display (enrich with movie data)
 */
export async function enrichTradeItems(
  supabase: SupabaseClient,
  items: TradeItems
): Promise<TradeItems> {
  const enrichedMovies: TradeMovieItem[] = []

  for (const movie of items.movies) {
    let movieData: MovieData | null = null

    if (movie.source === 'draft_pick') {
      const { data } = await supabase
        .from('draft_picks')
        .select('movies(title, poster_url, release_date)')
        .eq('id', movie.source_id)
        .single()

      if (data?.movies) {
        const movies = data.movies as unknown as MovieData
        movieData = movies
      }
    } else if (movie.source === 'pickup') {
      const { data } = await supabase
        .from('pickups')
        .select('movies(title, poster_url, release_date)')
        .eq('id', movie.source_id)
        .single()

      if (data?.movies) {
        const movies = data.movies as unknown as MovieData
        movieData = movies
      }
    }

    enrichedMovies.push({
      ...movie,
      title: movieData?.title ?? 'Unknown Movie',
      poster_url: movieData?.poster_url ?? null,
      release_date: movieData?.release_date ?? null,
    })
  }

  return {
    movies: enrichedMovies,
    faab: items.faab,
  }
}
