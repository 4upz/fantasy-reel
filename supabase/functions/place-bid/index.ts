import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  isUpcomingMovie,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { sendEmail } from '../_shared/email.ts'
import { getOutbidEmailHtml, getOutbidEmailText } from '../_shared/email-templates/outbid.ts'
import { sendDiscordNotification, buildNewBidEmbed, buildCounterBidEmbed, DiscordEmbed } from '../_shared/discord.ts'
import { computeBidWindow, newBidClosedMessage } from '../_shared/bid-window.ts'
import { createLogger } from '../_shared/logger.ts'
import { logNotificationDelivery, statusFromEmailResult } from '../_shared/notification-log.ts'

const log = createLogger('place-bid')

interface MovieData {
  title: string
  overview?: string | null
  poster_url: string | null
  release_date: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

interface PlaceBidRequest {
  league_id: string
  tmdb_id: number
  amount: number
  movie_data?: MovieData
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Auth check
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { league_id, tmdb_id, amount, movie_data }: PlaceBidRequest = await req.json()

    // Validate inputs
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!tmdb_id || typeof tmdb_id !== 'number' || tmdb_id <= 0) {
      return errorResponse('Valid tmdb_id is required', 400)
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
      return errorResponse('League is not active', 400)
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

    const team = (participant.teams as unknown as { id: string })
    if (!team) {
      return errorResponse('Team not found', 404)
    }

    // Get team's budget
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

    // Check if team has pickup slots available
    const pickupSlots = league.total_slots - league.draft_slots
    const { data: pickupCount } = await serviceClient
      .rpc('get_team_pickup_count', { p_team_id: team.id })

    if ((pickupCount ?? 0) >= pickupSlots) {
      return errorResponse('No pickup slots available', 400)
    }

    // Look up the movie by tmdb_id in case it's already in our DB (e.g. drafted,
    // or bid on before), so the release-date and eligibility checks below can
    // use the authoritative row instead of client-supplied data.
    const { data: existingMovie } = await serviceClient
      .from('movies')
      .select('id, release_date')
      .eq('tmdb_id', tmdb_id)
      .maybeSingle()

    // movie_data is client-supplied and only trusted when no `movies` row
    // exists yet for this tmdb_id. process-bids rechecks before awarding, but
    // that recheck is only authoritative for a movie that already has a `movies`
    // row -- for one first seen at processing time it re-validates this same
    // client data against itself (see the note there). So a forged release_date
    // on a movie we have never seen is not caught by either layer today.
    // Prefer the DB row's release_date once the movie exists;
    // only fall back to this request's own movie_data when it doesn't. We do
    // NOT fall back to movie_data captured by an earlier/other bid: that data
    // could be stale (the movie may have since released) and isn't scoped to
    // this caller, so trusting it would reopen the release-date exploit this
    // guard exists to close.
    const releaseDateToCheck = existingMovie ? existingMovie.release_date : movie_data?.release_date
    const releaseCheck = isUpcomingMovie(releaseDateToCheck)
    if (!releaseCheck.valid) {
      return errorResponse(`Cannot bid on this movie: ${releaseCheck.reason}`, 400)
    }

    // Check movie eligibility
    const { data: isEligible } = await serviceClient
      .rpc('is_movie_eligible_for_pickup', {
        p_league_id: league_id,
        p_tmdb_id: tmdb_id,
        p_movie_id: existingMovie?.id ?? null,
      })

    if (!isEligible) {
      return errorResponse('Movie is not eligible for pickup (already owned or scored)', 400)
    }

    // Get processing deadline (next Saturday 8pm UTC)
    const { data: processingDeadline } = await serviceClient
      .rpc('get_next_processing_deadline')

    // Every pending bid on this movie in this league, highest first -- not just
    // the leader. The counter-bid phase makes "is anyone bidding on this at all"
    // a rule of its own, and an 'outbid' row counts: that team can still counter
    // back. Reading the whole group once also means the leader, this team's own
    // bid, and the contested check all come from a single snapshot.
    const { data: pendingBids } = await serviceClient
      .from('pickup_bids')
      .select('*')
      .eq('league_id', league_id)
      .eq('tmdb_id', tmdb_id)
      .in('status', ['active', 'outbid'])
      .order('amount', { ascending: false })

    const highestBid = pendingBids?.find((bid) => bid.status === 'active')
    const existingTeamBid = pendingBids?.find((bid) => bid.team_id === team.id)
    const isAlreadyBidOn = (pendingBids?.length ?? 0) > 0

    // Past the cutoff the rest of the week belongs to counter bidding, so a
    // movie nobody is bidding on stays closed until the next cycle. Joining a
    // contest another team started, and raising your own bid, both stay legal --
    // that is the whole point of the phase.
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
        .from('pickup_bids')
        .update({
          amount,
          status: 'active',
          movie_data: movie_data || existingTeamBid.movie_data,
          countered_at: null,
          response_deadline: null,
        })
        .eq('id', existingTeamBid.id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating bid:', updateError)
        return errorResponse('Failed to update bid', 500)
      }
      newBid = updatedBid
    } else {
      // Create new bid
      const { data: insertedBid, error: insertError } = await serviceClient
        .from('pickup_bids')
        .insert({
          league_id,
          team_id: team.id,
          tmdb_id,
          movie_data,
          amount,
          status: 'active',
          processing_deadline: processingDeadline,
        })
        .select()
        .single()

      if (insertError) {
        console.error('Error inserting bid:', insertError)
        return errorResponse('Failed to place bid', 500)
      }
      newBid = insertedBid
    }

