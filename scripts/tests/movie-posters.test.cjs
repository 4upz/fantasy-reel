const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

const source = readFileSync(resolve(__dirname, '../../apps/frontend/utils/movie-posters.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exported = {}
new Script(compiled).runInNewContext({ exports: exported, URL })
const { getTmdbPosterUrl } = exported

test('stored paths and full TMDb URLs resolve to the same thumbnail', () => {
  const expected = 'https://image.tmdb.org/t/p/w154/poster.jpg'
  for (const input of ['/poster.jpg', 'https://image.tmdb.org/t/p/w500/poster.jpg', 'https://image.tmdb.org/t/p/original/poster.jpg']) {
    assert.equal(getTmdbPosterUrl(input, 'w154'), expected)
  }
  assert.equal(getTmdbPosterUrl(' /poster.jpg '), 'https://image.tmdb.org/t/p/w500/poster.jpg')
})

test('local marketing assets and non-TMDb URLs keep their original source', () => {
  for (const input of ['/images/homepage/barbie.webp', '/brand/v1/poster.png', 'https://project.supabase.co/storage/v1/object/public/posters/movie.jpg', 'https://example.com/t/p/w500/poster.jpg']) {
    assert.equal(getTmdbPosterUrl(input, 'w92'), input)
  }
})

test('missing or malformed remote sources become placeholders', () => {
  for (const input of [null, undefined, '', ' ', 'not-a-url', '//untrusted.example/poster.jpg', 'javascript:alert(1)', 'https://image.tmdb.org/invalid.jpg', 'https://image.tmdb.org/t/p/w500/']) {
    assert.equal(getTmdbPosterUrl(input), null, String(input))
  }
})
