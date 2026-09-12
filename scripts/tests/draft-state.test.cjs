const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')
const { resolve } = require('node:path')

const source = fs.readFileSync(resolve(__dirname, '../../apps/frontend/hooks/useDraftState.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const states = []
const requests = []
const timers = new Map()
let effect
let timerId = 0
let clockMs = 0
let onState
const listeners = new Map()
const topics = []
const target = {
  addEventListener: (name, callback) => listeners.set(name, callback),
  removeEventListener: (name) => listeners.delete(name),
}
const channel = { on() { return this }, subscribe() { return this } }
const supabase = {
  channel: topic => { topics.push(topic); return channel },
  removeChannel: async () => {},
  auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  from(table) {
    const query = {
      select() { return this }, eq() { return this }, order() { return this }, single() { return this },
      abortSignal(signal) { this.signal = signal; return this },
      then(resolve, reject) { requests.push({ table, signal: this.signal, resolve, reject }) },
    }
    return query
  },
}
const react = {
  useState(initial) {
    const index = states.length
    states.push(initial)
    return [initial, value => { states[index] = value; if (index === 0) onState?.() }]
  },
  useRef: current => ({ current }),
  useMemo: callback => callback(),
  useCallback: callback => callback,
  useEffect: callback => { effect = callback },
}
const moduleStub = { exports: {} }
vm.runInNewContext(compiled, {
  module: moduleStub, exports: moduleStub.exports,
  require(name) {
    if (name === 'react') return react
    if (name.endsWith('/client')) return { createClient: () => supabase }
    if (name.endsWith('/realtimeDiagnostics')) return { realtimeErrorText: error => error?.message }
    if (name.endsWith('/sentry')) return { addBreadcrumb() {}, captureMessage() {} }
    if (name.endsWith('/analytics')) return { trackEvent() {} }
    throw new Error(name)
  },
  setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id },
  clearTimeout: id => timers.delete(id),
  setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, interval: true }); return id },
  clearInterval: id => timers.delete(id),
  queueMicrotask, AbortController, Promise, performance: { now: () => clockMs }, crypto: require("node:crypto").webcrypto,
  window: target, document: { ...target, visibilityState: 'visible' }, navigator: { onLine: true },
})
const state = moduleStub.exports.useDraftState({ league: { id: 'league', generation: 0 }, participants: [], draftPicks: [], counterpicks: [] })
const cleanup = effect()
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function resolvePass(generation) {
  assert.equal(requests.length, 4)
  for (const request of requests.splice(0)) request.resolve({ data: request.table === 'leagues' ? { id: 'league', generation } : [], error: null })
}

async function main() {
  const first = state.refresh()
  await flush()
  assert.equal(state.refresh(), first)
  resolvePass(1)
  await flush()
  assert.equal(states[0].league.generation, 0, 'superseded data was not applied')
  resolvePass(2)
  assert.equal(await first, true)
  assert.equal(states[0].league.generation, 2)

  let followup
  onState = () => { onState = undefined; queueMicrotask(() => { followup = state.refresh() }) }
  const boundary = state.refresh()
  await flush()
  resolvePass(3)
  await boundary
  await flush()
  assert.equal(requests.length, 4, 'refresh during worker completion starts another read')
  resolvePass(4)
  assert.equal(await followup, true)

  const stalled = state.refresh()
  await flush()
  const stalledRequests = requests.splice(0)
  state.refresh()
  const deadline = [...timers.values()].find(timer => timer.delay === 15000)
  assert.ok(deadline)
  deadline.callback()
  assert.equal(await stalled, false)
  assert.ok(states[1], 'timeout remains visible when an event requested newer data')
  assert.ok(stalledRequests.every(request => request.signal.aborted))
  const recovered = state.refresh()
  await flush()
  resolvePass(5)
  assert.equal(await recovered, true)
  assert.equal(states[1], null)

  // Routine polling must not discard a healthy response simply because it
  // takes longer than the polling interval to arrive.
  const fallback = [...timers.values()].find(timer => timer.delay === 10000 && !timer.interval)
  fallback.callback()
  let slowResolved = false
  const slow = state.refresh().then(result => { slowResolved = true; return result })
  await flush()
  const poll = [...timers.values()].find(timer => timer.interval)
  clockMs += 10000
  poll.callback()
  clockMs += 1000
  resolvePass(6)
  await flush()
  assert.equal(states[0].league.generation, 6, 'a successful 11-second read survives a 10-second polling tick')
  assert.equal(slowResolved, true, 'polling does not keep the caller waiting for another read')
  assert.equal(await slow, true)

  // Actual mutation/recovery events still invalidate stale reads, but their
  // follow-up reads share one deadline instead of extending it indefinitely.
  const invalidated = state.refresh()
  await flush()
  for (const generation of [7, 8]) {
    clockMs += 6000
    state.refresh()
    resolvePass(generation)
    await flush()
  }
  assert.equal(states[0].league.generation, 6, 'genuinely superseded data remains unapplied')
  const remainingDeadline = [...timers.values()].find(timer => timer.delay === 3000)
  assert.ok(remainingDeadline, 'follow-up reads use the remaining overall deadline')
  const invalidatedRequests = requests.splice(0)
  clockMs += 3000
  remainingDeadline.callback()
  assert.equal(await invalidated, false, 'ongoing invalidations release the caller after 15 seconds')
  assert.ok(invalidatedRequests.every(request => request.signal.aborted))
  assert.ok(states[1], 'an exhausted overall deadline remains visible')
  const afterInvalidation = state.refresh()
  await flush()
  resolvePass(9)
  assert.equal(await afterInvalidation, true)
  assert.equal(states[1], null)

  const unmounted = state.refresh()
  await flush()
  cleanup()
  assert.equal(await unmounted, false)
  assert.ok(requests.every(request => request.signal.aborted))
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
  assert.equal(await state.refresh(), false)

}
test('draft refresh coalesces events, tolerates slow polling, bounds reconciliation, and cancels on unmount', main)

test('rapid draft remount survives the installed SDK asynchronous channel cleanup', async () => {
  const { RealtimeClient } = require('@supabase/realtime-js')
  const initial = { league: { id: 'same-league' }, participants: [], draftPicks: [], counterpicks: [] }
  moduleStub.exports.useDraftState(initial)
  const firstCleanup = effect()
  const firstTopic = topics.at(-1)
  firstCleanup()
  moduleStub.exports.useDraftState(initial)
  const secondCleanup = effect()
  const secondTopic = topics.at(-1)

  // No network connection is opened: this exercises the actual SDK registry race.
  const client = new RealtimeClient('ws://127.0.0.1:1/socket', { params: { apikey: 'local-test-placeholder' } })
  const first = client.channel(firstTopic)
  const removing = client.removeChannel(first)
  const replacement = client.channel(secondTopic)
  await removing
  assert.deepEqual(client.getChannels(), [replacement], 'old cleanup removed the new mount subscription')
  await client.removeAllChannels()
  secondCleanup()
})

test('a delayed mutation response cannot rewind the live league phase', () => {
  const hook = moduleStub.exports.useDraftState({ league: { id: 'phase-league', status: 'drafting' }, participants: [], draftPicks: [], counterpicks: [] })
  hook.acceptLeague({ id: 'phase-league', status: 'active' })
  hook.acceptLeague({ id: 'phase-league', status: 'counterpicking' })
  assert.equal(hook.getSnapshot().league.status, 'active')
  hook.acceptLeague({ id: 'different-league', status: 'completed' })
  assert.equal(hook.getSnapshot().league.id, 'phase-league')
})
