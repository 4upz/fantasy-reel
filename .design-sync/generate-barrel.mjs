#!/usr/bin/env node
// Generates the design-sync barrel from tags in the component sources.
//
//   npm run design:barrel                    # regenerate
//   npm run design:barrel -- --check         # verify the committed files are current
//   npm run design:barrel -- --since <ref>   # + list tagged sources touched since <ref>
//
// WHY THIS EXISTS
//
// `entry.tsx` and `config.json`'s `componentSrcMap` used to be hand-written,
// which meant two registries listing the same components, plus a third list
// (drift-ignore.txt) naming every component that was deliberately in neither.
// Three hand-maintained lists over one set of files drift by construction, and
// the CI check that policed them just turned that drift into red builds on
// unrelated PRs.
//
// So membership now lives in ONE place: the component's own source file.
//
//   /** @design-system Movies */
//   export default function MovieCard(...)
//
// Untagged is not synced. That is the default, it needs no bookkeeping
// anywhere, and a new component cannot "drift" out of a list it was never
// meant to be in. To sync a component you tag it, in the file you are already
// editing, and re-run this. Both generated files are committed so a fresh
// clone can build without running the generator first.
//
// The tag argument is the barrel section (see GROUP_ORDER). `@design-system-provider`
// marks the context provider that wraps every preview — it must be a bundle
// export but is not itself a design-system component, so it is pinned to
// `null` in componentSrcMap and written to `cfg.provider`.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ENTRY = join(ROOT, '.design-sync/entry.tsx')
const CONFIG = join(ROOT, '.design-sync/config.json')

/** Where components live. Anything outside this is not scanned. */
const SCAN_ROOTS = ['apps/frontend/app', 'apps/frontend/components', 'apps/frontend/hooks']

/** Barrel section order. Unlisted groups sort alphabetically after these. */
const GROUP_ORDER = [
  'Context',
  'Foundation',
  'Feedback',
  'Movies',
  'League',
  'Modals',
  'Identity & brand',
  'Landing',
  'Settings primitives',
]

const PROVIDER_GROUP = 'Context'
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '__tests__'])
const isImpl = (f) => f.endsWith('.tsx') && !/\.(stories|test|spec)\./.test(f)

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? null : (process.argv[i + 1] ?? true)
}

// ── scan ────────────────────────────────────────────────────────────────────

function* walk(dir) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(`${dir}/${e.name}`)
    } else if (isImpl(e.name)) {
      yield `${dir}/${e.name}`
    }
  }
}

// A tag, the rest of its line, then up to a few more comment lines (the tail of
// a JSDoc block), then the export it annotates. Both tag styles are supported:
//
//   /** @design-system Movies */          ← one-liner above a bare declaration
//   ...prose...                           ← or a line inside an existing block
//    * @design-system Movies
//    */
//
// The group capture runs to end-of-line and a trailing `*/` is stripped after,
// rather than excluded here — excluding `*` is what made an earlier version
// silently match only the block-comment style.
//
// The tag must OPEN a comment line — `/**` or `*`, whitespace, then the tag.
// Prose that merely mentions the tag ("deliberately not tagged `@design-system`")
// sits mid-line and is correctly ignored; without this the exclusion notes on
// SiteFooter and TMDbAttribution tagged themselves.
//
// The intervening-lines quantifier is lazy AND bounded: an orphaned tag with no
// export beneath it must not reach down the file and mis-tag something else.
const TAG_RX =
  /(?:^|\n)[^\S\n]*(?:\/\*\*|\*)[^\S\n]*@design-system(?<provider>-provider)?(?<group>[^\n]*)\n(?:[^\n]*\n){0,10}?export\s+(?<def>default\s+)?(?:function|const)\s+(?<name>[A-Z][A-Za-z0-9]*)/g

