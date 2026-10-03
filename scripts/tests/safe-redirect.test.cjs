const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

const source = readFileSync(resolve(__dirname, '../../apps/frontend/utils/redirect.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exported = {}
new Script(compiled).runInNewContext({ exports: exported, URL })
const { safeRedirectPath } = exported

test('same-origin paths pass through with query and hash', () => {
  assert.equal(safeRedirectPath('/dashboard', '/'), '/dashboard')
  assert.equal(safeRedirectPath('/settings', '/'), '/settings')
  assert.equal(safeRedirectPath('/league/abc?tab=draft#top', '/'), '/league/abc?tab=draft#top')
  assert.equal(safeRedirectPath('/reset-password', '/'), '/reset-password')
})

test('missing or relative values use the fallback', () => {
  for (const input of [null, undefined, '', 'dashboard', 'https://evil.example', 'javascript:alert(1)']) {
    assert.equal(safeRedirectPath(input, '/dashboard'), '/dashboard', String(input))
  }
})

test('protocol-relative and parser-normalized off-site forms use the fallback', () => {
  for (const input of ['//evil.example', '/\\evil.example', '/\\/evil.example', '/\t/evil.example', '/\n/evil.example', '\\\\evil.example']) {
    assert.equal(safeRedirectPath(input, '/'), '/', JSON.stringify(input))
  }
})
