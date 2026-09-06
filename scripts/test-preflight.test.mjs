import test from 'node:test'
import assert from 'node:assert/strict'
import { localUrl, migrationDifference, checkHttpServices } from './test-preflight.mjs'

test('preflight rejects remote targets and malformed local URLs before using credentials', () => {
  for (const url of ['https://example.com', 'http://localhost.evil.test:54321', 'http://user:pass@localhost:54321', 'http://localhost:54321/path']) {
    assert.throws(() => localUrl(url), /local|origin/)
  }
  assert.equal(localUrl('http://127.0.0.1:54321').port, '54321')
})

test('migration check detects both unapplied files and database-only versions', () => {
  assert.deepEqual(migrationDifference(['1','2'], ['1']), { pending: ['2'], unexpected: [] })
  assert.deepEqual(migrationDifference(['1'], ['1','3']), { pending: [], unexpected: ['3'] })
  assert.deepEqual(migrationDifference(['2','1'], ['1','2']), { pending: [], unexpected: [] })
})

test('REST availability alone cannot pass when the Edge Runtime is unavailable', async () => {
  const request = async (url) => new Response(url.includes('/functions/') ? 'Bad gateway' : '{}', {
    status: url.includes('/functions/') ? 502 : 200,
  })
  await assert.rejects(checkHttpServices({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'public', SERVICE_ROLE_KEY: 'secret' }, request), /Edge Runtime/)
})

test('gateway 401 cannot masquerade as a working function', async () => {
  const request = async (url) => new Response('{}', { status: url.includes('/functions/') ? 401 : 200 })
  await assert.rejects(checkHttpServices({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'public', SERVICE_ROLE_KEY: 'secret' }, request), /Edge Runtime/)
})

test('invalid admin credentials fail before any test can write data', async () => {
  const request = async (url) => new Response('{}', { status: url.includes('/rest/') ? 401 : 200 })
  await assert.rejects(checkHttpServices({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'public', SERVICE_ROLE_KEY: 'secret' }, request), /credentials/)
})

test('valid auth, database credentials and function response pass', async () => {
  const request = async (url) => new Response(url.includes('/functions/') ? '{"error":"Unauthorized"}' : '{}', {
    status: url.includes('/functions/') ? 401 : 200,
    headers: { 'x-request-id': 'preflight' },
  })
  await checkHttpServices({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'public', SERVICE_ROLE_KEY: 'secret' }, request)
})