function scan() {
  const found = []
  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      if (!text.includes('@design-system')) continue
      for (const m of text.matchAll(TAG_RX)) {
        const { provider, group, def, name } = m.groups
        found.push({
          name,
          path: file,
          viaDefault: !!def,
          isProvider: !!provider,
          group: provider ? PROVIDER_GROUP : group.trim().replace(/\s*\*\/\s*$/, '') || 'Components',
        })
      }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

const components = scan()

// ── validate ────────────────────────────────────────────────────────────────

const problems = []

const byName = new Map()
for (const c of components) {
  const prev = byName.get(c.name)
  if (prev) problems.push(`duplicate @design-system name "${c.name}" in ${prev.path} and ${c.path}`)
  else byName.set(c.name, c)
}

const providers = components.filter((c) => c.isProvider)
if (providers.length > 1) {
  problems.push(`more than one @design-system-provider: ${providers.map((p) => p.name).join(', ')}`)
}

if (problems.length) {
  console.error('\n✗ cannot generate:\n')
  for (const p of problems) console.error(`    ${p}`)
  console.error('')
  process.exit(1)
}

// ── emit entry.tsx ──────────────────────────────────────────────────────────

const groupRank = (g) => {
  const i = GROUP_ORDER.indexOf(g)
  return i < 0 ? GROUP_ORDER.length : i
}
const groupNames = [...new Set(components.map((c) => c.group))].sort(
  (a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b)
)

const HEADER = `// Design-system barrel for design-sync. GENERATED — DO NOT EDIT.
//
// Regenerate with \`npm run design:barrel\`. Membership is declared by a
// \`/** @design-system <Section> */\` tag on the component itself, so this file
// is derived state; editing it by hand is undone by the next run.
//
// Fantasy Reel is a Next.js app, not a published component package, so there
// is no \`dist/\` entry to bundle. This file is that entry: it re-exports the
// app's real, shipped components under stable names. Nothing here
// reimplements a component — every export points at what the app renders.
`

const BAR_WIDTH = 75
const bar = (label) => {
  const line = `// ── ${label} `
  return line + '─'.repeat(Math.max(3, BAR_WIDTH - [...line].length))
}

const entryBody = groupNames.map((g) => {
  const inGroup = components.filter((c) => c.group === g)

  // One statement per source file; a file's statement sorts by its first name.
  const byPath = new Map()
  for (const c of inGroup) {
    if (!byPath.has(c.path)) byPath.set(c.path, [])
    byPath.get(c.path).push(c)
  }

  const stmts = [...byPath.entries()]
    .sort((a, b) => a[1][0].name.localeCompare(b[1][0].name))
    .map(([path, cs]) => {
      const specs = [
        ...cs.filter((c) => c.viaDefault).map((c) => `default as ${c.name}`),
        ...cs.filter((c) => !c.viaDefault).map((c) => c.name),
      ]
      const from = `'../${path.replace(/\.tsx$/, '')}'`
      const one = `export { ${specs.join(', ')} } from ${from}`
      // Paths here are long and unshortenable, so a single re-export stays on
      // one line however wide it gets; only multi-specifier statements wrap.
      return specs.length === 1 || one.length <= 100
        ? one
        : `export {\n${specs.map((s) => `  ${s},`).join('\n')}\n} from ${from}`
    })

  return `${bar(g)}\n${stmts.join('\n')}`
})

const entryText = `${HEADER}\n${entryBody.join('\n\n')}\n`

// ── emit config.json ────────────────────────────────────────────────────────

const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'))

// componentSrcMap is serialized by hand so the barrel's sections survive as
// blank-line groups — JSON.stringify would flatten them into one wall of keys.
const mapLines = []
groupNames.forEach((g, gi) => {
  if (gi) mapLines.push('')
  for (const c of components.filter((x) => x.group === g)) {
    mapLines.push(`    ${JSON.stringify(c.name)}: ${c.isProvider ? 'null' : JSON.stringify(c.path)},`)
  }
})
// drop the trailing comma from the final entry
const lastIdx = mapLines.findLastIndex((l) => l.trim())
mapLines[lastIdx] = mapLines[lastIdx].replace(/,$/, '')

const provider = providers[0]
const rest = { ...cfg }
delete rest.componentSrcMap
if (provider) rest.provider = { component: provider.name }
else delete rest.provider

const restJson = JSON.stringify(rest, null, 2)
const configText =
  restJson.slice(0, restJson.lastIndexOf('\n}')) +
  ',\n  "componentSrcMap": {\n' +
  mapLines.join('\n') +
  '\n  }\n}\n'

// overrides tune preview capture per component; one naming a component that is
// no longer tagged is dead config, and silently dead config is how the last
// setup rotted. Report it, but do not fail the generate.
const staleOverrides = Object.keys(cfg.overrides ?? {}).filter((n) => !byName.has(n))

// `cfg.srcDir` is unset, so the converter cannot derive a component's group and
// every one starts as `general`; only `.design-sync/docs/<Name>.md` frontmatter
// sets the real group (see NOTES.md). A tagged component with no docs file
// therefore lands in `general` with no prose and nothing says so — the same
// silent-omission failure this generator exists to remove, one layer up.
const missingDocs = components
  .filter((c) => !c.isProvider && !existsSync(join(ROOT, `${cfg.docsDir}/${c.name}.md`)))
  .map((c) => c.name)

// ── write / check ───────────────────────────────────────────────────────────

const currentEntry = readFileSync(ENTRY, 'utf8')
const currentConfig = readFileSync(CONFIG, 'utf8')
const stale = [
  currentEntry !== entryText && relative(ROOT, ENTRY),
  currentConfig !== configText && relative(ROOT, CONFIG),
].filter(Boolean)

if (arg('--check')) {
  if (stale.length) {
    console.error(`\n✗ generated design-sync files are stale:\n`)
    for (const f of stale) console.error(`    ${f}`)
    console.error(`\n  Run \`npm run design:barrel\` and commit the result.\n`)
    process.exit(1)
  }
  console.log(`✓ design-sync barrel is current — ${byName.size} components tagged`)
} else {
  writeFileSync(ENTRY, entryText)
  writeFileSync(CONFIG, configText)
  console.log(
    stale.length
      ? `✓ regenerated ${stale.join(', ')} — ${byName.size} components tagged`
      : `✓ design-sync barrel already current — ${byName.size} components tagged`
  )
}

for (const g of groupNames) {
  console.log(`    ${g}: ${components.filter((c) => c.group === g).length}`)
}

if (staleOverrides.length) {
  console.log(`\nℹ ${staleOverrides.length} override(s) name untagged components — dead config:\n`)
  for (const n of staleOverrides) console.log(`    ${n}`)
  console.log(`\n  Remove them from "overrides" in .design-sync/config.json, or tag the component.\n`)
}

if (missingDocs.length) {
  console.log(`\nℹ ${missingDocs.length} tagged component(s) have no ${cfg.docsDir}/<Name>.md:\n`)
  for (const n of missingDocs) console.log(`    ${n}`)
  console.log(
    `\n  These land in the "general" group with no prose. Add a docs file with a\n` +
      `  \`category:\` line before the next re-sync — see .design-sync/NOTES.md.\n`
  )
}

// ── informational: tagged sources touched since a base ref ──────────────────

const since = arg('--since')
if (since && typeof since === 'string') {
  try {
    const changed = execFileSync('git', ['diff', '--name-only', `${since}...HEAD`], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
    const watched = new Set([
      ...components.map((c) => c.path),
      cfg.cssEntry,
      'apps/frontend/app/globals.css',
      'apps/frontend/types/index.ts',
    ])
    const touched = changed.filter((f) => watched.has(f))
    if (touched.length) {
      console.log(`\nℹ ${touched.length} synced source(s) changed since ${since}:\n`)
      for (const f of touched) console.log(`    ${f}`)
      console.log(
        `\n  The design project will be stale until someone re-syncs — see the\n` +
          `  runbook in .design-sync/NOTES.md. This is a notice, not a failure.\n`
      )
    }
  } catch {
    /* base ref unavailable (shallow clone) — skip the notice, never fail on it */
  }
}
