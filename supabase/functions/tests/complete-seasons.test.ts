/**
 * Integration tests for the complete-seasons Edge Function.
 *
 * Tests the actual function via direct fetch() with service role auth,
 * mirroring tests/release-day-announcements.test.ts (custom cron-secret /
 * service-role auth, not a Supabase user JWT).
 *
 * Requires: npx supabase start && npx supabase functions serve
 *
 * NOTE ON SHARED STATE: this cron acts on every overdue league in the
 * database, not just the ones created here. Assertions are therefore made on
 * the specific league rows this test creates, never on the run's global
 * counters -- another test's leftover league would otherwise make them
 * flap. It also means running this suite can close an unrelated abandoned
 * league whose season_end has passed, which is the correct behaviour and not
 * something to guard against.
 */

import { assertEquals, assertExists } from '@std/assert'
import {
  getServiceClient,
  getEdgeFunctionServiceRoleKey,
  createTestFactory,
  uniqueName,
} from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/complete-seasons`

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dateOnly(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * MS_PER_DAY).toISOString().slice(0, 10)
}

Deno.test({
  name: 'complete-seasons',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()
    const { factory } = await createTestFactory()

    async function call(headers: Record<string, string>) {
      const response = await fetch(FUNCTION_URL, { method: 'POST', headers })
      const data = await response.json()
      return { status: response.status, data }
    }

    function authHeaders(): Record<string, string> {
      return { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
    }

    try {
      await t.step('returns 403 with no auth headers', async () => {
        const { status, data } = await call({ 'Content-Type': 'application/json' })
        assertEquals(status, 403)
        assertEquals(data.error, 'Forbidden')
      })

      await t.step('returns 403 with an invalid Bearer token', async () => {
        const { status } = await call({ Authorization: 'Bearer nope', 'Content-Type': 'application/json' })
        assertEquals(status, 403)
      })

      await t.step('succeeds with the service role key and reports a job status', async () => {
        const { status, data } = await call(authHeaders())
        assertEquals(status, 200)
        assertExists(data.seasons_completed)
        assertExists(data.reminders_sent)
        assertEquals(data.job_status, 'ok')
      })

      await t.step('ends a season whose end date has passed, and only once', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('season-overdue'))

        await serviceClient
          .from('leagues')
          .update({ season_end: dateOnly(-1) })
          .eq('id', leagueId)

        const { status } = await call(authHeaders())
        assertEquals(status, 200)

        const { data: league } = await serviceClient
          .from('leagues')
          .select('status, completed_at, winner_team_ids, final_standings')
          .eq('id', leagueId)
          .single()

        assertEquals(league?.status, 'completed')
        assertExists(league?.completed_at)
        assertExists(league?.winner_team_ids)
        assertExists(league?.final_standings)
        // Every team starts on zero points, so the whole league ties at rank 1
        // and every one of them is a co-champion. That is the intended reading
        // of a tie, and it also proves winner_team_ids is not just "first row".
        const { count: teamCount } = await serviceClient
          .from('league_participants')
          .select('teams(id)', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('status', 'active')
        assertEquals((league?.winner_team_ids as string[]).length, teamCount)

        // Everyone was told, once.
        const { data: notifications } = await serviceClient
          .from('notifications')
          .select('id, type, user_id')
          .eq('league_id', leagueId)
          .eq('type', 'season_completed')

        assertEquals(notifications?.length, teamCount)

        // The history UIs read the frozen standings straight off series_seasons
        // rather than following up with a per-season query.
        const { data: seasonRow } = await serviceClient
          .from('series_seasons')
          .select('final_standings, winner_team_ids, status')
          .eq('league_id', leagueId)
          .single()
        assertEquals(seasonRow?.status, 'completed')
        assertExists(seasonRow?.final_standings)
        assertEquals(
          (seasonRow?.final_standings as Array<{ display_name: string | null }>).length,
          teamCount
        )

        const completedAt = league?.completed_at

        // A second run must not re-complete or re-announce: the season is no
        // longer active, so it is not even a candidate.
        await call(authHeaders())

        const { data: after } = await serviceClient
          .from('leagues')
          .select('completed_at')
          .eq('id', leagueId)
          .single()
        assertEquals(after?.completed_at, completedAt)

        const { count: notificationCount } = await serviceClient
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('type', 'season_completed')
        assertEquals(notificationCount, teamCount)
      })

      await t.step('warns a season ending in seven days, exactly once', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('season-soon'))

        await serviceClient
          .from('leagues')
          .update({ season_end: dateOnly(7) })
          .eq('id', leagueId)

        await call(authHeaders())

        // Keyed on the date being warned about, so moving season_end earns a
        // fresh warning rather than being swallowed by the old one.
        const reminderType = `season_end_reminder:${dateOnly(7)}`

        const { data: firstLog } = await serviceClient
          .from('discord_notification_log')
          .select('id, movie_id, notification_type')
          .eq('league_id', leagueId)
          .eq('notification_type', reminderType)

        assertEquals(firstLog?.length, 1)
        assertEquals(firstLog?.[0].movie_id, null)

        // The partial unique index is what makes the rerun a no-op.
        await call(authHeaders())

        const { count } = await serviceClient
          .from('discord_notification_log')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('notification_type', reminderType)
        assertEquals(count, 1)

        // Still active -- a reminder is not a completion.
        const { data: league } = await serviceClient
          .from('leagues')
          .select('status')
          .eq('id', leagueId)
          .single()
        assertEquals(league?.status, 'active')
      })
    } finally {
      await factory.cleanup()
    }
  },
})
