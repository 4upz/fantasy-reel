import { assertEquals } from '@std/assert'
import { createClient } from '@supabase/supabase-js'
import { invokeFunction } from '../tests/_setup.ts'

function clientWithResponse(respond: () => Response) {
  let calls = 0
  const client = createClient('http://127.0.0.1:1', 'unit-test-key', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (input) => {
        assertEquals(String(input), 'http://127.0.0.1:1/functions/v1/test-function')
        calls += 1
        return Promise.resolve(respond())
      },
    },
  })
  return { client, calls: () => calls }
}

Deno.test('integration invocation helper preserves actual successful HTTP statuses', async () => {
  for (const status of [200, 201, 204]) {
    const { client, calls } = clientWithResponse(() => status === 204
      ? new Response(null, { status })
      : Response.json({ saved: true }, { status }))
    const result = await invokeFunction(client, 'test-function', { selection: 'fixture' })
    assertEquals(result.status, status)
    assertEquals(result.error, null)
    assertEquals(result.data, status === 204 ? '' : { saved: true })
    assertEquals(calls(), 1)
  }
})

Deno.test('integration invocation helper preserves rejected responses and transport failures', async () => {
  for (const status of [401, 409, 503]) {
    const { client } = clientWithResponse(() => Response.json({ error: 'Rejected fixture' }, { status }))
    assertEquals(await invokeFunction(client, 'test-function'), {
      data: null, error: 'Rejected fixture', status,
    })
  }
  const gateway = clientWithResponse(() => new Response('Worker terminated', { status: 546 }))
  const rejected = await invokeFunction(gateway.client, 'test-function')
  assertEquals(rejected.status, 546)
  assertEquals(rejected.data, null)
  assertEquals(typeof rejected.error, 'string')
  assertEquals(gateway.calls(), 1)

  const { client, calls } = clientWithResponse(() => { throw new TypeError('unit-test network failure') })
  const result = await invokeFunction(client, 'test-function')
  assertEquals(result.status, undefined)
  assertEquals(result.data, null)
  assertEquals(typeof result.error, 'string')
  assertEquals(calls(), 1)
})
