import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
} from '../_shared/utils.ts'
import { sendEmail } from '../_shared/email.ts'
import { getOutbidEmailHtml, getOutbidEmailText } from '../_shared/email-templates/outbid.ts'

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

    // Check movie eligibility
    const { data: isEligible } = await serviceClient
      .rpc('is_movie_eligible_for_pickup', {
        p_league_id: league_id,
        p_tmdb_id: tmdb_id,
        p_movie_id: null,
      })

    if (!isEligible) {
      return errorResponse('Movie is not eligible for pickup (already owned or scored)', 400)
    }

    // Get processing deadline (next Saturday 8pm UTC)
    const { data: processingDeadline } = await serviceClient
      .rpc('get_next_processing_deadline')

    // Check for existing active bids on this movie in this league
    const { data: existingBids } = await serviceClient
      .from('pickup_bids')
      .select('*')
      .eq('league_id', league_id)
      .eq('tmdb_id', tmdb_id)
      .eq('status', 'active')
      .order('amount', { ascending: false })
      .limit(1)

    const highestBid = existingBids?.[0]

    // If there's a higher or equal bid, reject
    if (highestBid && highestBid.amount >= amount) {
      return errorResponse(`There is already a bid of $${highestBid.amount}. You must bid higher.`, 400)
    }

    // If this team already has an active or outbid bid on this movie, update it
    const { data: existingTeamBid } = await serviceClient
      .from('pickup_bids')
      .select('*')
      .eq('league_id', league_id)
      .eq('team_id', team.id)
      .eq('tmdb_id', tmdb_id)
      .in('status', ['active', 'outbid'])
      .single()

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

    // If there was a previous highest bid from another team, mark it as outbid
    if (highestBid && highestBid.team_id !== team.id) {
      const responseDeadline = new Date()
      responseDeadline.setHours(responseDeadline.getHours() + league.counterbid_hours)

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
        const movieTitle = movie_data?.title || highestBid.movie_data?.title || `Movie #${tmdb_id}`

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

          // Send email (non-blocking)
          sendEmail({
            to: outbidEmail,
            subject: `You've been outbid on ${movieTitle}`,
            html: getOutbidEmailHtml(emailData),
            text: getOutbidEmailText(emailData),
          }).catch(err => console.error('Failed to send outbid email:', err))
        }
      }
    }

    return jsonResponse({
      bid: newBid,
      message: highestBid ? 'You are now the highest bidder' : 'Bid placed successfully',
      was_update: !!existingTeamBid,
    }, 201)
  } catch (error) {
    console.error('Error placing bid:', error)
    return errorResponse('Internal server error', 500)
  }
})
