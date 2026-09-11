import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const ROOT = resolve(import.meta.dirname, '..')
const BASE_COMPONENT = '/** @design-system Foundation */\nexport function Avatar() { return null }\n'

function fixture(t, sources = {}, config = {}) {
  const root = mkdtempSync(join(tmpdir(), 'design-barrel-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  for (const dir of ['.design-sync', 'apps/frontend/app', 'apps/frontend/components', 'apps/frontend/hooks']) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  copyFileSync(join(ROOT, '.design-sync/generate-barrel.mjs'), join(root, '.design-sync/generate-barrel.mjs'))
  symlinkSync(realpathSync(join(ROOT, 'node_modules')), join(root, 'node_modules'), 'dir')

  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  write('.design-sync/entry.tsx', '// Previous generated entry\n')
  write('.design-sync/config.json', JSON.stringify({
    projectId: 'fixture-project',
    docsDir: '.design-sync/docs',
    componentSrcMap: { Previous: 'previous.tsx' },
    ...config,
  }, null, 2) + '\n')
  for (const [path, text] of Object.entries(sources)) write(path, text)

  return {
    root,
    write,
    run: (...args) => spawnSync(process.execPath, [join(root, '.design-sync/generate-barrel.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
    }),
    outputs: () => ({
      entry: readFileSync(join(root, '.design-sync/entry.tsx'), 'utf8'),
      config: readFileSync(join(root, '.design-sync/config.json'), 'utf8'),
    }),
    config: () => JSON.parse(readFileSync(join(root, '.design-sync/config.json'), 'utf8')),
  }
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout)
}

test('generates named, default, and memo exports in component groups with a provider', (t) => {
  const f = fixture(t, {
    'apps/frontend/app/Card.tsx': `
/** @design-system Movies */
export default function MovieCard() { return null }
/** @design-system Movies */
export function MovieTitle() { return null }
`,
    'apps/frontend/components/Avatar.tsx': BASE_COMPONENT,
    'apps/frontend/components/Poster.tsx': `
/** @design-system Movies */
export const MoviePoster = memo(() => null)
`,
    'apps/frontend/components/Zebra.tsx': `
/** @design-system Zebra */
export function Zebra() { return null }
`,
    'apps/frontend/hooks/Wishlist.tsx': `
/** @design-system-provider */
export function WishlistProvider() { return null }
`,
  })

  assertSuccess(f.run())
  assert.deepEqual(f.config().componentSrcMap, {
    WishlistProvider: null,
    Avatar: 'apps/frontend/components/Avatar.tsx',
    MovieCard: 'apps/frontend/app/Card.tsx',
    MoviePoster: 'apps/frontend/components/Poster.tsx',
    MovieTitle: 'apps/frontend/app/Card.tsx',
    Zebra: 'apps/frontend/components/Zebra.tsx',
  })
  assert.deepEqual(Object.keys(f.config().componentSrcMap), [
    'WishlistProvider', 'Avatar', 'MovieCard', 'MoviePoster', 'MovieTitle', 'Zebra',
  ])
  assert.deepEqual(f.config().provider, { component: 'WishlistProvider' })
  const { entry } = f.outputs()
  assert.match(entry, /export\s*\{\s*default as MovieCard,\s*MovieTitle,?\s*\}/)
  assert.match(entry, /export\s*\{\s*MoviePoster\s*\}/)
  assert.match(entry, /export\s*\{\s*WishlistProvider\s*\}/)
  assert.equal((entry.match(/from ['"]\.\.\/apps\/frontend\/app\/Card['"]/g) ?? []).length, 1)
})

test('keeps tags in long JSDoc attached to their component', (t) => {
  const f = fixture(t, {
    'apps/frontend/components/Avatar.tsx': BASE_COMPONENT,
    'apps/frontend/components/MovieCard.tsx': `/**
 * @design-system Movies
${' * Additional documentation.\n'.repeat(15)} */
export function MovieCard() { return null }
`,
  })

  assertSuccess(f.run())
  assert.equal(f.config().componentSrcMap.MovieCard, 'apps/frontend/components/MovieCard.tsx')
  assertSuccess(f.run('--check'))
})

test('ignores tag examples in strings and prose instead of generating nonexistent exports', (t) => {
  const f = fixture(t, {
    'apps/frontend/components/Avatar.tsx': BASE_COMPONENT,
    'apps/frontend/components/Examples.tsx': [
      'const example = `',
      '/** @design-system Movies */',
      'export function Ghost() {}',
      '`',
      '/** Deliberately not tagged `@design-system`: app-only wiring. */',
      'export function AppOnly() { return null }',
      '/**',
      ' * An example: `@design-system Movies`',
      ' */',
      'export function AnotherAppOnly() { return null }',
    ].join('\n'),
  })

  assertSuccess(f.run())
  assert.deepEqual(f.config().componentSrcMap, { Avatar: 'apps/frontend/components/Avatar.tsx' })
  assert.doesNotMatch(f.outputs().entry, /Ghost|AppOnly/)
})

test('finds membership across attached JSDoc blocks', (t) => {
  const f = fixture(t, {
    'apps/frontend/components/MovieCard.tsx': `
/** @design-system Movies */
/** More component documentation. */
export const MovieCard = () => null
`,
  })

  assertSuccess(f.run())
  assert.deepEqual(f.config().componentSrcMap, { MovieCard: 'apps/frontend/components/MovieCard.tsx' })
})

const invalidSources = {
  'conflicting tags in separate attached JSDoc blocks': `
/** @design-system Movies */
/** @design-system League */
export function MovieCard() { return null }
`,
  'a non-exported declaration followed by an unrelated export': `
/** @design-system Movies */
const MovieCard = () => null
export default MovieCard
export function Helper() { return null }
`,
  'an unsupported class declaration': `
/** @design-system Movies */
export class MovieCard {}
`,
  'an export list instead of a component declaration': `
const MovieCard = () => null
/** @design-system Movies */
export { MovieCard }
`,
  'an orphaned tag at the end of the file': '/** @design-system Movies */\n',
  'a nested component declaration': `
export function AppOnly() {
  /** @design-system Movies */
  function MovieCard() { return null }
  return MovieCard()
}
`,
  'an anonymous default export': `
/** @design-system Movies */
export default function() { return null }
`,
  'an ambiguous declaration with multiple components': `
/** @design-system Movies */
export const First = () => null, Second = () => null
`,
}

for (const [description, source] of Object.entries(invalidSources)) {
  test(`rejects ${description} without changing generated files`, (t) => {
    const f = fixture(t, {
      'apps/frontend/components/Avatar.tsx': BASE_COMPONENT,
      'apps/frontend/components/Invalid.tsx': source,
    })
    const before = f.outputs()

    const result = f.run()

    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /Invalid\.tsx/)
    assert.deepEqual(f.outputs(), before)
  })
}

test('rejects duplicate component names without changing generated files', (t) => {
  const f = fixture(t, {
    'apps/frontend/app/Avatar.tsx': BASE_COMPONENT,
    'apps/frontend/components/Avatar.tsx': BASE_COMPONENT,
  })
  const before = f.outputs()

  const result = f.run()

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /duplicate.*Avatar/)
  assert.deepEqual(f.outputs(), before)
})

test('rejects multiple providers without changing generated files', (t) => {
  const f = fixture(t, {
    'apps/frontend/hooks/First.tsx': '/** @design-system-provider */\nexport function FirstProvider() { return null }\n',
    'apps/frontend/hooks/Second.tsx': '/** @design-system-provider */\nexport function SecondProvider() { return null }\n',
  })
  const before = f.outputs()

  const result = f.run()

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /more than one.*provider/)
  assert.deepEqual(f.outputs(), before)
})

test('emits an empty registry and removes provider config when no components are tagged', (t) => {
  const f = fixture(t, {}, { provider: { component: 'PreviousProvider' } })

  assertSuccess(f.run())
  assert.deepEqual(f.config().componentSrcMap, {})
  assert.equal(Object.hasOwn(f.config(), 'provider'), false)
  assert.doesNotMatch(f.outputs().entry, /^export /m)
  assertSuccess(f.run('--check'))
})

test('--check detects stale output without writing, and regeneration is idempotent', (t) => {
  const f = fixture(t, { 'apps/frontend/components/Avatar.tsx': BASE_COMPONENT })
  const before = f.outputs()

  const stale = f.run('--check')

  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /stale/)
  assert.deepEqual(f.outputs(), before)
  assertSuccess(f.run())
  const generated = f.outputs()
  assertSuccess(f.run('--check'))
  assert.deepEqual(f.outputs(), generated)
  assertSuccess(f.run())
  assert.deepEqual(f.outputs(), generated)

  f.write('apps/frontend/components/Avatar.tsx', BASE_COMPONENT.replace('Avatar()', 'Portrait()'))
  assert.notEqual(f.run('--check').status, 0)
  assert.deepEqual(f.outputs(), generated)
  assertSuccess(f.run())
  assert.deepEqual(f.config().componentSrcMap, { Portrait: 'apps/frontend/components/Avatar.tsx' })
})

test('ignores untagged components and tags in test, spec, story, and excluded directories', (t) => {
  const f = fixture(t, {
    'apps/frontend/components/Avatar.tsx': BASE_COMPONENT,
    'apps/frontend/components/AppOnly.tsx': 'export function AppOnly() { return null }\n',
    'apps/frontend/components/Avatar.test.tsx': BASE_COMPONENT,
    'apps/frontend/components/Avatar.spec.tsx': BASE_COMPONENT,
    'apps/frontend/components/Avatar.stories.tsx': BASE_COMPONENT,
    'apps/frontend/components/__tests__/Avatar.tsx': BASE_COMPONENT,
    'apps/frontend/components/node_modules/Avatar.tsx': BASE_COMPONENT,
    'apps/frontend/components/.next/Avatar.tsx': BASE_COMPONENT,
    'apps/frontend/components/dist/Avatar.tsx': BASE_COMPONENT,
  })

  assertSuccess(f.run())
  assert.deepEqual(f.config().componentSrcMap, { Avatar: 'apps/frontend/components/Avatar.tsx' })
})

test('preserves unrelated config and provider props while updating the provider component', (t) => {
  const config = {
    projectId: 'existing-project',
    docsDir: '.design-sync/docs',
    overrides: { WishlistProvider: { viewport: '800x600' } },
    extraFonts: ['fonts/custom.css'],
    customField: { enabled: true },
    provider: { component: 'PreviousProvider', props: { theme: 'dark', initialItems: [] } },
  }
  const f = fixture(t, {
    'apps/frontend/hooks/Wishlist.tsx': '/** @design-system-provider */\nexport function WishlistProvider() { return null }\n',
  }, config)

  assertSuccess(f.run())
  assert.deepEqual(f.config(), {
    ...config,
    provider: { ...config.provider, component: 'WishlistProvider' },
    componentSrcMap: { WishlistProvider: null },
  })
})

test('regenerates a missing entry file while --check leaves it missing', (t) => {
  const f = fixture(t, { 'apps/frontend/components/Avatar.tsx': BASE_COMPONENT })
  const entryPath = join(f.root, '.design-sync/entry.tsx')
  const beforeConfig = f.outputs().config
  rmSync(entryPath)

  const result = f.run('--check')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /stale/)
  assert.throws(() => readFileSync(entryPath), { code: 'ENOENT' })
  assert.equal(readFileSync(join(f.root, '.design-sync/config.json'), 'utf8'), beforeConfig)
  assertSuccess(f.run())
  assert.match(f.outputs().entry, /export\s*\{\s*Avatar\s*\}/)
  assertSuccess(f.run('--check'))
})
