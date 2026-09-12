// Qualify an isolated stack before running expensive integration suites.
// Deliberately refuses hosted resources and never prints credentials/responses.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  assert.ok(url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
    'The health probe requires an isolated loopback Supabase URL')
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  assert.ok(anonKey && serviceKey, 'Both keys must come from the same test stack')
  const options = {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  }
  const admin = createClient(url, serviceKey, options)
  const user = createClient(url, anonKey, options)
  const email = `draft-health-${randomUUID()}@fantasyreel.test`
  const password = `Health-${randomUUID()}!`
  const userId = randomUUID()
  let creationAttempted = false
  let channel

  function checked(result, label) {
    assert.equal(result.error, null, `${label}: ${result.error?.code ?? result.error?.status ?? 'unknown error'}`)
    return result.data
  }
  async function edge(token, expectedStatus) {
    const started = performance.now()
    const response = await fetch(`${url}/functions/v1/get-leagues`, {
      method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(15000),
    })
    assert.equal(response.status, expectedStatus, 'get-leagues HTTP contract')
    assert.ok(response.headers.get('x-request-id'), 'Edge response has a request ID')
    const body = await response.json()
    if (expectedStatus === 200) assert.deepEqual(body.leagues, [], 'New user sees no other leagues')
    console.log(`get-leagues ${expectedStatus}: ${Math.round(performance.now() - started)}ms`)
  }

  try {
    const health = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey }, signal: AbortSignal.timeout(15000),
    })
    assert.equal(health.status, 200, 'Auth health')
    await health.arrayBuffer()
    for (const table of ['leagues', 'draft_submissions', 'draft_notification_outbox']) {
      checked(await admin.from(table).select('*', { head: true }).limit(1), `Schema: ${table}`)
    }
    creationAttempted = true
    checked(await admin.auth.admin.createUser({ id: userId, email, password, email_confirm: true }), 'Create health user')
    const session = checked(await user.auth.signInWithPassword({ email, password }), 'Real password sign-in').session
    await edge(anonKey, 401)
    await edge(session.access_token, 200)
    const refreshed = checked(await user.auth.refreshSession(), 'Real token refresh').session
    await edge(refreshed.access_token, 200)
    await user.realtime.setAuth(refreshed.access_token)
    channel = user.channel(`draft-health-${randomUUID()}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'leagues',
    }, () => {})
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime subscription exceeded 15 seconds')), 15000)
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer); reject(new Error(`Realtime ${status}`))
        }
      })
    })
    console.log('Healthy: schema, service key, Auth, RLS/Edge, token refresh, Realtime subscription')
  } finally {
    try {
      if (channel) await user.removeChannel(channel)
    } finally {
      user.realtime.disconnect()
      if (creationAttempted) {
        const result = await admin.auth.admin.deleteUser(userId)
        if (result.error?.status !== 404) checked(result, 'Delete health user')
      }
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
