import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  internalErrorResponse,
  isAuthorizedCronRequest,
} from '../_shared/utils.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'
import {
  validateTradeProposal,
  createServiceClient,
  notifyTradeParties,
  sendTradeEmailNotifications,
  TradeItems,
} from '../_shared/trade-validation.ts'
import {
  notifyTradeCompleted,
  notifyTradesInvalidated,
  type ExecuteTradeResult,
} from '../_shared/trade-completion.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'
import { anchorMovieTitle, expiredReasonText } from '../_shared/trade-expiry.ts'

const log = createLogger('process-trades')

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
  expires_at: string | null
  expiry_anchor: 'fixed' | 'first_release' | null
  expired_reason: ExpiredReason | null
}

type ExpiredReason = 'offer_window' | 'movie_released' | 'league_deadline'

/** One offer whose release anchor moved with its movie. */
interface ReresolvedOffer {
  id: string
  league_id: string
  initiator_team_id: string
  recipient_team_id: string
  initiator_items: TradeItems
  recipient_items: TradeItems
  previous_expires_at: string | null
  expires_at: string
}

interface ProcessResults {
  processed: number
  completed: number
  failed: number
  /** Competing offers expired because a movie they named was traded elsewhere. */
  invalidated: number
  /** Unanswered offers whose own clock ran out. */
  expired_by_clock: number
  /** Release-anchored offers whose movie moved, so their clock moved with it. */
  reresolved: number
  errors: string[]
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    // Cron secret OR service role key -- mirrors the other scheduled jobs.
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('process-trades')

    const serviceClient = createServiceClient()
    runClient = serviceClient
    const now = new Date().toISOString()
    const results: ProcessResults = {
      processed: 0,
      completed: 0,
      failed: 0,
      invalidated: 0,
      expired_by_clock: 0,
      reresolved: 0,
      errors: [],
    }

    // Offer expiry runs before the execution loop, and re-resolution runs before
    // the sweep, so a movie that moved into the past expires its offers in this
    // same pass rather than waiting five more minutes.
    //
    // Neither step can block trade execution: an expiry failure counts toward
    // results.failed -- which is what computeStatus reads, so the run lands
    // non-ok and fires the existing ops alert -- rather than aborting the run.
    await reresolveReleaseAnchors(serviceClient, results)
    await sweepExpiredOffers(serviceClient, results)

    // Find trades ready for execution
    const { data: readyTrades, error: fetchError } = await serviceClient
      .from('trade_offers')
      .select('*')
      .or(`status.eq.accepted,and(status.eq.review,review_ends_at.lte.${now})`)
      .order('accepted_at', { ascending: true })
      .limit(10)

    if (fetchError) {
      log.error('Failed to fetch trades', { error: serializeError(fetchError) })
      return errorResponse('Failed to fetch trades', 500)
    }

