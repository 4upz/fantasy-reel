const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync, statSync } = require('node:fs')
const { resolve, dirname, join, extname } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

const FRONTEND = resolve(__dirname, '../../apps/frontend')

/** Loads a frontend .ts module (and the relative modules it imports) the way the other script tests do. */
function loadTs(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file)
  const source = readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exported = {}
  cache.set(file, exported)
  const requireTs = (specifier) => {
    const base = specifier.startsWith('@/') ? join(FRONTEND, specifier.slice(2)) : resolve(dirname(file), specifier)
    return loadTs(base.endsWith('.ts') ? base : `${base}.ts`, cache)
  }
  new Script(compiled).runInNewContext({ exports: exported, require: requireTs, Object, Date, Math })
  return exported
}

const engine = loadTs(join(FRONTEND, 'tours/engine.ts'))
const { TOURS, TOUR_LIST, RETIRED_TOUR_IDS, getTour } = loadTs(join(FRONTEND, 'tours/registry.ts'))

/** Every `data-tour="…"` written literally in the frontend source. */
function anchorsInSource() {
  const anchors = new Set()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (extname(path) === '.tsx') {
        for (const match of readFileSync(path, 'utf8').matchAll(/data-tour="([a-z0-9-]+)"/g)) anchors.add(match[1])
      }
    }
  }
  for (const dir of ['app', 'components']) walk(join(FRONTEND, dir))
  return anchors
}

// ---- The registry -------------------------------------------------------

test('every tour is registered under its own id, in kebab-case, never reusing a retired one', () => {
  for (const [key, tour] of Object.entries(TOURS)) {
    assert.equal(tour.id, key, `registry key ${key} holds tour ${tour.id}`)
    assert.match(tour.id, /^[a-z0-9][a-z0-9-]{0,63}$/, `${tour.id} is not kebab-case`)
    assert.ok(!RETIRED_TOUR_IDS.includes(tour.id), `${tour.id} was retired; pick a new id`)
  }
  assert.equal(getTour('no-such-tour'), undefined)
  assert.equal(getTour('toString'), undefined, 'prototype keys are not tours')
})

test('every tour is short and complete', () => {
  for (const tour of TOUR_LIST) {
    assert.ok(Number.isInteger(tour.version) && tour.version >= 1 && tour.version <= 1000, `${tour.id}: version`)
    assert.ok(tour.title && tour.description, `${tour.id}: title and description`)
    assert.ok(tour.steps.length >= 1 && tour.steps.length <= 5, `${tour.id}: 1 to 5 steps, has ${tour.steps.length}`)
    for (const step of tour.steps) {
      assert.ok(step.title && !step.title.endsWith('.'), `${tour.id}: step titles are short headings without a period`)
      const paragraphs = Array.isArray(step.body) ? step.body : [step.body]
      assert.ok(paragraphs.length >= 1 && paragraphs.length <= 2 && paragraphs.every(Boolean), `${tour.id}: "${step.title}" has one or two paragraphs`)
    }
  }
})

test('every anchor a tour points at exists in the source', () => {
  const anchors = anchorsInSource()
  for (const tour of TOUR_LIST) {
    for (const step of tour.steps) {
      if (!step.anchor) continue
      assert.ok(anchors.has(step.anchor), `${tour.id}: no element has data-tour="${step.anchor}"`)
    }
  }
})

// ---- Outcomes -----------------------------------------------------------

const tour = { version: 2 }
const now = new Date('2026-10-17T12:00:00Z')

test('a tour is seen once finished or turned down at its version', () => {
  assert.equal(engine.isTourSeen(undefined, tour), false)
  assert.equal(engine.isTourSeen({ v: 2, status: 'completed' }, tour), true)
  assert.equal(engine.isTourSeen({ v: 2, status: 'dismissed' }, tour), true)
  assert.equal(engine.isTourSeen({ v: 2, status: 'snoozed' }, tour), false)
  assert.equal(engine.isTourSeen({ v: 1, status: 'completed' }, tour), false, 'a version bump shows it again')
  assert.equal(engine.isTourSeen({ v: 3, status: 'completed' }, tour), true)
})

test('a snoozed tour waits out its snooze', () => {
  assert.equal(engine.mayAutoStart(undefined, tour, now), true)
  assert.equal(engine.mayAutoStart({ v: 0 }, tour, now), true, 'the placeholder row is unseen')
  assert.equal(engine.mayAutoStart({ v: 2, status: 'snoozed', until: '2026-10-18T00:00:00Z' }, tour, now), false)
  assert.equal(engine.mayAutoStart({ v: 2, status: 'snoozed', until: '2026-10-16T00:00:00Z' }, tour, now), true)
  assert.equal(engine.mayAutoStart({ v: 2, status: 'completed' }, tour, now), false)
  assert.equal(engine.mayAutoStart({ v: 1, status: 'dismissed' }, tour, now), true)
})

test('tours are on unless turned off', () => {
  assert.equal(engine.toursEnabled(undefined), true)
  assert.equal(engine.toursEnabled({ enabled: true }), true)
  assert.equal(engine.toursEnabled({ enabled: false }), false)
})

// ---- Choosing a tour ----------------------------------------------------

const ownerOnly = {
  id: 'owner-only', version: 1, priority: 0, when: (ctx) => ctx.isOwner === true,
  steps: [{ title: 'A' }, { title: 'B', when: (ctx) => ctx.leagueStatus === 'setup' }],
}
const everyone = { id: 'everyone', version: 1, steps: [{ title: 'A' }] }
const urgent = { id: 'urgent', version: 1, priority: 10, steps: [{ title: 'A' }] }

