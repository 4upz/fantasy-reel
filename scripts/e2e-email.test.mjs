import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, beforeEach, test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../apps/frontend/e2e/helpers/email.helper.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { extractAuthLink } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const email = (body = '', links = [], html = '') => ({ subject: 'Test', body, links, html })

beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:56321' })
after(() => {
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
})

test('recovery links preserve the issuing origin and redirect URL', () => {
  const link = 'http://127.0.0.1:57321/auth/v1/verify?token=fake&type=recovery&redirect_to=http%3A%2F%2Flocalhost%3A3100%2Freset-password'
  const result = new URL(extractAuthLink(email(`Reset password (${link})`), 'reset'))
  assert.equal(result.origin, 'http://127.0.0.1:57321')
  assert.equal(result.pathname, '/auth/v1/verify')
  assert.equal(result.searchParams.get('redirect_to'), 'http://localhost:3100/reset-password')
})

test('HTML query separators are decoded while the full link origin survives', () => {
  const html = '<a href="http://localhost:3100/auth/confirm?token_hash=fake&amp;type=recovery&amp;next=%2Freset-password">Reset password</a>'
  const result = new URL(extractAuthLink(email('', [], html), 'reset'))
  assert.equal(result.origin, 'http://localhost:3100')
  assert.equal(result.searchParams.get('type'), 'recovery')
  assert.equal(result.searchParams.get('next'), '/reset-password')
  assert.equal(result.searchParams.has('amp;type'), false)
})

test('relative recovery links use the configured Supabase instance', () => {
  const result = new URL(extractAuthLink(email('/auth/v1/verify?token=fake&type=recovery'), 'reset'))
  assert.equal(result.origin, 'http://127.0.0.1:56321')
})

test('extracted signup links support reordered query parameters', () => {
  const result = new URL(extractAuthLink(email('', ['https://app.example/auth/confirm?type=signup&token_hash=fake']), 'confirm'))
  assert.equal(result.origin, 'https://app.example')
  assert.equal(result.searchParams.get('type'), 'signup')
})

test('unrelated links and other auth operations are not mistaken for recovery', () => {
  const body = 'https://app.example/privacy https://app.example/auth/confirm?token_hash=fake&type=signup'
  assert.equal(extractAuthLink(email(body), 'reset'), null)
  assert.equal(extractAuthLink(email('', ['javascript:alert(1)']), 'reset'), null)
})

test('invitation URLs preserve the frontend origin', () => {
  const result = new URL(extractAuthLink(email('http://localhost:3100/join?token=fake'), 'invite'))
  assert.equal(result.origin, 'http://localhost:3100')
  assert.equal(result.pathname, '/join')
})
