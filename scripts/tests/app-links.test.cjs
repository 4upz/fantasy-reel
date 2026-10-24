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
const { appleAppSiteAssociation, APP_LINK_PATHS, IOS_APP_ID } = JSON.parse(JSON.stringify(exported))

// Apple's `components` "/" pattern: `*` is any run of characters, `?` one.
function claimed(pathname) {
  return APP_LINK_PATHS.some((pattern) => {
    const regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(`^${regex}$`).test(pathname)
  })
}

test('association names the iPhone app for links and passwords', () => {
  assert.equal(IOS_APP_ID, 'TQC372U58U.com.fantasyreel.ios')
  const [details] = appleAppSiteAssociation.applinks.details
  assert.deepEqual(details.appIDs, [IOS_APP_ID])
  assert.deepEqual(details.components.map((c) => c['/']), [...APP_LINK_PATHS])
  assert.deepEqual(appleAppSiteAssociation.webcredentials.apps, [IOS_APP_ID])
})

test('claims the pages the app routes (DeepLinkTests)', () => {
  const league = '/league/6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6'
  for (const path of [
    '/join', league, `${league}/draft`, `${league}/bidding/history`, `${league}/trading`,
    '/movies', '/wishlist', '/settings', '/help', '/how-to-play',
  ]) {
    assert.ok(claimed(path), path)
  }
})

test('leaves web-only pages to the browser', () => {
  for (const path of [
    '/', '/dashboard', '/login', '/signup', '/forgot-password', '/reset-password',
    '/auth/callback', '/auth/confirm', '/unsubscribe', '/privacy', '/terms', '/admin',
    '/league', '/movies/extra', '/api/health',
  ]) {
    assert.ok(!claimed(path), path)
  }
})
