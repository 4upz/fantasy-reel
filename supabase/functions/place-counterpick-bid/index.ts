/**
 * Place Counterpick Bid Edge Function
 *
 * Allows teams to bid FAAB budget to counterpick opponent movies during
 * the active (bidding) phase. Mirrors place-bid but targets draft picks
 * for counterpicking instead of undrafted movies for pickup.
 *
 * Request: { league_id: string, movie_id: string, amount: number }
 * Response: { bid: CounterpickBid, message: string, was_update?: boolean, race_condition?: boolean }
 */

import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
  createServiceClient,
  isUpcomingMovie,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { sendEmail } from '../_shared/email.ts'
import { getOutbidEmailHtml, getOutbidEmailText } from '../_shared/email-templates/outbid.ts'
import { sendDiscordNotification, buildNewBidEmbed, buildCounterBidEmbed, DiscordEmbed } from '../_shared/discord.ts'
import { computeBidWindow, newBidClosedMessage } from '../_shared/bid-window.ts'
import { createLogger } from '../_shared/logger.ts'
import { logNotificationDelivery, statusFromEmailResult } from '../_shared/notification-log.ts'

const log = createLogger('place-counterpick-bid')

interface PlaceCounterpickBidRequest {
  league_id: string
  movie_id: string
  amount: number
}

/** The draft pick or pickup that owns the targeted movie, source-agnostic. */
interface CounterpickTarget {
  source: 'draft' | 'pickup'
  id: string
  team_id: string
  counterpicked_by_team_id: string | null
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Auth
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult

    const serviceClient = createServiceClient()

    const { league_id, movie_id, amount }: PlaceCounterpickBidRequest = await req.json()

