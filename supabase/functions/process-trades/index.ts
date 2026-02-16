import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
} from '../_shared/utils.ts'
import {
  validateTradeProposal,
  getTeamInfo,
  getTeamName,
  createServiceClient,
  TradeNotification,
  TradeItems,
  TradeOffer,
  sendTradeEmailNotifications,
} from '../_shared/trade-validation.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'

interface TradeRecord {
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

interface ProcessResults {
  processed: number
  completed: number
  failed: number
  errors: string[]
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Authenticate cron requests using a secret header
    // This prevents unauthorized triggering of trade processing
    const cronSecret = Deno.env.get('CRON_SECRET')
    const providedSecret = req.headers.get('X-Cron-Secret')

    // If CRON_SECRET is set, require it to match
    if (cronSecret && providedSecret !== cronSecret) {
      return errorResponse('Unauthorized', 401)
    }

    // Also accept service role key in Authorization header as alternative auth
    const authHeader = req.headers.get('Authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!cronSecret && authHeader !== `Bearer ${serviceRoleKey}`) {
      return errorResponse('Unauthorized', 401)
    }

    const serviceClient = createServiceClient()
    const now = new Date().toISOString()
    const results: ProcessResults = {
      processed: 0,
      completed: 0,
      failed: 0,
      errors: [],
    }

    // Find trades ready for execution
    const { data: readyTrades, error: fetchError } = await serviceClient
      .from('trade_offers')
      .select('*')
      .or(`status.eq.accepted,and(status.eq.review,review_ends_at.lte.${now})`)
      .order('accepted_at', { ascending: true })
      .limit(10)

    if (fetchError) {
      console.error('Failed to fetch trades:', fetchError)
      return errorResponse('Failed to fetch trades', 500)
    }

    if (!readyTrades || readyTrades.length === 0) {
      return jsonResponse({
        message: 'No trades ready for processing',
        ...results,
      })
    }

    for (const trade of readyTrades as TradeRecord[]) {
      results.processed++

      try {
        const validationResult = await validateTradeProposal(
          serviceClient,
          trade.league_id,
          trade.initiator_team_id,
          trade.recipient_team_id,
          trade.initiator_items,
          trade.recipient_items
        )

        if (!validationResult.valid) {
          await serviceClient
            .from('trade_offers')
            .update({
              status: 'expired',
              veto_reason: `Trade expired: ${validationResult.error}`,
            })
            .eq('id', trade.id)

          await notifyTradeExpired(serviceClient, trade, validationResult.error ?? 'Validation failed')
          results.errors.push(`Trade ${trade.id}: ${validationResult.error}`)
          continue
        }

        const { error: executeError } = await serviceClient.rpc('execute_trade', {
          p_trade_id: trade.id,
        })

        if (executeError) {
          console.error(`Failed to execute trade ${trade.id}:`, executeError)
          results.failed++
          results.errors.push(`Trade ${trade.id}: ${executeError.message}`)
          continue
        }

        await notifyTradeCompleted(serviceClient, trade)
        results.completed++
      } catch (error) {
        console.error(`Error processing trade ${trade.id}:`, error)
        results.failed++
        results.errors.push(`Trade ${trade.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    return jsonResponse({
      message: `Processed ${results.processed} trades: ${results.completed} completed, ${results.failed} failed`,
      ...results,
    })
  } catch (error) {
    console.error('Error in process-trades:', error)
    return errorResponse('Internal server error', 500)
  }
})

async function notifyTradeCompleted(
  supabase: ReturnType<typeof createServiceClient>,
  trade: TradeRecord
): Promise<void> {
  const [initiatorInfo, recipientInfo, initiatorTeamName, recipientTeamName] = await Promise.all([
    getTeamInfo(supabase, trade.initiator_team_id),
    getTeamInfo(supabase, trade.recipient_team_id),
    getTeamName(supabase, trade.initiator_team_id),
    getTeamName(supabase, trade.recipient_team_id),
  ])

  const notifications: TradeNotification[] = []

  if (initiatorInfo) {
    notifications.push({
      user_id: initiatorInfo.user_id,
      league_id: trade.league_id,
      type: 'trade_completed',
      title: 'Trade Completed',
      body: `Your trade with ${recipientTeamName} has been completed`,
      data: { trade_offer_id: trade.id },
    })
  }

  if (recipientInfo) {
    notifications.push({
      user_id: recipientInfo.user_id,
      league_id: trade.league_id,
      type: 'trade_completed',
      title: 'Trade Completed',
      body: `Your trade with ${initiatorTeamName} has been completed`,
      data: { trade_offer_id: trade.id },
    })
  }

  if (notifications.length > 0) {
    await supabase.from('notifications').insert(notifications)
  }

  // Send email + Discord notifications in parallel
  const tradeOffer: TradeOffer = { ...trade, status: 'completed' }
  const leagueName = await getLeagueName(supabase, trade.league_id)

  await Promise.allSettled([
    sendTradeEmailNotifications(supabase, tradeOffer, 'completed', {
      notifyInitiator: true,
      notifyRecipient: true,
    }),
    sendDiscordNotification(supabase, {
      leagueId: trade.league_id,
      category: 'trades',
      embeds: [{
        author: buildEmbedAuthor(leagueName, trade.league_id),
        title: `Trade completed between ${initiatorTeamName} and ${recipientTeamName}`,
        color: DISCORD_COLORS.green,
        footer: { text: `Trade #${trade.id.slice(0, 8)}` },
        url: buildLeagueUrl(trade.league_id, '/trading'),
      }],
    }),
  ])
}

async function notifyTradeExpired(
  supabase: ReturnType<typeof createServiceClient>,
  trade: TradeRecord,
  reason: string
): Promise<void> {
  const [initiatorInfo, recipientInfo] = await Promise.all([
    getTeamInfo(supabase, trade.initiator_team_id),
    getTeamInfo(supabase, trade.recipient_team_id),
  ])

  const notifications: TradeNotification[] = []

  if (initiatorInfo) {
    notifications.push({
      user_id: initiatorInfo.user_id,
      league_id: trade.league_id,
      type: 'trade_cancelled',
      title: 'Trade Expired',
      body: `Your trade could not be completed: ${reason}`,
      data: { trade_offer_id: trade.id, expired_reason: reason },
    })
  }

  if (recipientInfo) {
    notifications.push({
      user_id: recipientInfo.user_id,
      league_id: trade.league_id,
      type: 'trade_cancelled',
      title: 'Trade Expired',
      body: `A trade could not be completed: ${reason}`,
      data: { trade_offer_id: trade.id, expired_reason: reason },
    })
  }

  if (notifications.length > 0) {
    await supabase.from('notifications').insert(notifications)
  }
}
