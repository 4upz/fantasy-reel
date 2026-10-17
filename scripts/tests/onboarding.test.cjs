const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname, join } = require('node:path')
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

const onboarding = loadTs(join(FRONTEND, 'utils/onboarding.ts'))
const { hasPlayedSeason, isNewPlayer } = onboarding
// Values made inside the module's context have its prototypes; compare them as plain data.
const plain = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)))
const nextStep = (...args) => plain(onboarding.nextStep(...args))
const { applicableSteps, pickAutoStart } = loadTs(join(FRONTEND, 'tours/engine.ts'))
const { getTour } = loadTs(join(FRONTEND, 'tours/registry.ts'))

const ME = 'user-me'
const membership = (id, status, { owner = 'someone-else', participant = 'active' } = {}) => ({
  status: participant,
  leagues: { id, name: `League ${id}`, status, owner_id: owner },
})

test('a player has played once a season of theirs got past its draft', () => {
  assert.equal(hasPlayedSeason([]), false)
  assert.equal(hasPlayedSeason([membership('a', 'setup'), membership('b', 'drafting')]), false)
  assert.equal(hasPlayedSeason([membership('a', 'active')]), true)
  // Leaving a finished season doesn't undo having played it.
  assert.equal(hasPlayedSeason([membership('a', 'completed', { participant: 'left' })]), true)
  // An embed RLS hid is no evidence either way.
  assert.equal(hasPlayedSeason([{ status: 'active', leagues: null }]), false)
  // A failed read is no newcomer: tours wait to be asked.
  assert.equal(isNewPlayer(null), false)
  assert.equal(isNewPlayer([]), true)
})

test('the next step is the most urgent league, and only for newcomers', () => {
  assert.equal(nextStep([], ME), null)

  const waiting = membership('w', 'setup')
  const mine = membership('m', 'setup', { owner: ME })
  const live = membership('d', 'drafting')
  assert.deepEqual(nextStep([waiting], ME), { kind: 'setup-member', leagueId: 'w', leagueName: 'League w' })
  assert.deepEqual(nextStep([waiting, mine], ME), { kind: 'setup-owner', leagueId: 'm', leagueName: 'League m' })
  assert.deepEqual(nextStep([waiting, mine, live], ME), { kind: 'draft-live', leagueId: 'd', leagueName: 'League d', counterpicking: false })
  assert.equal(nextStep([membership('c', 'counterpicking')], ME).counterpicking, true)

  // A league they left is no longer theirs to act in.
  assert.equal(nextStep([membership('x', 'setup', { participant: 'left' })], ME), null)
  // Someone who has played a season knows the way.
  assert.equal(nextStep([mine, membership('old', 'completed')], ME), null)
})

/** The step titles a viewer with this context would see, as the engine picks them. */
const titles = (id, ctx) => plain(applicableSteps(getTour(id), ctx).map((step) => step.title))

test('welcome waits for the league list and swaps the join step for an invitation', () => {
  assert.deepEqual(titles('welcome', { loaded: false }), [])
  const join = titles('welcome', { loaded: true, hasPendingInvites: false })
  const invited = titles('welcome', { loaded: true, hasPendingInvites: true })
  assert.equal(join.length, 3)
  assert.equal(invited.length, 3)
  assert.ok(join.includes('Join a friend’s league') && !join.includes('You’ve been invited'))
  assert.ok(invited.includes('You’ve been invited') && !invited.includes('Join a friend’s league'))
})

test('setup tours split by role, and only before the draft', () => {
  const owner = { isOwner: true, leagueStatus: 'setup' }
  const member = { isOwner: false, leagueStatus: 'setup' }
  assert.equal(titles('league-setup', owner).length, 3)
  assert.deepEqual(titles('league-setup', member), [])
  assert.equal(titles('league-waiting', member).length, 3)
  assert.deepEqual(titles('league-waiting', owner), [])
  for (const id of ['league-setup', 'league-waiting', 'league-settings']) {
    assert.deepEqual(titles(id, { isOwner: true, leagueStatus: 'drafting' }), [], id)
  }
})

test('the draft room teaches scoring second and says what follows the draft', () => {
  const base = { leagueStatus: 'drafting', draftComplete: false }
  const withCounterpicks = applicableSteps(getTour('draft-room'), { ...base, draftCounterpicks: true })
  const without = applicableSteps(getTour('draft-room'), { ...base, draftCounterpicks: false })
  assert.equal(withCounterpicks.length, 4)
  assert.equal(withCounterpicks[1].title, 'What makes a good pick')
  assert.match(withCounterpicks[3].body, /counterpick/)
  assert.doesNotMatch(without[3].body, /counterpick/)
  // Once every pick is in, the owner is choosing the next phase: no tour.
  assert.deepEqual(titles('draft-room', { ...base, draftComplete: true }), [])
})

test('the counterpick round needs a team, and only the owner learns to end it', () => {
  const ctx = { leagueStatus: 'counterpicking', hasTeam: true }
  assert.equal(titles('counterpick-round', { ...ctx, isOwner: false }).length, 2)
  assert.equal(titles('counterpick-round', { ...ctx, isOwner: true }).length, 3)
  assert.deepEqual(titles('counterpick-round', { ...ctx, hasTeam: false }), [])
})

test('onboarding tours start by themselves only for newcomers', () => {
  const ids = ['welcome', 'league-setup', 'league-waiting', 'league-settings', 'draft-room', 'counterpick-round']
  const ctxFor = {
    welcome: { loaded: true },
    'league-setup': { isOwner: true, leagueStatus: 'setup' },
    'league-waiting': { isOwner: false, leagueStatus: 'setup' },
    'league-settings': { leagueStatus: 'setup' },
    'draft-room': { leagueStatus: 'drafting' },
    'counterpick-round': { leagueStatus: 'counterpicking', hasTeam: true },
  }
  for (const id of ids) {
    const candidate = (newPlayer) => [{ tour: getTour(id), ctx: { ...ctxFor[id], newPlayer }, order: 0 }]
    assert.ok(pickAutoStart(candidate(true), new Map(), new Date()), `${id} starts for a newcomer`)
    assert.equal(pickAutoStart(candidate(false), new Map(), new Date()), null, `${id} waits to be asked by a veteran`)
  }
})
