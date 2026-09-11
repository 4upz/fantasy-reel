const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')
const { resolve } = require('node:path')

const source = fs.readFileSync(resolve(__dirname, '../../apps/frontend/utils/supabase/functions.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function harness(invoke) {
  const captured = []
  const module = { exports: {} }
  class FunctionsHttpError extends Error {
    constructor(context) { super('Request failed'); this.context = context }
  }
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      if (name === '@supabase/supabase-js') return { FunctionsHttpError }
      if (name === './client') return { createClient: () => ({ functions: { invoke } }) }
      if (name.endsWith('/sentry')) return { addBreadcrumb() {}, captureException: error => captured.push(error) }
      throw new Error(name)
    },
    crypto: require('node:crypto').webcrypto, performance, AbortController,
    setTimeout, clearTimeout, console: { error() {} },
  })
  return { call: module.exports.callEdgeFunction, captured, FunctionsHttpError }
}

test('a draft deadline releases a stalled auth/invoke call and preserves the uncertain-result contract', async () => {
  let signal, finish
  const { call, captured } = harness((_name, options) => {
    signal = options.signal
    return new Promise(resolve => { finish = resolve }) // Deliberately ignores abort, as a stalled auth lookup can.
  })
  const result = await call('draft-pick', { body: { request_id: 'original-attempt' }, timeoutMs: 10 })
  assert.equal(signal.aborted, true)
  assert.equal(result.data, null)
  assert.match(result.error, /took too long/)
  assert.equal(result.errorBody, null)
  assert.equal(captured[0].name, 'EdgeFunctionTimeoutError')
  finish({ data: { pick: 'committed-late' }, error: null })
  await Promise.resolve()
  assert.equal(result.data, null, 'a late response cannot replace the timeout result')
})

test('the deadline also bounds a stalled HTTP error body', async () => {
  const h = harness(async () => ({ data: null, error: new h.FunctionsHttpError({ status: 409, json: () => new Promise(() => {}) }) }))
  const result = await h.call('make-counterpick', { timeoutMs: 10 })
  assert.match(result.error, /took too long/)
})

test('successful requests clear their deadline and other callers keep their existing unbounded contract', async () => {
  const signals = []
  const { call, captured } = harness(async (_name, options) => {
    signals.push(options.signal)
    return { data: { saved: true }, error: null }
  })
  assert.equal((await call('draft-pick', { timeoutMs: 10 })).data.saved, true)
  assert.equal((await call('unrelated-endpoint')).data.saved, true)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(signals[0].aborted, false)
  assert.equal(signals[1], undefined)
  assert.equal(captured.length, 0)
})
