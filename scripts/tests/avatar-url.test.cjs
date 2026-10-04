const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

const source = readFileSync(resolve(__dirname, '../../apps/frontend/utils/avatar.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exported = {}
new Script(compiled).runInNewContext({ exports: exported, URL, atob, process: { env: {} } })
const { isAllowedAvatarUrl, projectRefFromAnonKey } = exported

const SUPABASE = 'https://ourproject.supabase.co'

test('uploads to this project and sign-in provider photos render', () => {
  for (const url of [
    `${SUPABASE}/storage/v1/object/public/avatars/u1/1700000000.png`,
    `${SUPABASE}/storage/v1/object/public/team-avatars/t1/1700000000.webp`,
    'https://cdn.discordapp.com/avatars/123/abc.png',
    'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c',
  ]) {
    assert.equal(isAllowedAvatarUrl(url, SUPABASE), true, url)
  }
  assert.equal(
    isAllowedAvatarUrl('http://127.0.0.1:54321/storage/v1/object/public/avatars/u1/1.png', 'http://127.0.0.1:54321'),
    true,
  )
})

test('any other host is refused', () => {
  for (const url of [
    'https://attacker.example/pixel.png',
    'https://otherproject.supabase.co/storage/v1/object/public/avatars/u1/1.png',
    `${SUPABASE}/storage/v1/object/public/posters/x.png`,
    `${SUPABASE}/functions/v1/anything`,
    'http://cdn.discordapp.com/avatars/1/a.png',
    'https://cdn.discordapp.com:8443/avatars/1/a.png',
    'https://cdn.discordapp.com.attacker.example/a.png',
    'https://cdn.discordapp.com@attacker.example/a.png',
    'https://user:pass@cdn.discordapp.com/a.png',
    '//attacker.example/a.png',
    'javascript:alert(1)',
    'not a url',
  ]) {
    assert.equal(isAllowedAvatarUrl(url, SUPABASE), false, url)
  }
})

test('without a configured Supabase URL only provider photos render', () => {
  assert.equal(isAllowedAvatarUrl(`${SUPABASE}/storage/v1/object/public/avatars/u1/1.png`, undefined), false)
  assert.equal(isAllowedAvatarUrl('https://cdn.discordapp.com/avatars/1/a.png', undefined), true)
})

test('a custom-domain deployment also renders uploads on its own ref host', () => {
  const custom = 'https://api.fantasyreel.com'
  assert.equal(isAllowedAvatarUrl(`${custom}/storage/v1/object/public/avatars/u1/1.png`, custom, 'ourref'), true)
  assert.equal(isAllowedAvatarUrl('https://ourref.supabase.co/storage/v1/object/public/avatars/u1/1.png', custom, 'ourref'), true)
  assert.equal(isAllowedAvatarUrl('https://ourref.supabase.co/storage/v1/object/public/posters/x.png', custom, 'ourref'), false)
  assert.equal(isAllowedAvatarUrl('https://otherref.supabase.co/storage/v1/object/public/avatars/u1/1.png', custom, 'ourref'), false)
  assert.equal(isAllowedAvatarUrl('https://ourref.supabase.co/storage/v1/object/public/avatars/u1/1.png', custom, null), false)
})

test('the project ref comes from a legacy JWT anon key only', () => {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const key = (payload) => `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
  assert.equal(projectRefFromAnonKey(key({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon' })), 'abcdefghijklmnop')
  assert.equal(projectRefFromAnonKey(key({ iss: 'supabase-demo', role: 'anon' })), null)
  assert.equal(projectRefFromAnonKey(key({ ref: 'evil.example/x' })), null)
  assert.equal(projectRefFromAnonKey('sb_publishable_abc123'), null)
  assert.equal(projectRefFromAnonKey(undefined), null)
  assert.equal(projectRefFromAnonKey('a.!!!.c'), null)
})
