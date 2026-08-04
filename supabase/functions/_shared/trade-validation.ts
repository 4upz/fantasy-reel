import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isValidUUID, errorResponse, createServiceClient } from './utils.ts'
import { sendTradeEmail, formatTradeItemsForEmail, TradeEmailData, SendEmailResult } from './email.ts'

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
  faab_budget: number
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

// Re-export for backwards compatibility with existing imports
export { createServiceClient } from './utils.ts'

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
// Discord Mention Helpers
// ============================================================================

/**
 * Builds Discord mention content from a list of possibly-linked discord_ids.
 * Unlinked parties (null/undefined) are silently omitted -- a trade with one
 * or both sides not connected to Discord still gets a clean notification
 * with no mention text, rather than a broken `<@null>`.
 */
export function buildTradeMentions(
  discordIds: Array<string | null | undefined>
): string | undefined {
  const mentions = discordIds.filter((id): id is string => Boolean(id)).map((id) => `<@${id}>`)
  return mentions.length > 0 ? mentions.join(' ') : undefined
}

/**
 * Resolves the given users' linked Discord IDs and builds mention content
 * for a trade notification. profiles has no discord_id column -- the link
 * lives only in auth.identities, which requires the get_discord_ids_by_user_ids
 * SECURITY DEFINER RPC (PostgREST cannot query the auth schema directly).
 */