    if (!readyTrades || readyTrades.length === 0) {
      const job_status = await run.finish(serviceClient, {
        processed: results.processed,
        failed: results.failed,
        errors: results.errors,
        metadata: {
          expired_by_clock: results.expired_by_clock,
          reresolved: results.reresolved,
        },
      })
      return jsonResponse({
        message: 'No trades ready for processing',
        ...results,
        job_status,
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

        const { data: executeData, error: executeError } = await serviceClient.rpc('execute_trade', {
          p_trade_id: trade.id,
        })

        if (executeError) {
          log.error('Failed to execute trade', { trade_id: trade.id, error: serializeError(executeError) })
          results.failed++
          results.errors.push(`Trade ${trade.id}: ${executeError.message}`)
          continue
        }

        // execute_trade reports business-rule refusals inside its JSONB return
        // value rather than by raising (see ExecuteTradeResult), so a null rpc
        // error is NOT on its own proof the trade went through. This previously
        // fell straight into notifyTradeCompleted, telling both teams a trade
        // had completed when nothing had moved.
        const executeResult = executeData as ExecuteTradeResult | null

        if (!executeResult?.success) {
          const reason = executeResult?.error ?? 'execute_trade returned no result'
          log.error('Trade execution refused', { trade_id: trade.id, reason })
          results.failed++
          results.errors.push(`Trade ${trade.id}: ${reason}`)
          continue
        }

        await notifyTradeCompleted(serviceClient, trade)
        results.completed++

        // Offers that named a movie this trade just moved were expired inside
        // execute_trade. Tell those teams why their offer disappeared.
        const invalidated = executeResult.invalidated_trades ?? []
        if (invalidated.length > 0) {
          results.invalidated += invalidated.length
          await notifyTradesInvalidated(serviceClient, invalidated)
        }
      } catch (error) {
        log.error('Error processing trade', { trade_id: trade.id, error: serializeError(error) })
        results.failed++
        results.errors.push(`Trade ${trade.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    const job_status = await run.finish(serviceClient, {
      processed: results.processed,
      failed: results.failed,
      errors: results.errors,
      metadata: {
        completed: results.completed,
        invalidated: results.invalidated,
        expired_by_clock: results.expired_by_clock,
        reresolved: results.reresolved,
      },
    })

    return jsonResponse({
      message:
        `Processed ${results.processed} trades: ${results.completed} completed, ${results.failed} failed` +
        (results.invalidated > 0 ? `, ${results.invalidated} competing offers expired` : '') +
        (results.expired_by_clock > 0 ? `, ${results.expired_by_clock} offers lapsed` : ''),
      ...results,
      job_status,
    })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})

/**
 * Run `task` over every item, a few at a time.
 *
 * Each expired offer costs ~20 sequential round trips (two team lookups, a
 * league lookup, per-movie item formatting) plus two emails. A league whose
 * trade deadline just passed can expire every open offer at once, and doing
 * that strictly one at a time is what would put this cron near its wall clock.
 * The cap keeps the burst off the database's throat.
 */
async function forEachWithConcurrency<T>(
  items: T[],
  task: (item: T) => Promise<void>,
  limit = 5
): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.allSettled(items.slice(i, i + limit).map(task))
  }
}

/**
 * Recompute expiry for open release-anchored offers, and tell both sides when
 * their window moved.
 *
 * Release dates shift -- that is what sync-release-dates exists for -- and an
 * offer that said "good until Dune 3 opens" has to follow the movie. Only the
 * offers that actually moved come back, so a quiet run notifies nobody.
 */
async function reresolveReleaseAnchors(
  supabase: ReturnType<typeof createServiceClient>,
  results: ProcessResults
): Promise<void> {
  const { data, error } = await supabase.rpc('reresolve_release_anchored_offers')

  if (error) {
    log.error('Failed to re-resolve release-anchored offers', { error: serializeError(error) })
    // Counted, not just logged: job_status is computed from processed/failed,
    // so an error string alone would leave a broken run reporting "ok".
    results.failed++
    results.errors.push(`Release re-resolution: ${error.message}`)
    return
  }

  const moved = (data ?? []) as ReresolvedOffer[]
  if (moved.length === 0) return

  results.reresolved = moved.length
  log.info('Release-anchored offers re-resolved', { count: moved.length })

  await forEachWithConcurrency(moved, async (offer) => {
    const title = anchorMovieTitle(offer)
    const body = title
      ? `${title} moved, so your trade offer now stands until its new release.`
      : 'A movie in your trade moved, so the offer window moved with it.'

    // Both sides get the same sentence -- the window moved for both of them.
    const notice = {
      type: 'trade_proposed',
      title: 'Trade Offer Window Moved',
      bodyFn: () => body,
      data: { new_expires_at: offer.expires_at, previous_expires_at: offer.previous_expires_at },
    }

    await notifyTradeParties(supabase, {
      tradeOffer: offer,
      notifyInitiator: notice,
      notifyRecipient: notice,
    })
  })
}

/**
 * Expire unanswered offers whose clock ran out, and notify both sides.
 *
 * The claim and the flip happen in one statement inside expire_lapsed_trade_offers(),
 * so two overlapping cron runs cannot both claim a row: only rows this call gets
 * back are notified, and a second run over the same data notifies nobody.
 */
async function sweepExpiredOffers(
  supabase: ReturnType<typeof createServiceClient>,
  results: ProcessResults
): Promise<void> {
  const { data, error } = await supabase.rpc('expire_lapsed_trade_offers')

  if (error) {
    log.error('Failed to sweep expired offers', { error: serializeError(error) })
    results.failed++
    results.errors.push(`Offer expiry sweep: ${error.message}`)
    return
  }

  const expired = (data ?? []) as TradeRecord[]
  if (expired.length === 0) return

  results.expired_by_clock = expired.length
  log.info('Trade offers expired', { count: expired.length })

  await forEachWithConcurrency(expired, async (trade) => {
    const reason = expiredReasonText(trade)

    await notifyTradeParties(supabase, {
      tradeOffer: trade,
      // No trade_expired notification type exists, and adding an enum value
      // costs two migrations because a new value cannot be used in the
      // transaction that adds it. trade_cancelled with expiry wording is what
      // the pre-existing expiry path already does.
      notifyInitiator: {
        type: 'trade_cancelled',
        title: 'Trade Offer Expired',
        bodyFn: (other) => `Your trade offer to ${other} expired. ${reason}`,
        data: { expired_reason: trade.expired_reason },
      },
      notifyRecipient: {
        type: 'trade_cancelled',
        title: 'Trade Offer Expired',
        bodyFn: (other) => `The trade offer from ${other} expired. ${reason}`,
        data: { expired_reason: trade.expired_reason },
      },
    })

    await sendTradeEmailNotifications(supabase, trade, 'expired', {
      notifyInitiator: true,
      notifyRecipient: true,
      expiredReason: reason,
    })
  })
}

async function notifyTradeExpired(
  supabase: ReturnType<typeof createServiceClient>,
  trade: TradeRecord,
  reason: string
): Promise<void> {
  // Distinct from an offer lapsing on its own clock (sweepExpiredOffers): this
  // is an agreed trade that could not go through, so the wording is different
  // even though the terminal status is the same.
  await notifyTradeParties(supabase, {
    tradeOffer: trade,
    notifyInitiator: {
      type: 'trade_cancelled',
      title: 'Trade Expired',
      bodyFn: () => `Your trade could not be completed: ${reason}`,
      data: { expired_reason: reason },
    },
    notifyRecipient: {
      type: 'trade_cancelled',
      title: 'Trade Expired',
      bodyFn: () => `A trade could not be completed: ${reason}`,
      data: { expired_reason: reason },
    },
  })
}