    // Re-verify we're the highest bidder (race condition mitigation)
    const { data: currentHighestBids } = await serviceClient
      .from('pickup_bids')
      .select('id, amount, team_id')
      .eq('league_id', league_id)
      .eq('tmdb_id', tmdb_id)
      .eq('status', 'active')
      .order('amount', { ascending: false })
      .limit(1)

    const currentHighest = currentHighestBids?.[0]

    // If someone outbid us during the race, mark our bid accordingly
    if (currentHighest && currentHighest.id !== newBid.id && currentHighest.amount >= amount) {
      const raceResponseDeadline = new Date()
      raceResponseDeadline.setHours(raceResponseDeadline.getHours() + league.counterbid_hours)

      await serviceClient
        .from('pickup_bids')
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

    // Movie details (used for notifications and Discord)
    const movieTitle = movie_data?.title || highestBid?.movie_data?.title || `Movie #${tmdb_id}`
    const posterPath = movie_data?.poster_url || highestBid?.movie_data?.poster_url
    const releaseDate = movie_data?.release_date || highestBid?.movie_data?.release_date

    // Track outbid email promise for parallel send with Discord
    let outbidEmailPromise: Promise<unknown> | null = null

    // Set when this bid took the lead from another team; drives the Discord
    // embed's counter-bid variant below.
    let counterContext: { previousAmount: number; counterWindowEnds: Date } | null = null

    // If there was a previous highest bid from another team, mark it as outbid
    if (highestBid && highestBid.team_id !== team.id) {
      const responseDeadline = new Date()
      responseDeadline.setHours(responseDeadline.getHours() + league.counterbid_hours)
      counterContext = { previousAmount: highestBid.amount, counterWindowEnds: responseDeadline }

      await serviceClient
        .from('pickup_bids')
        .update({
          status: 'outbid',
          countered_at: new Date().toISOString(),
          response_deadline: responseDeadline.toISOString(),
        })
        .eq('id', highestBid.id)

      // Get outbid user's info for notification
      const { data: outbidTeam } = await serviceClient
        .from('teams')
        .select('participant_id, league_participants(user_id)')
        .eq('id', highestBid.team_id)
        .single()

      if (outbidTeam) {
        const outbidUserId = (outbidTeam.league_participants as unknown as { user_id: string })?.user_id

        // Create notification
        await serviceClient.from('notifications').insert({
          user_id: outbidUserId,
          league_id,
          type: 'outbid',
          title: `You've been outbid on ${movieTitle}`,
          body: `Someone bid $${amount} on ${movieTitle}. You have ${league.counterbid_hours} hours to counter.`,
          data: {
            bid_id: highestBid.id,
            tmdb_id,
            new_amount: amount,
            response_deadline: responseDeadline.toISOString(),
          },
        })

        // Get user's email for email notification (parallel queries)
        const [{ data: outbidUser }, { data: userData }] = await Promise.all([
          serviceClient
            .from('profiles')
            .select('display_name')
            .eq('user_id', outbidUserId)
            .single(),
          serviceClient.auth.admin.getUserById(outbidUserId)
        ])
        const outbidEmail = userData?.user?.email

        if (outbidEmail) {
          const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
          const emailData = {
            recipientName: outbidUser?.display_name || 'Fantasy Manager',
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

          // Send outbid email (collected for Promise.allSettled below)
          outbidEmailPromise = sendEmail({
            to: outbidEmail,
            subject: `You've been outbid on ${movieTitle}`,
            html: getOutbidEmailHtml(emailData),
            text: getOutbidEmailText(emailData),
          }).then((result) => {
            logNotificationDelivery(serviceClient, {
              notificationType: 'bid_outbid',
              recipientEmail: outbidEmail,
              recipientUserId: outbidUserId,
              status: statusFromEmailResult(result),
              messageId: result.messageId,
              errorMessage: result.error,
              metadata: { league_id, movie_title: movieTitle, tmdb_id, new_amount: amount },
            })
            return result
          }).catch((err) => {
            logNotificationDelivery(serviceClient, {
              notificationType: 'bid_outbid',
              recipientEmail: outbidEmail,
              recipientUserId: outbidUserId,
              status: 'failed',
              errorMessage: err instanceof Error ? err.message : String(err),
              metadata: { league_id, movie_title: movieTitle, tmdb_id, new_amount: amount },
            })
          })
        }
      }
    }

    // Both variants stay anonymous: no bidder or team names. A counter bid does
    // show both amounts -- they are already public on the bidding page -- plus
    // when results are now expected, since the counter window can push
    // processing past the weekly deadline (the extended cron then resolves it).
    const bidEmbed: DiscordEmbed = counterContext
      ? buildCounterBidEmbed({
          leagueId: league_id,
          leagueName: league.name ?? 'League',
          movieTitle,
          posterPath,
          releaseDate,
          previousAmount: counterContext.previousAmount,
          newAmount: amount,
          processingDeadline: new Date(newBid.processing_deadline),
          counterWindowEnds: counterContext.counterWindowEnds,
        })
      : buildNewBidEmbed({
          leagueId: league_id,
          leagueName: league.name ?? 'League',
          movieTitle,
          posterPath,
          releaseDate,
          amount,
          processingDeadline: new Date(processingDeadline),
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
      message: highestBid ? 'You are now the highest bidder' : 'Bid placed successfully',
      was_update: !!existingTeamBid,
    }, 201)
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