export async function getTradeMentionContent(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<string | undefined> {
  if (userIds.length === 0) return undefined

  const { data, error } = await supabase.rpc('get_discord_ids_by_user_ids', {
    p_user_ids: userIds,
  })

  if (error) {
    console.error('Failed to resolve trade party Discord IDs:', error.message)
    return undefined
  }

  return buildTradeMentions((data ?? []).map((row: { discord_id: string | null }) => row.discord_id))
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that a string is a valid trade items structure
 * @param items - The trade items to validate
 * @param maxFaab - Maximum FAAB allowed (from league configuration, defaults to 100)
 */
export function validateTradeItemsStructure(items: unknown, maxFaab = 100): ValidationResult {
  if (!items || typeof items !== 'object') {
    return { valid: false, error: 'Invalid items structure' }
  }

  const typedItems = items as TradeItems

  // Validate faab - use league's configured maximum
  if (typeof typedItems.faab !== 'number' || typedItems.faab < 0) {
    return { valid: false, error: 'FAAB must be a non-negative number' }
  }

  if (typedItems.faab > maxFaab) {
    return { valid: false, error: `FAAB must not exceed league budget of $${maxFaab}` }
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
    .select('status, trades_enabled, trade_deadline, trade_veto_hours, trade_review_enabled, total_slots, faab_budget')
    .eq('id', leagueId)
    .single()

  if (error || !data) return null

  // Default faab_budget to 100 if not set (for backwards compatibility)
  return {
    ...data,
    faab_budget: data.faab_budget ?? 100,
  } as LeagueTradeConfig & { status: string }
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
  // 1. Get league config first (needed for FAAB validation)
  const config = await getLeagueTradeConfig(supabase, leagueId)
  if (!config) {
    return { valid: false, error: 'League not found' }
  }

  // 2. Validate items structure (using league's FAAB budget)
  let result = validateTradeItemsStructure(initiatorItems, config.faab_budget)
  if (!result.valid) return result

  result = validateTradeItemsStructure(recipientItems, config.faab_budget)
  if (!result.valid) return result

  // 3. Validate trade not empty
  result = validateTradeNotEmpty(initiatorItems, recipientItems)
  if (!result.valid) return result

  // 4. Validate trading enabled
  result = validateLeagueTradingEnabled(config, config.status)
  if (!result.valid) return result

  // 5. Get team info
  const initiatorInfo = await getTeamInfo(supabase, initiatorTeamId)
  const recipientInfo = await getTeamInfo(supabase, recipientTeamId)

  if (!initiatorInfo) {
    return { valid: false, error: 'Initiator team not found' }
  }
  if (!recipientInfo) {
    return { valid: false, error: 'Recipient team not found' }
  }

  // 6. Validate teams are in the same league
  if (initiatorInfo.league_id !== leagueId || recipientInfo.league_id !== leagueId) {
    return { valid: false, error: 'Both teams must be in the same league' }
  }

  // 7. Validate movie ownership
  result = await validateMovieOwnership(supabase, initiatorTeamId, initiatorItems)
  if (!result.valid) return result

  result = await validateMovieOwnership(supabase, recipientTeamId, recipientItems)
  if (!result.valid) return result

  // 8. Validate FAAB budgets
  result = validateFaabBudget(initiatorInfo.remaining_budget, initiatorItems.faab)
  if (!result.valid) return result

  result = validateFaabBudget(recipientInfo.remaining_budget, recipientItems.faab)
  if (!result.valid) return result

  // 9. Validate roster space
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

// ============================================================================
// Email Notification Helpers
// ============================================================================

type TradeEmailType =
  | 'proposed'
  | 'countered'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'vetoed'

interface TradePartyInfo {
  userId: string
  email: string
  teamName: string
}

/**
 * Get user email and team name for a team
 */
async function getTradePartyInfo(
  supabase: SupabaseClient,
  teamId: string
): Promise<TradePartyInfo | null> {
  const { data: team } = await supabase
    .from('teams')
    .select(`
      name,
      league_participants!inner(user_id)
    `)
    .eq('id', teamId)
    .single()

  if (!team) return null

  const participant = team.league_participants as unknown as { user_id: string }

  // Get user email from auth.users via RPC or profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', participant.user_id)
    .single()

  // If profile doesn't have email, try auth.users
  if (!profile?.email) {
    const { data: authUser } = await supabase.auth.admin.getUserById(participant.user_id)
    if (!authUser?.user?.email) return null

    return {
      userId: participant.user_id,
      email: authUser.user.email,
      teamName: team.name,
    }
  }

  return {
    userId: participant.user_id,
    email: profile.email,
    teamName: team.name,
  }
}

/**
 * Get league name and URL
 */
async function getLeagueInfo(
  supabase: SupabaseClient,
  leagueId: string
): Promise<{ name: string; url: string } | null> {
  const { data } = await supabase
    .from('leagues')
    .select('name')
    .eq('id', leagueId)
    .single()

  if (!data) return null

  const appUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
  return {
    name: data.name,
    url: `${appUrl}/league/${leagueId}`,
  }
}

/**
 * Format trade items to string for email display
 */
async function formatItemsForEmail(
  supabase: SupabaseClient,
  items: TradeItems
): Promise<string> {
  const movieTitles: string[] = []

  for (const movie of items.movies) {
    const table = movie.source === 'draft_pick' ? 'draft_picks' : 'pickups'
    const { data } = await supabase
      .from(table)
      .select('movies(title)')
      .eq('id', movie.source_id)
      .single()

    const movieData = data?.movies as unknown as { title: string } | null
    movieTitles.push(movieData?.title ?? 'Unknown Movie')
  }

  return formatTradeItemsForEmail(movieTitles, items.faab)
}

/**
 * Log notification delivery result to the notification_log table
 */
async function logNotificationDelivery(
  supabase: SupabaseClient,
  tradeOfferId: string,
  notificationType: string,
  recipientEmail: string,
  recipientUserId: string | null,
  result: SendEmailResult,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    // Determine status based on result
    let status: 'sent' | 'failed' | 'skipped'
    if (result.success) {
      status = 'sent'
    } else if (result.error === 'RESEND_API_KEY not configured') {
      status = 'skipped'
    } else {
      status = 'failed'
    }

    await supabase.rpc('log_notification_delivery', {
      p_trade_offer_id: tradeOfferId,
      p_notification_type: notificationType,
      p_recipient_email: recipientEmail,
      p_recipient_user_id: recipientUserId,
      p_status: status,
      p_message_id: result.messageId ?? null,
      p_error_message: result.error ?? null,
      p_metadata: metadata ?? {},
    })
  } catch (error) {
    // Don't let logging failures affect the main flow
    console.error('Failed to log notification delivery:', error)
  }
}

/**
 * Send trade email notifications to one or both parties
 * Now with delivery tracking for observability
 */
export async function sendTradeEmailNotifications(
  supabase: SupabaseClient,
  tradeOffer: TradeOffer,
  emailType: TradeEmailType,
  options?: {
    notifyInitiator?: boolean
    notifyRecipient?: boolean
    message?: string
    vetoReason?: string
  }
): Promise<void> {
  const { notifyInitiator = false, notifyRecipient = false, message, vetoReason } = options ?? {}

  if (!notifyInitiator && !notifyRecipient) return

  try {
    // Get league info
    const leagueInfo = await getLeagueInfo(supabase, tradeOffer.league_id)
    if (!leagueInfo) {
      console.warn('Could not get league info for trade email')
      return
    }

    // Get party info
    const initiatorInfo = notifyInitiator
      ? await getTradePartyInfo(supabase, tradeOffer.initiator_team_id)
      : null
    const recipientInfo = notifyRecipient
      ? await getTradePartyInfo(supabase, tradeOffer.recipient_team_id)
      : null

    // Format items
    const initiatorItemsStr = await formatItemsForEmail(supabase, tradeOffer.initiator_items)
    const recipientItemsStr = await formatItemsForEmail(supabase, tradeOffer.recipient_items)

    // Build metadata for logging
    const baseMetadata = {
      league_id: tradeOffer.league_id,
      league_name: leagueInfo.name,
      email_type: emailType,
    }

    // Send to initiator if requested
    if (initiatorInfo) {
      const recipientName = recipientInfo?.teamName ?? await getTeamName(supabase, tradeOffer.recipient_team_id)

      const emailData: TradeEmailData = {
        recipientEmail: initiatorInfo.email,
        recipientTeamName: initiatorInfo.teamName,
        otherTeamName: recipientName,
        leagueName: leagueInfo.name,
        leagueUrl: leagueInfo.url,
        // From initiator's perspective: they offered initiator_items, requesting recipient_items
        offeredItems: initiatorItemsStr,
        requestedItems: recipientItemsStr,
        message,
        vetoReason,
        reviewEndsAt: tradeOffer.review_ends_at ?? undefined,
      }

      const result = await sendTradeEmail(emailType, emailData)

      // Log the delivery result
      await logNotificationDelivery(
        supabase,
        tradeOffer.id,
        `trade_${emailType}`,
        initiatorInfo.email,
        initiatorInfo.userId,
        result,
        { ...baseMetadata, recipient_team_name: initiatorInfo.teamName, party: 'initiator' }
      )
    }

    // Send to recipient if requested
    if (recipientInfo) {
      const initiatorName = initiatorInfo?.teamName ?? await getTeamName(supabase, tradeOffer.initiator_team_id)

      const emailData: TradeEmailData = {
        recipientEmail: recipientInfo.email,
        recipientTeamName: recipientInfo.teamName,
        otherTeamName: initiatorName,
        leagueName: leagueInfo.name,
        leagueUrl: leagueInfo.url,
        // From recipient's perspective: they're being offered initiator_items in exchange for recipient_items
        offeredItems: initiatorItemsStr,
        requestedItems: recipientItemsStr,
        message,
        vetoReason,
        reviewEndsAt: tradeOffer.review_ends_at ?? undefined,
      }

      const result = await sendTradeEmail(emailType, emailData)

      // Log the delivery result
      await logNotificationDelivery(
        supabase,
        tradeOffer.id,
        `trade_${emailType}`,
        recipientInfo.email,
        recipientInfo.userId,
        result,
        { ...baseMetadata, recipient_team_name: recipientInfo.teamName, party: 'recipient' }
      )
    }
  } catch (error) {
    // Non-blocking: log and continue
    console.error('Error sending trade email notifications:', error)
  }
}
