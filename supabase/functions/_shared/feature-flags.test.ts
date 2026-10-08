import { assertEquals } from '@std/assert'
import { getFlag, clearFlagCache, flagAllowsSeries, flagNumber, type FlagClient } from './feature-flags.ts'

function clientReturning(rows: Record<string, { enabled: boolean; config: Record<string, unknown> }>) {
  let selects = 0
  const client: FlagClient = {
    from: () => ({
      select: () => ({
        eq: (_col: string, key: unknown) => ({
          maybeSingle: () => {
            selects++
            const row = rows[key as string]
            return Promise.resolve({ data: row ? { key, ...row } : null, error: null })
          },
        }),
      }),
    }),
  }
  return { client, selects: () => selects }
}

Deno.test('feature-flags', async (t) => {
  await t.step('missing row reads as disabled with empty config', async () => {
    clearFlagCache()
    const { client } = clientReturning({})
    const flag = await getFlag(client, 'nope')
    assertEquals(flag, { enabled: false, config: {} })
  })

  await t.step('returns the row and memoizes for 60s', async () => {
    clearFlagCache()
    let now = 1_000_000
    const { client, selects } = clientReturning({ projections_ingestion: { enabled: true, config: { per_run_cap: 5 } } })
    const first = await getFlag(client, 'projections_ingestion', { now: () => now })
    assertEquals(first.enabled, true)
    now += 30_000
    await getFlag(client, 'projections_ingestion', { now: () => now })
    assertEquals(selects(), 1)
    now += 31_000
    await getFlag(client, 'projections_ingestion', { now: () => now })
    assertEquals(selects(), 2)
  })

  await t.step('a query error reads as disabled and is not cached', async () => {
    clearFlagCache()
    let calls = 0
    const client: FlagClient = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => { calls++; return Promise.resolve({ data: null, error: { message: 'boom' } }) } }) }) }),
    }
    assertEquals((await getFlag(client, 'x')).enabled, false)
    await getFlag(client, 'x')
    assertEquals(calls, 2)
  })

  await t.step('flagNumber falls back on missing or non-numeric config', () => {
    assertEquals(flagNumber({ enabled: true, config: { a: 7 } }, 'a', 1), 7)
    assertEquals(flagNumber({ enabled: true, config: { a: 'x' } }, 'a', 1), 1)
    assertEquals(flagNumber({ enabled: true, config: {} }, 'a', 1), 1)
  })

  await t.step('flagAllowsSeries requires enabled and, when present, a listed series', () => {
    const series = '86de1055-23a7-4cf3-be5c-5806d029dabe'
    const other = '00000000-0000-0000-0000-000000000002'
    const listed = { series_ids: [series] }
    assertEquals(flagAllowsSeries({ enabled: false, config: listed }, series), false)
    assertEquals(flagAllowsSeries({ enabled: true, config: listed }, series), true)
    assertEquals(flagAllowsSeries({ enabled: true, config: listed }, other), false)
    assertEquals(flagAllowsSeries({ enabled: true, config: listed }, null), false)
    // No allowlist means every series.
    assertEquals(flagAllowsSeries({ enabled: true, config: {} }, other), true)
    assertEquals(flagAllowsSeries({ enabled: true, config: {} }, null), true)
    assertEquals(flagAllowsSeries({ enabled: false, config: {} }, other), false)
    // A malformed or empty allowlist fails closed rather than opening to everyone.
    assertEquals(flagAllowsSeries({ enabled: true, config: { series_ids: series } }, series), false)
    assertEquals(flagAllowsSeries({ enabled: true, config: { series_ids: [] } }, series), false)
  })
})