    // Validate inputs
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!movie_id || !isValidUUID(movie_id)) {
      return errorResponse('Valid movie_id is required', 400)
    }

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > 100) {
      return errorResponse('Amount must be a whole number between 0 and 100', 400)
    }

    // Fetch league
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.status !== 'active') {
      return errorResponse('League must be active for counterpick bidding', 400)
    }

    // Check bidding counterpick slots are enabled
    const biddingSlots = league.bidding_counterpick_slots ?? 0
    if (biddingSlots === 0) {
      return errorResponse('Bidding counterpicks are not enabled for this league', 400)
    }

    // Get user's participant and team
    const { data: participant, error: participantError } = await serviceClient
      .from('league_participants')
      .select('id, teams(id)')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (participantError || !participant) {
      return errorResponse('You are not a member of this league', 403)
    }

    const team = participant.teams as unknown as { id: string }
    if (!team) {
      return errorResponse('Team not found', 404)
    }

    // Budget check
    const { data: budget, error: budgetError } = await serviceClient
      .from('team_budgets')
      .select('*')
      .eq('team_id', team.id)
      .single()

    if (budgetError || !budget) {
      return errorResponse('Team budget not found. Bidding may not be initialized yet.', 404)
    }

    if (amount > budget.remaining_budget) {
      return errorResponse(`Insufficient budget. You have $${budget.remaining_budget} remaining`, 400)
    }

    // Slot check: count counterpicks the team already holds in the bidding phase.
    // A won bid produces BOTH a counterpicks row and a counterpick_bids row with
    // status='won' (see process-bids), so counting either alone is correct but
    // summing them double-counts every used slot.
    const { count: usedSlots } = await serviceClient
      .from('counterpicks')
      .select('*', { count: 'exact', head: true })
      .eq('counterpicker_team_id', team.id)
      .eq('league_id', league_id)
      .eq('phase', 'bidding')

    if ((usedSlots ?? 0) >= biddingSlots) {
      return errorResponse('You have used all your bidding counterpick slots', 400)
    }

    // Movie validation: must exist in this league's draft picks or pickups,
    // not dropped, not own team's, not already counterpicked
    const { data: draftPick } = await serviceClient
      .from('draft_picks')
      .select('id, team_id, counterpicked_by_team_id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .is('dropped_at', null)
      .single()

    let target: CounterpickTarget | null = draftPick
      ? { source: 'draft', id: draftPick.id, team_id: draftPick.team_id, counterpicked_by_team_id: draftPick.counterpicked_by_team_id }
      : null

    if (!target) {
      const { data: pickup } = await serviceClient
        .from('pickups')
        .select('id, team_id, counterpicked_by_team_id')
        .eq('league_id', league_id)
        .eq('movie_id', movie_id)
        .is('dropped_at', null)
        .single()

      if (pickup) {
        target = { source: 'pickup', id: pickup.id, team_id: pickup.team_id, counterpicked_by_team_id: pickup.counterpicked_by_team_id }
      }
    }

    if (!target) {
      return errorResponse('Movie not found in this league draft', 404)
    }

    if (target.team_id === team.id) {
      return errorResponse('Cannot counterpick your own movie', 400)
    }

    if (target.counterpicked_by_team_id) {
      return errorResponse('This movie has already been counterpicked', 400)
    }

    // Belt-and-suspenders: also check counterpicks table directly
    const { data: existingCounterpick } = await serviceClient
      .from('counterpicks')
      .select('id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .single()

    if (existingCounterpick) {
      return errorResponse('This movie has already been counterpicked', 400)
    }

    // Fetch movie info (used for the release-date guard below and, later, notifications)
    const { data: movieInfo } = await serviceClient
      .from('movies')
      .select('title, poster_url, release_date')
      .eq('id', movie_id)
      .single()

    const releaseCheck = isUpcomingMovie(movieInfo?.release_date)
    if (!releaseCheck.valid) {
      return errorResponse(`Cannot counterpick this movie: ${releaseCheck.reason}`, 400)
    }

    // Get processing deadline (next Saturday 8pm UTC)
    const { data: processingDeadline } = await serviceClient
      .rpc('get_next_processing_deadline')

    // Every pending bid on this movie, highest first -- not just the leader.
    // The counter-bid phase makes "is anyone bidding on this at all" a rule of
    // its own, and an 'outbid' row counts: that team can still counter back.
    // Reading the group once also means the leader, this team's own bid, and the
    // contested check all come from a single snapshot.
    const { data: pendingBids } = await serviceClient
      .from('counterpick_bids')
      .select('*')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .in('status', ['active', 'outbid'])
      .order('amount', { ascending: false })

    const highestBid = pendingBids?.find((bid) => bid.status === 'active')
    const existingTeamBid = pendingBids?.find((bid) => bid.team_id === team.id)
    const isAlreadyBidOn = (pendingBids?.length ?? 0) > 0

    // Past the cutoff, counterpick bidding follows the same rule as pickup
    // bidding: no opening a contest on a movie nobody is bidding on. Both kinds
    // share get_next_processing_deadline() and sit in the same UI panel, so a
    // split rule would give one page two deadlines.
    const bidWindow = computeBidWindow(processingDeadline, league.new_bid_cutoff_hours)
    if (bidWindow.isCounterBidPhase && !isAlreadyBidOn) {
      return errorResponse(newBidClosedMessage(bidWindow), 400)
    }

    // If there's a higher or equal bid, reject
    if (highestBid && highestBid.amount >= amount) {
      return errorResponse(`There is already a bid of $${highestBid.amount}. You must bid higher.`, 400)
    }

    let newBid

    if (existingTeamBid) {
      // Update existing bid
      const { data: updatedBid, error: updateError } = await serviceClient
        .from('counterpick_bids')
        .update({
          amount,
          status: 'active',
          countered_at: null,
          response_deadline: null,
        })
        .eq('id', existingTeamBid.id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating counterpick bid:', updateError)
        return errorResponse('Failed to update bid', 500)
      }
      newBid = updatedBid
    } else {
      // New bids join at the back of the team's priority order. Promoting one is
      // a deliberate act, done from the bidding page, not a side effect of
      // bidding again. Gaps left by cancelled bids are harmless: process-bids
      // normalizes to a dense 1..N ranking before resolving.
      const { count: pendingBidCount } = await serviceClient
        .from('counterpick_bids')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', league_id)
        .eq('team_id', team.id)
        .in('status', ['active', 'outbid'])

      const { data: insertedBid, error: insertError } = await serviceClient
        .from('counterpick_bids')
        .insert({
          league_id,
          team_id: team.id,
          movie_id,
          target_team_id: target.team_id,
          draft_pick_id: target.source === 'draft' ? target.id : null,
          pickup_id: target.source === 'pickup' ? target.id : null,
          amount,
          priority: (pendingBidCount ?? 0) + 1,
          status: 'active',
          processing_deadline: processingDeadline,
        })
        .select()
        .single()

      if (insertError) {
        console.error('Error inserting counterpick bid:', insertError)
        return errorResponse('Failed to place bid', 500)
      }
      newBid = insertedBid
    }

    // Re-verify we're the highest bidder (race condition mitigation)
    const { data: currentHighestBids } = await serviceClient
      .from('counterpick_bids')
      .select('id, amount, team_id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .eq('status', 'active')
      .order('amount', { ascending: false })
      .limit(1)

    const currentHighest = currentHighestBids?.[0]

    // If someone outbid us during the race, mark our bid accordingly
    if (currentHighest && currentHighest.id !== newBid.id && currentHighest.amount >= amount) {
      const raceResponseDeadline = new Date()
      raceResponseDeadline.setHours(raceResponseDeadline.getHours() + league.counterbid_hours)

      await serviceClient
        .from('counterpick_bids')
        .update({
          status: 'outbid',
          countered_at: new Date().toISOString(),
          response_deadline: raceResponseDeadline.toISOString(),
        })
        .eq('id', newBid.id)

      return jsonResponse({
        bid: { ...newBid, status: 'outbid' },
        message: `Someone else bid $${currentHighest.amount} at the same time. You have ${league.counterbid_hours} hours to counter.`,
        was_update: !!existingTeamBid,
        race_condition: true,
      }, 201)
    }

    // movieInfo was fetched above for the release-date guard; reuse it for notifications
    const movieTitle = movieInfo?.title || 'Unknown Movie'
    const posterUrl = movieInfo?.poster_url
    const releaseDate = movieInfo?.release_date

    let outbidEmailPromise: Promise<unknown> | null = null

    // Set when this bid took the lead from another team; drives the Discord
    // embed's counter-bid variant below.
    let counterContext: { previousAmount: number; counterWindowEnds: Date } | null = null

    if (highestBid && highestBid.team_id !== team.id) {
      const responseDeadline = new Date()
      responseDeadline.setHours(responseDeadline.getHours() + league.counterbid_hours)
      counterContext = { previousAmount: highestBid.amount, counterWindowEnds: responseDeadline }

      await serviceClient
        .from('counterpick_bids')
        .update({
          status: 'outbid',
          countered_at: new Date().toISOString(),
          response_deadline: responseDeadline.toISOString(),
        })
        .eq('id', highestBid.id)

      const { data: outbidTeam } = await serviceClient
        .from('teams')
        .select('participant_id, league_participants(user_id)')
        .eq('id', highestBid.team_id)
        .single()

      if (outbidTeam) {
        const outbidUserId = (outbidTeam.league_participants as unknown as { user_id: string })?.user_id

        await serviceClient.from('notifications').insert({
          user_id: outbidUserId,
          league_id,
          type: 'outbid',
          title: `You've been outbid on counterpick: ${movieTitle}`,
          body: `Someone bid $${amount} to counterpick ${movieTitle}. You have ${league.counterbid_hours} hours to counter.`,
          data: {
            bid_id: highestBid.id,
            movie_id,
            new_amount: amount,
            response_deadline: responseDeadline.toISOString(),
            bid_type: 'counterpick',
          },
        })

        const [{ data: outbidProfile }, { data: userData }] = await Promise.all([
          serviceClient.from('profiles').select('display_name').eq('user_id', outbidUserId).single(),
          serviceClient.auth.admin.getUserById(outbidUserId),
        ])
        const outbidEmail = userData?.user?.email

        if (outbidEmail) {
          const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
          const emailData = {
            recipientName: outbidProfile?.display_name || 'Fantasy Manager',
            movieTitle,
            yourBidAmount: highestBid.amount,
            newBidAmount: amount,
            counterDeadline: responseDeadline.toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short',
            }),
            leagueUrl: `${baseUrl}/league/${league_id}`,
          }

          outbidEmailPromise = sendEmail({
            to: outbidEmail,
            subject: `You've been outbid on counterpick: ${movieTitle}`,
            html: getOutbidEmailHtml(emailData),
            text: getOutbidEmailText(emailData),
          }).then((result) => {
            logNotificationDelivery(serviceClient, {
              notificationType: 'counterpick_outbid',
              recipientEmail: outbidEmail,
              recipientUserId: outbidUserId,
              status: statusFromEmailResult(result),
              messageId: result.messageId,
              errorMessage: result.error,
              metadata: { league_id, movie_id, movie_title: movieTitle, new_amount: amount },
            })
            return result
          }).catch((err) => {
            logNotificationDelivery(serviceClient, {
              notificationType: 'counterpick_outbid',
              recipientEmail: outbidEmail,
              recipientUserId: outbidUserId,
              status: 'failed',
              errorMessage: err instanceof Error ? err.message : String(err),
              metadata: { league_id, movie_id, movie_title: movieTitle, new_amount: amount },
            })
          })
        }
      }
    }

    // Both variants stay anonymous: no bidder name or target team. A counter
    // bid does show both amounts (already public on the bidding page) plus when
    // results are now expected, since the counter window can push processing
    // past the weekly deadline (the extended cron then resolves it).
    const bidEmbed: DiscordEmbed = counterContext
      ? buildCounterBidEmbed({
          leagueId: league_id,
          leagueName: league.name ?? 'League',
          movieTitle,
          posterPath: posterUrl,
          releaseDate,
          previousAmount: counterContext.previousAmount,
          newAmount: amount,
          processingDeadline: new Date(newBid.processing_deadline),
          counterWindowEnds: counterContext.counterWindowEnds,
          titleSuffix: ' (🎯 Counterpick)',
        })
      : buildNewBidEmbed({
          leagueId: league_id,
          leagueName: league.name ?? 'League',
          movieTitle,
          posterPath: posterUrl,
          releaseDate,
          amount,
          processingDeadline: new Date(processingDeadline),
          // "New Bid: <movie> (🎯 Counterpick)" -- matches the counter
          // variant's suffix; the old "(🎯 Counter Pick Bid)" would read as
          // "Bid ... Bid" after the title prefix.
          titleSuffix: ' (🎯 Counterpick)',
        })

    const discordPromise = sendDiscordNotification(serviceClient, {
      leagueId: league_id,
      category: 'bids',
      embeds: [bidEmbed],
      mentionRole: counterContext !== null,
    })

    // Send email + Discord in parallel (non-blocking)
    const notificationPromises: Promise<unknown>[] = [discordPromise]
    if (outbidEmailPromise) notificationPromises.push(outbidEmailPromise)
    await Promise.allSettled(notificationPromises)

    return jsonResponse({
      bid: newBid,
      message: highestBid ? 'You are now the highest bidder' : 'Counterpick bid placed successfully',
      was_update: !!existingTeamBid,
    }, 201)
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
