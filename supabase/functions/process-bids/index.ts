/**
 * Process Bids Edge Function
 *
 * Batch processing function for bid resolution, called by cron jobs.
 *
 * Two modes:
 * - 'weekly': Processes bids where processing_deadline <= now (Saturday 8pm UTC)
 * - 'extended': Processes bids where response_deadline has passed (hourly check for counter-bid windows)
 *
 * Processing logic:
 * 1. Group bids by movie (league_id + tmdb_id)
 * 2. Skip movies where any bid still has an open response window
 * 3. Find winner (highest amount, earliest created_at for ties)
 * 4. Create movie if it doesn't exist (from movie_data)
 * 5. Create pickup record
 * 6. Deduct from team budget
 * 7. Mark winner as 'won', others as 'lost'
 * 8. Send notifications to winner and losers
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest } from '../_shared/utils.ts'

interface ProcessBidsRequest {
  mode?: 'weekly' | 'extended'
}

interface PickupBid {
  id: string
  league_id: string
  team_id: string
  tmdb_id: number
  movie_data: MovieData | null
  amount: number
  status: string
  created_at: string
  countered_at: string | null
  response_deadline: string | null
  processing_deadline: string
}

interface MovieData {
  title: string
  overview?: string | null
  poster_url: string | null
  release_date: string | null
  vote_average: number
  popularity: number
  genre_ids?: number[]
}

interface ProcessResult {
  tmdb_id: number
  league_id: string
  winner_team_id: string
  amount: number
  movie_title: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Authenticate cron requests using a secret header
    // This prevents unauthorized triggering of bid processing
    const cronSecret = Deno.env.get('CRON_SECRET')
    const providedSecret = req.headers.get('X-Cron-Secret')

    // If CRON_SECRET is set, require it to match
    if (cronSecret && providedSecret !== cronSecret) {
      return errorResponse('Forbidden', 403)
    }

    // Also accept service role key in Authorization header as alternative auth
    const authHeader = req.headers.get('Authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!cronSecret && authHeader !== `Bearer ${serviceRoleKey}`) {
      return errorResponse('Forbidden', 403)
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { mode = 'weekly' }: ProcessBidsRequest = await req.json().catch(() => ({ mode: 'weekly' }))

    if (mode !== 'weekly' && mode !== 'extended') {
      return errorResponse('Mode must be "weekly" or "extended"', 400)
    }

    const now = new Date()
    let bidsToProcess: PickupBid[]

    if (mode === 'weekly') {
      // Weekly: process active bids where processing_deadline <= now
      const { data, error } = await serviceClient
        .from('pickup_bids')
        .select('*')
        .eq('status', 'active')
        .lte('processing_deadline', now.toISOString())

      if (error) {
        console.error('Failed to fetch weekly bids:', error)
        return errorResponse('Failed to fetch bids', 500)
      }
      bidsToProcess = data || []
    } else {
      // Extended: find active bids where response_deadline has passed
      // These are bids in extended time due to counter-bidding
      const { data, error } = await serviceClient
        .from('pickup_bids')
        .select('*')
        .eq('status', 'active')
        .not('response_deadline', 'is', null)
        .lt('response_deadline', now.toISOString())

      if (error) {
        console.error('Failed to fetch extended bids:', error)
        return errorResponse('Failed to fetch extended bids', 500)
      }

      // Filter to only those where response_deadline > processing_deadline
      // (meaning they're in extended time, not just regular weekly processing)
      bidsToProcess = (data || []).filter(
        (bid) => new Date(bid.response_deadline!) > new Date(bid.processing_deadline)
      )
    }

    if (bidsToProcess.length === 0) {
      return jsonResponse({
        message: 'No bids to process',
        mode,
        processed: 0,
        results: [],
      })
    }

    // Group bids by movie (league_id + tmdb_id)
    const bidsByMovie = new Map<string, PickupBid[]>()
    for (const bid of bidsToProcess) {
      const key = `${bid.league_id}:${bid.tmdb_id}`
      if (!bidsByMovie.has(key)) {
        bidsByMovie.set(key, [])
      }
      bidsByMovie.get(key)!.push(bid)
    }

    const results: ProcessResult[] = []
    const errors: Array<{ movie_key: string; error: string }> = []

    for (const [key, bids] of bidsByMovie) {
      const [leagueId, tmdbIdStr] = key.split(':')
      const tmdbId = parseInt(tmdbIdStr)

      try {
        // Check if any bids for this movie still have open response windows
        // (including outbid entries that might counter)
        const { data: allBidsForMovie } = await serviceClient
          .from('pickup_bids')
          .select('*')
          .eq('league_id', leagueId)
          .eq('tmdb_id', tmdbId)
          .in('status', ['active', 'outbid'])

        const hasOpenWindow = (allBidsForMovie || []).some(
          (bid) => bid.response_deadline && new Date(bid.response_deadline) > now
        )

        if (hasOpenWindow) {
          // Skip this movie - someone still has time to counter
          continue
        }

        // Find active bids only (outbid entries don't win)
        const activeBids = (allBidsForMovie || []).filter((b) => b.status === 'active')
        if (activeBids.length === 0) {
          continue
        }

        // Find the winner: highest amount, earliest created_at for ties
        activeBids.sort((a, b) => {
          if (b.amount !== a.amount) return b.amount - a.amount
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })

        const winner = activeBids[0]
        const movieTitle = winner.movie_data?.title || `Movie #${winner.tmdb_id}`

        // Create movie if it doesn't exist
        let movieId: string
        const { data: existingMovie } = await serviceClient
          .from('movies')
          .select('id')
          .eq('tmdb_id', winner.tmdb_id)
          .single()

        if (existingMovie) {
          movieId = existingMovie.id
        } else if (winner.movie_data) {
          const { data: newMovie, error: movieError } = await serviceClient
            .from('movies')
            .insert({
              tmdb_id: winner.tmdb_id,
              title: winner.movie_data.title,
              overview: winner.movie_data.overview,
              poster_url: winner.movie_data.poster_url,
              release_date: winner.movie_data.release_date,
              popularity: winner.movie_data.popularity,
              vote_average: winner.movie_data.vote_average,
              status: 'upcoming',
            })
            .select('id')
            .single()

          if (movieError || !newMovie) {
            console.error(`Failed to create movie for ${movieTitle}:`, movieError)
            errors.push({ movie_key: key, error: 'Failed to create movie record' })
            continue
          }
          movieId = newMovie.id
        } else {
          console.error(`No movie data for bid ${winner.id}`)
          errors.push({ movie_key: key, error: 'No movie data available' })
          continue
        }

        // Create pickup record
        const { error: pickupError } = await serviceClient.from('pickups').insert({
          league_id: winner.league_id,
          team_id: winner.team_id,
          movie_id: movieId,
          bid_id: winner.id,
          amount_paid: winner.amount,
        })

        if (pickupError) {
          console.error(`Failed to create pickup for ${movieTitle}:`, pickupError)
          errors.push({ movie_key: key, error: 'Failed to create pickup record' })
          continue
        }

        // Deduct from team budget
        const { data: currentBudget, error: budgetFetchError } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget, total_spent')
          .eq('team_id', winner.team_id)
          .single()

        if (budgetFetchError || !currentBudget) {
          console.error(`Failed to fetch budget for team ${winner.team_id}:`, budgetFetchError)
          // Continue anyway - the pickup was created
        } else {
          const { error: budgetUpdateError } = await serviceClient
            .from('team_budgets')
            .update({
              remaining_budget: currentBudget.remaining_budget - winner.amount,
              total_spent: currentBudget.total_spent + winner.amount,
              updated_at: new Date().toISOString(),
            })
            .eq('team_id', winner.team_id)

          if (budgetUpdateError) {
            console.error(`Failed to update budget for team ${winner.team_id}:`, budgetUpdateError)
          }
        }

        // Mark winner as won
        await serviceClient
          .from('pickup_bids')
          .update({ status: 'won' })
          .eq('id', winner.id)

        // Mark all other bids for this movie as lost
        const loserBids = (allBidsForMovie || []).filter((b) => b.id !== winner.id)
        const loserIds = loserBids.map((b) => b.id)

        if (loserIds.length > 0) {
          await serviceClient
            .from('pickup_bids')
            .update({ status: 'lost' })
            .in('id', loserIds)
        }

        // Send notification to winner
        const { data: winnerTeam } = await serviceClient
          .from('teams')
          .select('league_participants(user_id)')
          .eq('id', winner.team_id)
          .single()

        const winnerUserId = (winnerTeam?.league_participants as unknown as { user_id: string })?.user_id

        if (winnerUserId) {
          await serviceClient.from('notifications').insert({
            user_id: winnerUserId,
            league_id: winner.league_id,
            type: 'bid_won',
            title: `You won ${movieTitle}!`,
            body: `Your bid of $${winner.amount} won. ${movieTitle} has been added to your roster.`,
            data: {
              bid_id: winner.id,
              tmdb_id: winner.tmdb_id,
              movie_id: movieId,
              amount: winner.amount,
            },
          })
        }

        // Send notifications to losers
        for (const loserBid of loserBids) {
          const { data: loserTeam } = await serviceClient
            .from('teams')
            .select('league_participants(user_id)')
            .eq('id', loserBid.team_id)
            .single()

          const loserUserId = (loserTeam?.league_participants as unknown as { user_id: string })?.user_id

          if (loserUserId) {
            await serviceClient.from('notifications').insert({
              user_id: loserUserId,
              league_id: loserBid.league_id,
              type: 'bid_lost',
              title: `Bid unsuccessful for ${movieTitle}`,
              body: `Your bid of $${loserBid.amount} was not enough. The winning bid was $${winner.amount}.`,
              data: {
                bid_id: loserBid.id,
                tmdb_id: loserBid.tmdb_id,
                winning_amount: winner.amount,
              },
            })
          }
        }

        results.push({
          tmdb_id: winner.tmdb_id,
          league_id: winner.league_id,
          winner_team_id: winner.team_id,
          amount: winner.amount,
          movie_title: movieTitle,
        })

        console.log(`Processed bid for ${movieTitle}: winner team ${winner.team_id} with $${winner.amount}`)
      } catch (error) {
        console.error(`Error processing bids for ${key}:`, error)
        errors.push({
          movie_key: key,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return jsonResponse({
      message: `Processed ${results.length} movie(s)`,
      mode,
      processed: results.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Unexpected error in process-bids:', error)
    return errorResponse('Internal server error', 500)
  }
})