test('when rules decide which tours and steps apply', () => {
  assert.equal(engine.applicableSteps(ownerOnly, { isOwner: false }).length, 0)
  assert.equal(engine.applicableSteps(ownerOnly, { isOwner: true, leagueStatus: 'active' }).length, 1)
  assert.equal(engine.applicableSteps(ownerOnly, { isOwner: true, leagueStatus: 'setup' }).length, 2)
})

test('the page starts the highest-priority applicable tour that has not been seen', () => {
  const candidates = [
    { tour: ownerOnly, ctx: { isOwner: false }, order: 0 },
    { tour: everyone, ctx: {}, order: 1 },
    { tour: urgent, ctx: {}, order: 2 },
  ]
  assert.equal(engine.pickAutoStart(candidates, new Map(), now).tour.id, 'urgent')
  const seen = new Map([['urgent', { v: 1, status: 'completed' }]])
  assert.equal(engine.pickAutoStart(candidates, seen, now).tour.id, 'everyone', 'owner-only does not apply to a member')
  seen.set('everyone', { v: 1, status: 'dismissed' })
  assert.equal(engine.pickAutoStart(candidates, seen, now), null)
})

test('a step body can depend on the page ctx', () => {
  const tour = { id: 'review', version: 1, steps: [{ title: 'Review', body: (ctx) => (ctx.isOwner ? 'You can veto.' : 'The commissioner can veto.') }] }
  assert.equal(engine.applicableSteps(tour, { isOwner: true })[0].body, 'You can veto.')
  assert.equal(engine.applicableSteps(tour, {})[0].body, 'The commissioner can veto.')
})

test('a tour that applies can still be kept from starting by itself', () => {
  const beginner = { id: 'beginner', version: 1, autoStart: (ctx) => ctx.newPlayer === true, steps: [{ title: 'A' }] }
  assert.equal(engine.pickAutoStart([{ tour: beginner, ctx: { newPlayer: false }, order: 0 }], new Map(), now), null)
  assert.equal(engine.pickAutoStart([{ tour: beginner, ctx: { newPlayer: true }, order: 0 }], new Map(), now).tour.id, 'beginner')
  assert.equal(engine.applicableSteps(beginner, { newPlayer: false }).length, 1, 'it can still be replayed')
})

// ---- Placement ----------------------------------------------------------

const viewport = { width: 1280, height: 800 }
const card = { width: 352, height: 220 }

test('a step without an anchor is centered in the free band', () => {
  const position = engine.placeCard(null, card, viewport, { top: 0, bottom: 0 })
  assert.equal(position.left, (1280 - 352) / 2)
  assert.equal(position.top, (800 - 220) / 2)
})

test('the card sits below its anchor when there is room, above when not', () => {
  const below = engine.placeCard({ top: 100, left: 500, width: 200, height: 40 }, card, viewport)
  assert.equal(below.top, 100 + 40 + engine.ANCHOR_GAP)
  const above = engine.placeCard({ top: 700, left: 500, width: 200, height: 40 }, card, viewport)
  assert.equal(above.top, 700 - engine.ANCHOR_GAP - 220)
})

test('the card stays inside the viewport and clear of fixed chrome', () => {
  const insets = { top: 120, bottom: 76 }
  for (const anchor of [
    { top: -50, left: -20, width: 100, height: 30 },
    { top: 790, left: 1250, width: 100, height: 30 },
    { top: 0, left: 0, width: 1280, height: 800 },
  ]) {
    const position = engine.placeCard(anchor, card, viewport, insets)
    assert.ok(position.top >= insets.top + engine.VIEWPORT_MARGIN, 'below the top chrome')
    assert.ok(position.top + Math.min(card.height, position.maxHeight) <= 800 - insets.bottom - engine.VIEWPORT_MARGIN, 'above the bottom bar')
    assert.ok(position.left >= engine.VIEWPORT_MARGIN && position.left + card.width <= 1280 - engine.VIEWPORT_MARGIN)
  }
})

test('a centered card stays clear of the side navigation', () => {
  const position = engine.placeCard(null, card, viewport, { top: 0, bottom: 0, left: 240 })
  assert.equal(position.left, 240 + (1280 - 240 - 352) / 2)
  const nearNav = engine.placeCard({ top: 300, left: 250, width: 100, height: 40 }, card, viewport, { top: 0, bottom: 0, left: 240 })
  assert.ok(nearNav.left >= 240 + engine.VIEWPORT_MARGIN, 'never over the side navigation')
})

test('on a phone the card docks to the edge away from its anchor', () => {
  const phone = { width: 390, height: 844 }
  const insets = { top: 104, bottom: 76 }
  const nearTop = engine.placeCard({ top: 150, left: 16, width: 200, height: 40 }, card, phone, insets)
  assert.equal(nearTop.docked, true)
  assert.equal(nearTop.top, 844 - 76 - engine.VIEWPORT_MARGIN - 220, 'docked above the bottom bar')
  const nearBottom = engine.placeCard({ top: 700, left: 16, width: 200, height: 40 }, card, phone, insets)
  assert.equal(nearBottom.top, 104 + engine.VIEWPORT_MARGIN, 'docked below the headers')
})

test('a card taller than the free band scrolls inside itself (200% zoom)', () => {
  const small = { width: 640, height: 300 }
  const position = engine.placeCard(null, { width: 352, height: 600 }, small, { top: 56, bottom: 0 })
  assert.equal(position.maxHeight, 300 - 56 - engine.VIEWPORT_MARGIN * 2)
  assert.equal(position.top, 56 + engine.VIEWPORT_MARGIN)
})
