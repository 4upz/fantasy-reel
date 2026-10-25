const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

const source = readFileSync(resolve(__dirname, '../../apps/frontend/utils/app-links.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exported = {}
new Script(compiled).runInNewContext({ exports: exported })
// JSON round trip: arrays from the vm context aren't this realm's Arrays.
const { appleAppSiteAssociation, APP_LINK_COMPONENTS, IOS_APP_ID } = JSON.parse(JSON.stringify(exported))

// Apple's pattern syntax: `*` is any run of characters, `?` exactly one.
function matches(pattern, value) {
  const regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${regex}$`).test(value)
}

// A component matches when its path does and every query key it names
// matches; keys it doesn't name are unconstrained.
function claimed(link) {
  const url = new URL(link, 'https://www.fantasyreel.com')
  return APP_LINK_COMPONENTS.some((component) =>
    matches(component['/'], url.pathname) &&
    Object.entries(component['?'] ?? {}).every(([key, pattern]) =>
      url.searchParams.has(key) && matches(pattern, url.searchParams.get(key))))
}

const league = '/league/6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6'

test('association names the iPhone app for links and passwords', () => {
  assert.equal(IOS_APP_ID, 'TQC372U58U.com.fantasyreel.ios')
  const [details] = appleAppSiteAssociation.applinks.details
  assert.deepEqual(details.appIDs, [IOS_APP_ID])
  assert.deepEqual(details.components, APP_LINK_COMPONENTS)
  assert.deepEqual(appleAppSiteAssociation.webcredentials.apps, [IOS_APP_ID])
})

test('claims the links the app routes (DeepLinkTests)', () => {
  for (const link of [
    '/join?code=ab12cd', '/join?token=0d6f7c1e-1111', '/join?code=X&token=T',
    league, `${league}/`, `${league}/draft`, `${league}/bidding/history`, `${league}?tab=bidding`,
    '/dashboard', '/movies', '/wishlist', '/settings', '/help', '/how-to-play',
  ]) {
    assert.ok(claimed(link), link)
  }
})

test('leaves links the app would not route to the browser', () => {
  for (const link of [
    '/join', '/join?code=', '/league', '/league/', '/league/not-a-uuid', '/league/123/roster',
    '/', '/login', '/signup', '/forgot-password', '/reset-password', '/auth/callback?code=x',
    '/auth/confirm', '/unsubscribe?token=abc', '/privacy', '/terms', '/admin',
    '/movies/extra', '/dashboard/extra', '/api/health',
  ]) {
    assert.ok(!claimed(link), link)
  }
})
