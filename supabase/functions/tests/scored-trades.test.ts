/**
 * Integration tests for the scored-movie trade lock.
 *
 * Once a movie has a score its outcome is known, so it can no longer be traded:
 * proposing or accepting a deal that names it is refused, and process-trades
 * ends any open offer that still does -- unanswered or already agreed.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assert, assertEquals, assertExists } from '@std/assert'
import {
  createTestFactory,
  getEdgeFunctionServiceRoleKey,
  getServiceClient,
  getUserId,
  invokeFunction,
  uniqueName,
} from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const PROCESS_TRADES_URL =
  Deno.env.get('PROCESS_TRADES_URL') || `${SUPABASE_URL}/functions/v1/process-trades`

/** A movie of this file's own, so scoring it cannot disturb the shared draft pool. */
function uniqueLockTestTmdbId(): number {
  return 990_000_000 + Math.floor(Math.random() * 1_000_000)
}

Deno.test({
  name: 'scored movies are locked against trades',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    const leagueId = await factory.createTradingLeague(uniqueName('Scored Trade League'))
    const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)
    const [recipientPick] = await factory.getDraftPicksForUser(leagueId, secondClient)
    assertExists(recipientTeam)
    assertExists(recipientPick)

    const tmdbId = uniqueLockTestTmdbId()
    const title = `Scored Trade Movie ${tmdbId}`
    const pickId = await factory.createDraftPickForUser(leagueId, client, {
      tmdb_id: tmdbId,
      title,
      release_date: '2099-01-01',
    })
    const { data: pick } = await serviceClient.from('draft_picks').select('movie_id').eq('id', pickId).single()
    assertExists(pick)

    const refusal = `"${title}" already has a score, so it can no longer be traded.`

    /** Offer the dedicated movie for one of the recipient's: a one-for-one swap keeps both rosters in bounds. */
    function propose() {
      return invokeFunction<{ trade_offer: { id: string } }>(client, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: recipientTeam!.teamId,
        offered_items: { movies: [{ movie_id: pick!.movie_id, source: 'draft_pick', source_id: pickId }], faab: 0 },
        requested_items: {
          movies: [{ movie_id: recipientPick.movie_id, source: 'draft_pick', source_id: recipientPick.id }],
          faab: 0,
        },
      })
    }

    async function setScore(points: number | null) {
      const { error } = await serviceClient
        .from('movies')
        .update({ fantasy_points: points, combined_score: points === null ? null : 60 + points })
        .eq('id', pick!.movie_id)
      assertEquals(error, null)
    }

    try {
      await t.step('propose-trade refuses a scored movie', async () => {
        await setScore(18)
        const result = await propose()
        assertEquals(result.status, 400)
        assertEquals(result.error, refusal)
        await setScore(null)
      })

      // Two offers on the same movie, both made before it was scored: one still
      // waiting on an answer, one agreed and sitting in review.
      let openOfferId = ''
      let agreedOfferId = ''

      await t.step('respond-trade will not accept an offer once a movie in it is scored', async () => {
        const open = await propose()
        const agreed = await propose()
        assertEquals(open.error, null)
        assertEquals(agreed.error, null)
        openOfferId = open.data!.trade_offer.id
        agreedOfferId = agreed.data!.trade_offer.id

        const { error: reviewError } = await serviceClient
          .from('trade_offers')
          .update({
            status: 'review',
            accepted_at: new Date().toISOString(),
            review_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          })
          .eq('id', agreedOfferId)
        assertEquals(reviewError, null)

        await setScore(-12)

        const result = await invokeFunction(secondClient, 'respond-trade', {
          trade_offer_id: openOfferId,
          response: 'accept',
        })
        assertEquals(result.status, 400)
        assertEquals(result.error, `Trade can no longer be accepted: ${refusal}`)

        const { data: offer } = await serviceClient.from('trade_offers').select('status').eq('id', openOfferId).single()
        assertEquals(offer?.status, 'proposed')
      })

      await t.step('process-trades ends both offers and tells each side why', async () => {
        const response = await fetch(PROCESS_TRADES_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await getEdgeFunctionServiceRoleKey()}`,
            'Content-Type': 'application/json',
          },
        })
        const body = await response.json()
        assertEquals(response.status, 200)
        // Other leagues' offers may be swept by the same run.
        assert(body.expired_by_score >= 2, `expected both offers swept, got ${body.expired_by_score}`)

        const { data: offers } = await serviceClient
          .from('trade_offers')
          .select('id, status, veto_reason, expired_reason')
          .in('id', [openOfferId, agreedOfferId])
        for (const offer of offers ?? []) {
          assertEquals(offer.status, 'expired')
          assertEquals(offer.veto_reason, refusal)
          assertEquals(offer.expired_reason, null)
        }
        assertEquals(offers?.length, 2)

        // Nothing moved.
        const { data: pickAfter } = await serviceClient.from('draft_picks').select('team_id').eq('id', pickId).single()
        const initiatorTeam = await factory.getTeamForUser(leagueId, client)
        assertEquals(pickAfter?.team_id, initiatorTeam?.teamId)

        const notificationsFor = async (offerId: string) => {
          const { data } = await serviceClient
            .from('notifications')
            .select('title, body')
            .eq('user_id', await getUserId(client))
            .eq('data->>trade_offer_id', offerId)
          return data ?? []
        }
        assertEquals(await notificationsFor(openOfferId), [{
          title: 'Trade Offer Expired',
          body: `Your trade offer to ${recipientTeam!.teamName} expired. ${refusal}`,
        }])
        assertEquals(await notificationsFor(agreedOfferId), [{
          title: 'Trade Expired',
          body: `Your trade could not be completed: ${refusal}`,
        }])
      })
    } finally {
      await factory.cleanup()
    }
  },
})
