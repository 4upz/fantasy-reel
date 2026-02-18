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
} from '../_shared/utils.ts'
import { sendEmail } from '../_shared/email.ts'
import { getOutbidEmailHtml, getOutbidEmailText } from '../_shared/email-templates/outbid.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, DiscordEmbed } from '../_shared/discord.ts'

interface PlaceCounterpickBidRequest {
  league_id: string
  movie_id: string
  amount: number
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
      .select('id, teams(id, name)')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (participantError || !participant) {
      return errorResponse('You are not a member of this league', 403)
    }

    const team = participant.teams as unknown as { id: string; name: string }
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

    // Slot check: count existing WON counterpick bids + existing counterpicks with phase='bidding'
    const [{ count: wonBidCount }, { count: existingCounterpickCount }] = await Promise.all([
      serviceClient
        .from('counterpick_bids')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', team.id)
        .eq('league_id', league_id)
        .eq('status', 'won'),
      serviceClient
        .from('counterpicks')
        .select('*', { count: 'exact', head: true })
        .eq('counterpicker_team_id', team.id)
        .eq('league_id', league_id)
        .eq('phase', 'bidding'),
    ])

    const usedSlots = (wonBidCount ?? 0) + (existingCounterpickCount ?? 0)
    if (usedSlots >= biddingSlots) {
      return errorResponse('You have used all your bidding counterpick slots', 400)
    }

    // Movie validation: must exist in league draft, not dropped, not own team's, not already counterpicked
    const { data: draftPick, error: draftPickError } = await serviceClient
      .from('draft_picks')
      .select('id, team_id, movie_id, dropped_at, counterpicked_by_team_id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .is('dropped_at', null)
      .single()

    if (draftPickError || !draftPick) {
      return errorResponse('Movie not found in this league draft', 404)
    }

    if (draftPick.team_id === team.id) {
      return errorResponse('Cannot counterpick your own movie', 400)
    }

    if (draftPick.counterpicked_by_team_id) {
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

    // Get processing deadline (next Saturday 8pm UTC)
    const { data: processingDeadline } = await serviceClient
      .rpc('get_next_processing_deadline')

    // Check existing highest ACTIVE bid on this movie in counterpick_bids
    const { data: existingBids } = await serviceClient
      .from('counterpick_bids')
      .select('*')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .eq('status', 'active')
      .order('amount', { ascending: false })
      .limit(1)

    const highestBid = existingBids?.[0]

    // If there's a higher or equal bid, reject
    if (highestBid && highestBid.amount >= amount) {
      return errorResponse(`There is already a bid of $${highestBid.amount}. You must bid higher.`, 400)
    }

    // Check for existing team bid on this movie (active or outbid) -- update if exists, insert if new
    const { data: existingTeamBid } = await serviceClient
      .from('counterpick_bids')
      .select('*')
      .eq('league_id', league_id)
      .eq('team_id', team.id)
      .eq('movie_id', movie_id)
      .in('status', ['active', 'outbid'])
      .single()

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
      // Create new bid
      const { data: insertedBid, error: insertError } = await serviceClient
        .from('counterpick_bids')
        .insert({
          league_id,
          team_id: team.id,
          movie_id,
          target_team_id: draftPick.team_id,
          draft_pick_id: draftPick.id,
          amount,
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

    // Fetch movie info and target team name (used for notifications and Discord)
    const [{ data: movieInfo }, { data: targetTeam }] = await Promise.all([
      serviceClient.from('movies').select('title, poster_url').eq('id', movie_id).single(),
      serviceClient.from('teams').select('name').eq('id', draftPick.team_id).single(),
    ])

    const movieTitle = movieInfo?.title || 'Unknown Movie'
    const posterUrl = movieInfo?.poster_url

    let outbidEmailPromise: Promise<unknown> | null = null

    if (highestBid && highestBid.team_id !== team.id) {
      const responseDeadline = new Date()
      responseDeadline.setHours(responseDeadline.getHours() + league.counterbid_hours)

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
          })
        }
      }
    }

    const bidEmbed: DiscordEmbed = {
      author: buildEmbedAuthor(league.name ?? 'League', league_id),
      title: `New counterpick bid on ${movieTitle}`,
      description: `**${team.name}** bid $${amount} to counterpick **${targetTeam?.name ?? 'a team'}**'s movie`,
      thumbnail: posterUrl ? { url: `https://image.tmdb.org/t/p/w92${posterUrl}` } : undefined,
      color: DISCORD_COLORS.gold,
      footer: { text: `Bidding closes ${new Date(processingDeadline).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}` },
      url: buildLeagueUrl(league_id, '/bidding'),
    }

    // Add "Previous High" field only if outbidding someone
    if (highestBid && highestBid.team_id !== team.id) {
      const { data: previousTeam } = await serviceClient.from('teams').select('name').eq('id', highestBid.team_id).single()
      bidEmbed.fields = [{ name: 'Previous High', value: `${previousTeam?.name ?? 'A team'} at $${highestBid.amount}`, inline: true }]
    }

    const discordPromise = sendDiscordNotification(serviceClient, {
      leagueId: league_id,
      category: 'bids',
      embeds: [bidEmbed],
      mentionRole: !!(highestBid && highestBid.team_id !== team.id),
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
    console.error('Error placing counterpick bid:', error)
    return errorResponse('Internal server error', 500)
  }
})
