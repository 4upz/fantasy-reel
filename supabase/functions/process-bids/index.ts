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
// Trigger deploy
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isUpcomingMovie } from '../_shared/utils.ts'
import { sendEmail } from '../_shared/email.ts'
import { getBidWonEmailHtml, getBidWonEmailText } from '../_shared/email-templates/bid-won.ts'
import { getBidLostEmailHtml, getBidLostEmailText } from '../_shared/email-templates/bid-lost.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'

interface ProcessBidsRequest {
  mode?: 'weekly' | 'extended'
  league_id?: string
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

interface CounterpickBid {
  id: string
  league_id: string
  team_id: string
  movie_id: string
  target_team_id: string
  draft_pick_id: string | null
  pickup_id: string | null
  amount: number
  status: string
  created_at: string
  countered_at: string | null
  response_deadline: string | null
  processing_deadline: string
}

interface CounterpickProcessResult {
  movie_id: string
  league_id: string
  winner_team_id: string
  amount: number
  movie_title: string
}

interface BidResultSummary {
  league_id: string
  winner_team_id: string
  amount: number
  movie_title: string
}

// A winning bid that was voided at processing time because the movie released
// while the bid was pending (bids can sit for up to a week - see
// get_next_processing_deadline). Placement-time checks can't catch this since
// the movie may not have released yet when the bid was placed.
interface VoidedBidResult {
  bid_id: string
  league_id: string
  team_id: string
  amount: number
  movie_title: string
  reason: string
  tmdb_id?: number
  movie_id?: string
}

// deno-lint-ignore no-explicit-any
type ServiceClient = ReturnType<typeof createClient<any>>

async function deductTeamBudget(
  serviceClient: ServiceClient,
  teamId: string,
  amount: number,
): Promise<void> {
  const { data: currentBudget, error: budgetFetchError } = await serviceClient
    .from('team_budgets')
    .select('remaining_budget, total_spent')
    .eq('team_id', teamId)
    .single()

  if (budgetFetchError || !currentBudget) {
    console.error(`Failed to fetch budget for team ${teamId}:`, budgetFetchError)
    return
  }

  const { error: budgetUpdateError } = await serviceClient
    .from('team_budgets')
    .update({
      remaining_budget: currentBudget.remaining_budget - amount,
      total_spent: currentBudget.total_spent + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('team_id', teamId)

  if (budgetUpdateError) {
    console.error(`Failed to update budget for team ${teamId}:`, budgetUpdateError)
  }
}

/**
 * Notify a team's owner that their winning bid was voided at processing time
 * because the movie released while the bid was pending. Mirrors the
 * team -> league_participants -> user_id lookup used for win/loss notifications
 * below, reusing the 'bid_lost' notification type since no dedicated type
 * exists for this case.
 */
async function notifyVoidedBidder(
  serviceClient: ServiceClient,
  bid: { id: string; league_id: string; team_id: string; amount: number },
  movieTitle: string,
  reason: string,
  extraData: Record<string, unknown>,
): Promise<void> {
  const { data: bidderTeam } = await serviceClient
    .from('teams')
    .select('league_participants(user_id)')
    .eq('id', bid.team_id)
    .single()

  const bidderUserId = (bidderTeam?.league_participants as unknown as { user_id: string })?.user_id
  if (!bidderUserId) return

  await serviceClient.from('notifications').insert({
    user_id: bidderUserId,
    league_id: bid.league_id,
    type: 'bid_lost',
    title: `Bid cancelled for ${movieTitle}`,
    body: `${movieTitle} was released before your bid of $${bid.amount} could be processed. Your bid was cancelled and your budget was not charged.`,
    data: {
      bid_id: bid.id,
      amount: bid.amount,
      reason: 'movie_released',
      release_check_reason: reason,
      ...extraData,
    },
  })
}

async function sendBidResultsDiscordNotifications(
  serviceClient: ServiceClient,
  results: BidResultSummary[],
  embedTitle: string,
  itemLabel: string,
  fieldPrefix: string,
): Promise<void> {
  if (results.length === 0) return

  const resultsByLeague = new Map<string, BidResultSummary[]>()
  for (const result of results) {
    const existing = resultsByLeague.get(result.league_id) ?? []
    existing.push(result)
    resultsByLeague.set(result.league_id, existing)
  }

  const allTeamIds = [...new Set(results.map((r) => r.winner_team_id))]
  const allLeagueIds = [...resultsByLeague.keys()]

  const [{ data: teamsData }, { data: leaguesData }] = await Promise.all([
    serviceClient.from('teams').select('id, name').in('id', allTeamIds),
    serviceClient.from('leagues').select('id, name').in('id', allLeagueIds),
  ])

  const teamNameMap = new Map<string, string>()
  for (const t of teamsData ?? []) teamNameMap.set(t.id, t.name)

  const leagueNameMap = new Map<string, string>()
  for (const l of leaguesData ?? []) leagueNameMap.set(l.id, l.name)

  const discordPromises: Promise<void>[] = []
  for (const [leagueId, leagueResults] of resultsByLeague) {
    const leagueName = leagueNameMap.get(leagueId) ?? 'League'

    const fields = leagueResults.slice(0, 10).map((r) => ({
      name: r.movie_title,
      value: `${fieldPrefix} **${teamNameMap.get(r.winner_team_id) ?? 'A team'}** for $${r.amount}`,
      inline: true,
    }))

    discordPromises.push(
      sendDiscordNotification(serviceClient, {
        leagueId,
        category: 'bids',
        mentionRole: true,
        embeds: [{
          author: buildEmbedAuthor(leagueName, leagueId),
          title: embedTitle,
          description: `${leagueResults.length} ${itemLabel}${leagueResults.length === 1 ? '' : 's'} awarded`,
          fields,
          color: DISCORD_COLORS.green,
          footer: { text: leagueName },
          url: buildLeagueUrl(leagueId, '/bidding'),
        }],
      })
    )
  }

  await Promise.allSettled(discordPromises)
}

interface NotificationSummary {
  leagues_attempted: string[]
  channels_notified: number
  channels_queried: number
}

async function sendNoBidsDiscordNotifications(
  serviceClient: ServiceClient,
  excludeLeagueIds = new Set<string>(),
  targetLeagueId?: string
): Promise<NotificationSummary> {
  const summary: NotificationSummary = {
    leagues_attempted: [],
    channels_notified: 0,
    channels_queried: 0,
  }

  try {
    let query = serviceClient
      .from('discord_channels')
      .select('league_id')
      .eq('enabled', true)
      .eq('notify_bids', true)

    if (targetLeagueId) {
      query = query.eq('league_id', targetLeagueId)
    }

    const { data: allChannels, error: channelsError } = await query

    if (channelsError) {
      console.error('Error fetching discord channels:', channelsError)
      return summary
    }

    if (!allChannels || allChannels.length === 0) {
      console.log(`[process-bids] No enabled discord channels found for notify_bids`)
      return summary
    }

    summary.channels_queried = allChannels.length

    const activeLeagueIds = [...new Set(allChannels.map(ch => (ch as { league_id: string }).league_id))]
    const leaguesWithNoBids = activeLeagueIds.filter(id => !excludeLeagueIds.has(id))

    summary.leagues_attempted = leaguesWithNoBids

    // Count how many channels will be notified
    const { count } = await serviceClient
      .from('discord_channels')
      .select('*', { count: 'exact', head: true })
      .in('league_id', leaguesWithNoBids)
      .eq('enabled', true)
      .eq('notify_bids', true)
    
    summary.channels_notified = count ?? 0

    const noBidsPromises = leaguesWithNoBids.map(async (leagueId) => {
      const leagueName = await getLeagueName(serviceClient, leagueId)
      return sendDiscordNotification(serviceClient, {
        leagueId,
        category: 'bids',
        embeds: [{
          author: buildEmbedAuthor(leagueName, leagueId),
          title: 'Bidding Results',
          description: 'Bidding has concluded for this week. No bids were placed.',
          color: DISCORD_COLORS.blue,
          footer: { text: leagueName },
          url: buildLeagueUrl(leagueId, '/bidding'),
        }]
      })
    })

    await Promise.allSettled(noBidsPromises)
  } catch (err) {
    console.error('Failed to send "no bids" notifications:', err)
  }

  return summary
}


Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Authenticate requests using either the X-Cron-Secret header or the Service Role key
    const cronSecret = Deno.env.get('CRON_SECRET')
    const providedSecret = req.headers.get('X-Cron-Secret')
    const authHeader = req.headers.get('Authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    let isAuthenticated = false

    // 1. Check if X-Cron-Secret matches CRON_SECRET (if configured)
    if (cronSecret && providedSecret === cronSecret) {
      isAuthenticated = true
    }

    // 2. Check if Authorization Bearer matches SUPABASE_SERVICE_ROLE_KEY
    if (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthenticated = true
    }

    if (!isAuthenticated) {
      return errorResponse('Forbidden', 403)
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { mode = 'weekly', league_id }: ProcessBidsRequest = await req.json().catch(() => ({ mode: 'weekly' }))

    if (mode !== 'weekly' && mode !== 'extended') {
      return errorResponse('Mode must be "weekly" or "extended"', 400)
    }

    const now = new Date()
    let bidsToProcess: PickupBid[]

    if (mode === 'weekly') {
      // Weekly: process active bids where processing_deadline <= now
      let query = serviceClient
        .from('pickup_bids')
        .select('*')
        .eq('status', 'active')
        .lte('processing_deadline', now.toISOString())

      if (league_id) {
        query = query.eq('league_id', league_id)
      }

      const { data, error } = await query

      if (error) {
        console.error('Failed to fetch weekly bids:', error)
        return errorResponse('Failed to fetch bids', 500)
      }
      bidsToProcess = data || []
    } else {
      // Extended: find active bids where response_deadline has passed
      // These are bids in extended time due to counter-bidding
      let query = serviceClient
        .from('pickup_bids')
        .select('*')
        .eq('status', 'active')
        .not('response_deadline', 'is', null)
        .lt('response_deadline', now.toISOString())

      if (league_id) {
        query = query.eq('league_id', league_id)
      }

      const { data, error } = await query

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
      let notificationSummary: NotificationSummary | undefined
      if (mode === 'weekly') {
        notificationSummary = await sendNoBidsDiscordNotifications(serviceClient, new Set(), league_id)
      }
      return jsonResponse({
        message: 'No bids to process',
        mode,
        processed: 0,
        results: [],
        notifications: notificationSummary,
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
    const voidedPickupResults: VoidedBidResult[] = []

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
        let movieReleaseDate: string | null
        const { data: existingMovie } = await serviceClient
          .from('movies')
          .select('id, release_date')
          .eq('tmdb_id', winner.tmdb_id)
          .single()

        if (existingMovie) {
          movieId = existingMovie.id
          movieReleaseDate = existingMovie.release_date
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
            .select('id, release_date')
            .single()

          if (movieError || !newMovie) {
            console.error(`Failed to create movie for ${movieTitle}:`, movieError)
            errors.push({ movie_key: key, error: 'Failed to create movie record' })
            continue
          }
          movieId = newMovie.id
          movieReleaseDate = newMovie.release_date
        } else {
          console.error(`No movie data for bid ${winner.id}`)
          errors.push({ movie_key: key, error: 'No movie data available' })
          continue
        }

        // Revalidate release date against the authoritative movies row. Bids can
        // sit pending for up to a week (see get_next_processing_deadline), so a
        // movie that was upcoming when the bid was placed may have released by
        // now. This recheck is authoritative for any movie that already had a
        // `movies` row. For a movie first seen at processing time (no prior row),
        // the row above was just created from the same client-supplied movie_data
        // that came with the bid, so this only re-validates that data against
        // itself - it does not independently verify it. Closing that gap would
        // need a TMDb round-trip at movie-creation time (draft-pick has the same
        // trust model); out of scope here.
        const releaseCheck = isUpcomingMovie(movieReleaseDate)
        if (!releaseCheck.valid) {
          const reason = releaseCheck.reason ?? 'Movie has already been released'

          // The movie has released, so no bid on it - winner or otherwise - can
          // ever be honored. Void the entire group, not just the winner, or the
          // losing bids strand as 'active' forever (they'd only surface again if
          // some other bid on the same released movie were ever re-evaluated).
          const bidsToVoid = allBidsForMovie || []
          const bidIdsToVoid = bidsToVoid.map((b) => b.id)

          await serviceClient
            .from('pickup_bids')
            .update({ status: 'cancelled' })
            .in('id', bidIdsToVoid)

          for (const bid of bidsToVoid) {
            await notifyVoidedBidder(serviceClient, bid, movieTitle, reason, {
              tmdb_id: bid.tmdb_id,
              movie_id: movieId,
            })

            voidedPickupResults.push({
              bid_id: bid.id,
              league_id: bid.league_id,
              team_id: bid.team_id,
              amount: bid.amount,
              movie_title: movieTitle,
              reason,
              tmdb_id: bid.tmdb_id,
              movie_id: movieId,
            })
          }

          console.log(`Voided ${bidIdsToVoid.length} pickup bid(s) for ${movieTitle}: movie released before processing`)
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

        await deductTeamBudget(serviceClient, winner.team_id, winner.amount)

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

          // Send email to winner
          const [{ data: winnerProfile }, { data: winnerUserData }] = await Promise.all([
            serviceClient
              .from('profiles')
              .select('display_name')
              .eq('user_id', winnerUserId)
              .single(),
            serviceClient.auth.admin.getUserById(winnerUserId)
          ])

          const winnerEmail = winnerUserData?.user?.email
          if (winnerEmail) {
            const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
            sendEmail({
              to: winnerEmail,
              subject: `You won ${movieTitle}!`,
              html: getBidWonEmailHtml({
                recipientName: winnerProfile?.display_name || 'Fantasy Manager',
                movieTitle,
                winningAmount: winner.amount,
                leagueUrl: `${baseUrl}/league/${winner.league_id}`,
              }),
              text: getBidWonEmailText({
                recipientName: winnerProfile?.display_name || 'Fantasy Manager',
                movieTitle,
                winningAmount: winner.amount,
                leagueUrl: `${baseUrl}/league/${winner.league_id}`,
              }),
            }).catch(err => console.error('Failed to send bid won email:', err))
          }
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

            // Send email to loser
            const [{ data: loserProfile }, { data: loserUserData }] = await Promise.all([
              serviceClient
                .from('profiles')
                .select('display_name')
                .eq('user_id', loserUserId)
                .single(),
              serviceClient.auth.admin.getUserById(loserUserId)
            ])

            const loserEmail = loserUserData?.user?.email
            if (loserEmail) {
              const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
              sendEmail({
                to: loserEmail,
                subject: `Bid unsuccessful for ${movieTitle}`,
                html: getBidLostEmailHtml({
                  recipientName: loserProfile?.display_name || 'Fantasy Manager',
                  movieTitle,
                  yourBidAmount: loserBid.amount,
                  winningAmount: winner.amount,
                  leagueUrl: `${baseUrl}/league/${loserBid.league_id}`,
                }),
                text: getBidLostEmailText({
                  recipientName: loserProfile?.display_name || 'Fantasy Manager',
                  movieTitle,
                  yourBidAmount: loserBid.amount,
                  winningAmount: winner.amount,
                  leagueUrl: `${baseUrl}/league/${loserBid.league_id}`,
                }),
              }).catch(err => console.error('Failed to send bid lost email:', err))
            }
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

    // ========================================================================
    // COUNTERPICK BID PROCESSING
    // Process counterpick bids after pickup bids
    // ========================================================================

    let counterpickBidsToProcess: CounterpickBid[]

    if (mode === 'weekly') {
      let query = serviceClient
        .from('counterpick_bids')
        .select('*')
        .eq('status', 'active')
        .lte('processing_deadline', now.toISOString())

      if (league_id) {
        query = query.eq('league_id', league_id)
      }

      const { data, error } = await query

      if (error) {
        console.error('Failed to fetch weekly counterpick bids:', error)
        // Continue with pickup results even if counterpick fetch fails
        counterpickBidsToProcess = []
      } else {
        counterpickBidsToProcess = data || []
      }
    } else {
      let query = serviceClient
        .from('counterpick_bids')
        .select('*')
        .eq('status', 'active')
        .not('response_deadline', 'is', null)
        .lt('response_deadline', now.toISOString())

      if (league_id) {
        query = query.eq('league_id', league_id)
      }

      const { data, error } = await query

      if (error) {
        console.error('Failed to fetch extended counterpick bids:', error)
        counterpickBidsToProcess = []
      } else {
        // Filter to only those in extended time
        counterpickBidsToProcess = (data || []).filter(
          (bid) => new Date(bid.response_deadline!) > new Date(bid.processing_deadline)
        )
      }
    }

    const counterpickResults: CounterpickProcessResult[] = []
    const voidedCounterpickResults: VoidedBidResult[] = []

    if (counterpickBidsToProcess.length > 0) {
      // Group counterpick bids by movie (league_id:movie_id)
      const cpBidsByMovie = new Map<string, CounterpickBid[]>()
      for (const bid of counterpickBidsToProcess) {
        const key = `${bid.league_id}:${bid.movie_id}`
        if (!cpBidsByMovie.has(key)) {
          cpBidsByMovie.set(key, [])
        }
        cpBidsByMovie.get(key)!.push(bid)
      }

      for (const [key, bids] of cpBidsByMovie) {
        const [leagueId, movieId] = key.split(':')

        try {
          // Check if any bids for this movie still have open response windows
          const { data: allBidsForMovie } = await serviceClient
            .from('counterpick_bids')
            .select('*')
            .eq('league_id', leagueId)
            .eq('movie_id', movieId)
            .in('status', ['active', 'outbid'])

          const hasOpenWindow = (allBidsForMovie || []).some(
            (bid) => bid.response_deadline && new Date(bid.response_deadline) > now
          )

          if (hasOpenWindow) {
            continue
          }

          // Find active bids only
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

          // Get movie title, fantasy_points, and release_date from movies table
          const { data: movie, error: movieError } = await serviceClient
            .from('movies')
            .select('id, title, fantasy_points, release_date')
            .eq('id', movieId)
            .single()

          if (movieError || !movie) {
            console.error(`Movie not found for counterpick bid: ${movieId}`)
            errors.push({ movie_key: key, error: 'Movie not found for counterpick bid' })
            continue
          }

          const movieTitle = movie.title || `Movie ${movieId}`

          // Revalidate release date against the authoritative movies row - same
          // rationale as the pickup path above.
          const releaseCheck = isUpcomingMovie(movie.release_date)
          if (!releaseCheck.valid) {
            const reason = releaseCheck.reason ?? 'Movie has already been released'

            // Same rationale as the pickup path above: once the target movie has
            // released, no bid in this group can ever be honored, so void all of
            // them rather than leaving the losers stranded as 'active'.
            const bidsToVoid = allBidsForMovie || []
            const bidIdsToVoid = bidsToVoid.map((b) => b.id)

            await serviceClient
              .from('counterpick_bids')
              .update({ status: 'cancelled' })
              .in('id', bidIdsToVoid)

            for (const bid of bidsToVoid) {
              await notifyVoidedBidder(serviceClient, bid, movieTitle, reason, {
                movie_id: movieId,
                bid_type: 'counterpick',
              })

              voidedCounterpickResults.push({
                bid_id: bid.id,
                league_id: bid.league_id,
                team_id: bid.team_id,
                amount: bid.amount,
                movie_title: movieTitle,
                reason,
                movie_id: movieId,
              })
            }

            console.log(`Voided ${bidIdsToVoid.length} counterpick bid(s) for ${movieTitle}: movie released before processing`)
            continue
          }

          // Get pick_order: count existing counterpicks for this league with phase='bidding', add 1
          const { count: existingPickOrderCount } = await serviceClient
            .from('counterpicks')
            .select('*', { count: 'exact', head: true })
            .eq('league_id', leagueId)
            .eq('phase', 'bidding')

          const pickOrder = (existingPickOrderCount ?? 0) + 1

          // Create counterpick record. The winning bid carries exactly one of
          // draft_pick_id / pickup_id (see counterpick_bids_exactly_one_source
          // check constraint) depending on how the target movie was acquired -
          // set the matching column here, leaving the other null.
          const { error: counterpickError } = await serviceClient
            .from('counterpicks')
            .insert({
              league_id: leagueId,
              counterpicker_team_id: winner.team_id,
              target_team_id: winner.target_team_id,
              movie_id: winner.movie_id,
              draft_pick_id: winner.draft_pick_id,
              pickup_id: winner.pickup_id,
              pick_order: pickOrder,
              phase: 'bidding',
              fantasy_points: movie.fantasy_points != null ? -movie.fantasy_points : null,
            })

          if (counterpickError) {
            console.error(`Failed to create counterpick for ${movieTitle}:`, counterpickError)
            errors.push({ movie_key: key, error: 'Failed to create counterpick record' })
            continue
          }

          // Flag the source record (draft pick or pickup) as counterpicked
          const sourceTable = winner.draft_pick_id ? 'draft_picks' : 'pickups'
          const sourceId = winner.draft_pick_id ?? winner.pickup_id
          await serviceClient
            .from(sourceTable)
            .update({ counterpicked_by_team_id: winner.team_id })
            .eq('id', sourceId)

          await deductTeamBudget(serviceClient, winner.team_id, winner.amount)

          // Mark winner as won
          await serviceClient
            .from('counterpick_bids')
            .update({ status: 'won' })
            .eq('id', winner.id)

          // Mark all other bids for this movie as lost
          const loserBids = (allBidsForMovie || []).filter((b) => b.id !== winner.id)
          const loserIds = loserBids.map((b) => b.id)

          if (loserIds.length > 0) {
            await serviceClient
              .from('counterpick_bids')
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
              title: `Counterpick won: ${movieTitle}!`,
              body: `Your bid of $${winner.amount} won the counterpick on ${movieTitle}.`,
              data: {
                bid_id: winner.id,
                movie_id: movieId,
                amount: winner.amount,
                bid_type: 'counterpick',
              },
            })

            // Send email to winner
            const [{ data: winnerProfile }, { data: winnerUserData }] = await Promise.all([
              serviceClient.from('profiles').select('display_name').eq('user_id', winnerUserId).single(),
              serviceClient.auth.admin.getUserById(winnerUserId),
            ])

            const winnerEmail = winnerUserData?.user?.email
            if (winnerEmail) {
              const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
              sendEmail({
                to: winnerEmail,
                subject: `Counterpick won: ${movieTitle}!`,
                html: getBidWonEmailHtml({
                  recipientName: winnerProfile?.display_name || 'Fantasy Manager',
                  movieTitle: `${movieTitle} (counterpick)`,
                  winningAmount: winner.amount,
                  leagueUrl: `${baseUrl}/league/${winner.league_id}`,
                }),
                text: getBidWonEmailText({
                  recipientName: winnerProfile?.display_name || 'Fantasy Manager',
                  movieTitle: `${movieTitle} (counterpick)`,
                  winningAmount: winner.amount,
                  leagueUrl: `${baseUrl}/league/${winner.league_id}`,
                }),
              }).catch(err => console.error('Failed to send counterpick bid won email:', err))
            }
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
                title: `Counterpick bid unsuccessful for ${movieTitle}`,
                body: `Your bid of $${loserBid.amount} was not enough. The winning bid was $${winner.amount}.`,
                data: {
                  bid_id: loserBid.id,
                  movie_id: movieId,
                  winning_amount: winner.amount,
                  bid_type: 'counterpick',
                },
              })

              // Send email to loser
              const [{ data: loserProfile }, { data: loserUserData }] = await Promise.all([
                serviceClient.from('profiles').select('display_name').eq('user_id', loserUserId).single(),
                serviceClient.auth.admin.getUserById(loserUserId),
              ])

              const loserEmail = loserUserData?.user?.email
              if (loserEmail) {
                const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
                sendEmail({
                  to: loserEmail,
                  subject: `Counterpick bid unsuccessful for ${movieTitle}`,
                  html: getBidLostEmailHtml({
                    recipientName: loserProfile?.display_name || 'Fantasy Manager',
                    movieTitle: `${movieTitle} (counterpick)`,
                    yourBidAmount: loserBid.amount,
                    winningAmount: winner.amount,
                    leagueUrl: `${baseUrl}/league/${loserBid.league_id}`,
                  }),
                  text: getBidLostEmailText({
                    recipientName: loserProfile?.display_name || 'Fantasy Manager',
                    movieTitle: `${movieTitle} (counterpick)`,
                    yourBidAmount: loserBid.amount,
                    winningAmount: winner.amount,
                    leagueUrl: `${baseUrl}/league/${loserBid.league_id}`,
                  }),
                }).catch(err => console.error('Failed to send counterpick bid lost email:', err))
              }
            }
          }

          counterpickResults.push({
            movie_id: winner.movie_id,
            league_id: winner.league_id,
            winner_team_id: winner.team_id,
            amount: winner.amount,
            movie_title: movieTitle,
          })

          console.log(`Processed counterpick bid for ${movieTitle}: winner team ${winner.team_id} with $${winner.amount}`)
        } catch (error) {
          console.error(`Error processing counterpick bids for ${key}:`, error)
          errors.push({
            movie_key: key,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }

    await sendBidResultsDiscordNotifications(serviceClient, results, 'Bidding Results', 'movie', 'Won by')
    await sendBidResultsDiscordNotifications(serviceClient, counterpickResults, 'Counterpick Bidding Results', 'counterpick', 'Counterpicked by')

    // If weekly run, check for leagues with no bids to send "no bids placed" notification
    let notificationSummary: NotificationSummary | undefined
    if (mode === 'weekly') {
      const leaguesWithBids = new Set([
        ...results.map(r => r.league_id),
        ...counterpickResults.map(cr => cr.league_id)
      ])
      notificationSummary = await sendNoBidsDiscordNotifications(serviceClient, leaguesWithBids, league_id)
    }

    const voidedCount = voidedPickupResults.length + voidedCounterpickResults.length
    const message = voidedCount > 0
      ? `Processed ${results.length} pickup(s) and ${counterpickResults.length} counterpick(s); voided ${voidedCount} bid(s) for movies that released before processing`
      : `Processed ${results.length} pickup(s) and ${counterpickResults.length} counterpick(s)`

    return jsonResponse({
      message,
      mode,
      processed: results.length,
      results,
      counterpick_processed: counterpickResults.length,
      counterpick_results: counterpickResults,
      voided_pickup_bids: voidedPickupResults.length > 0 ? voidedPickupResults : undefined,
      voided_counterpick_bids: voidedCounterpickResults.length > 0 ? voidedCounterpickResults : undefined,
      errors: errors.length > 0 ? errors : undefined,
      notifications: notificationSummary,
    })
  } catch (error) {
    console.error('Unexpected error in process-bids:', error)
    return errorResponse('Internal server error', 500)
  }
})
