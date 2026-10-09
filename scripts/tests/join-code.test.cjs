const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

const source = readFileSync(resolve(__dirname, '../../apps/frontend/utils/joinCode.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exported = {}
new Script(compiled).runInNewContext({ exports: exported, URL, URLSearchParams })
const { normalizeJoinCode, joinPathFromInput } = exported

test('normalizeJoinCode uppercases and drops only separators', () => {
  assert.equal(normalizeJoinCode('abcd2345'), 'ABCD2345')
  assert.equal(normalizeJoinCode(' abcd-2345 '), 'ABCD2345')
  assert.equal(normalizeJoinCode('ab cd\t23-45'), 'ABCD2345')
  // Mistyped characters stay, so the server can report them
  assert.equal(normalizeJoinCode('abcd23o5'), 'ABCD23O5')
})

test('a typed join code goes to the code flow, never the invitation flow', () => {
  assert.equal(joinPathFromInput('ABCD2345'), '/join?code=ABCD2345')
  assert.equal(joinPathFromInput('  abcd-2345 '), '/join?code=ABCD2345')
})

test('a pasted join link keeps only its code', () => {
  assert.equal(joinPathFromInput('https://fantasyreel.com/join?code=ABCD2345'), '/join?code=ABCD2345')
  assert.equal(joinPathFromInput(' http://localhost:3000/join?code=abcd2345 '), '/join?code=ABCD2345')
  assert.equal(joinPathFromInput('fantasyreel.com/join?code=ABCD2345'), '/join?code=ABCD2345')
  assert.equal(joinPathFromInput('/join?code=ABCD2345#top'), '/join?code=ABCD2345')
})

test('a pasted invitation link keeps its token', () => {
  const token = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
  assert.equal(joinPathFromInput(`https://fantasyreel.com/join?token=${token}`), `/join?token=${token}`)
})

test('anything else is passed along encoded for the join page to reject', () => {
  assert.equal(joinPathFromInput('ab&cd=1'), '/join?code=AB%26CD%3D1')
  assert.equal(joinPathFromInput('https://fantasyreel.com/join'), `/join?code=${encodeURIComponent('HTTPS://FANTASYREEL.COM/JOIN')}`)
})
