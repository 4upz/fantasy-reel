#!/usr/bin/env node
// Design-sync drift report. Dependency-free; run it by hand before a re-sync.
//
//   npm run design:drift                              # report
//   npm run design:drift -- --since origin/main       # + list touched components
//   node .design-sync/check-drift.mjs --write-ignore  # reseed the exclusion list
//
// NOT A CI GATE. This used to run on every PR and it was the wrong shape for
// the job: the curated barrel is meant to lag the app, so every new component
// tripped it and the only fix was appending a name to drift-ignore.txt in a
// follow-up commit. That is bookkeeping, not a defect, and it does not belong
// on the critical path of an unrelated PR.
//
// What it reports, at the one moment the answer matters — when you are about
// to re-sync:
//
//   1. BROKEN PIN  — a componentSrcMap path that no longer exists. The sync
//                    build fails outright on this one, so fix it first.
//   2. UNSYNCED    — a component sitting in an already-synced directory that
//                    is in neither the barrel nor the ignore list. It would
//                    simply never reach the design system. Decide per
//                    component: sync it, or add it to drift-ignore.txt.
//
// Plus an informational list of synced sources touched since a base ref, so
// you can see how stale the design project has gotten.
//
// It still cannot tell you whether the design project is up to date — that
// state lives in the uploaded `_ds_sync.json`, not in git, and a correct
// re-sync commits nothing.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const CONFIG = join(ROOT, '.design-sync/config.json')
const IGNORE = join(ROOT, '.design-sync/drift-ignore.txt')

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? null : (process.argv[i + 1] ?? true)
}

const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'))
/** name -> repo-relative source path. `null` values are deliberate exclusions. */
const srcMap = Object.fromEntries(
  Object.entries(cfg.componentSrcMap ?? {}).filter(([, v]) => typeof v === 'string')
)
const syncedNames = new Set(Object.keys(srcMap))
const syncedPaths = new Set(Object.values(srcMap))

// A PascalCase component export. Matches the shape the barrel can re-export.
const EXPORT_RX = /^export\s+(?:default\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9]*)/gm
const isImpl = (f) => f.endsWith('.tsx') && !/\.(stories|test|spec)\./.test(f)

/** Every PascalCase component export found in the directories we already sync. */
function discoverCandidates() {
  const dirs = [...new Set([...syncedPaths].map((p) => dirname(p)))]
  const found = []
  for (const dir of dirs.sort()) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const file of readdirSync(abs).filter(isImpl)) {
      const rel = `${dir}/${file}`
      const text = readFileSync(join(abs, file), 'utf8')
      for (const [, name] of text.matchAll(EXPORT_RX)) found.push({ name, path: rel })
    }
  }
  return found
}

const candidates = discoverCandidates()

// ── --write-ignore: seed the exclusion list from the current state ──────────
if (arg('--write-ignore')) {
  const excluded = [...new Set(candidates.filter((c) => !syncedNames.has(c.name)).map((c) => c.name))].sort()
  writeFileSync(
    IGNORE,
    '# Components that live in synced directories but are deliberately NOT part\n' +
      '# of the design system — mostly page-level containers that own data\n' +
      '# fetching and routing, which are app wiring rather than design-system\n' +
      '# parts. See .design-sync/NOTES.md.\n' +
      '#\n' +
      '# A component in neither this list nor the barrel is reported by\n' +
      '# `npm run design:drift` so it surfaces at re-sync time instead of being\n' +
      '# silently omitted. Nothing blocks on it. To sync one, add it to\n' +
      '# entry.tsx + componentSrcMap. To keep excluding it, add its name here.\n\n' +
      excluded.join('\n') +
      '\n'
  )
  console.log(`wrote ${excluded.length} exclusions → ${relative(ROOT, IGNORE)}`)
  process.exit(0)
}

const ignored = new Set(
  existsSync(IGNORE)
    ? readFileSync(IGNORE, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : []
)

// ── 1. broken pins ──────────────────────────────────────────────────────────
const brokenPins = Object.entries(srcMap).filter(([, p]) => !existsSync(join(ROOT, p)))

// ── 2. unsynced components in synced directories ────────────────────────────
const unsynced = [...new Map(
  candidates.filter((c) => !syncedNames.has(c.name) && !ignored.has(c.name)).map((c) => [c.name, c])
).values()]

// ── 3. informational: synced sources touched since a base ref ───────────────
let touched = []
const since = arg('--since')
if (since && typeof since === 'string') {
  try {
    const changed = execFileSync('git', ['diff', '--name-only', `${since}...HEAD`], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
    const extra = [cfg.cssEntry, 'apps/frontend/app/globals.css', 'apps/frontend/types/index.ts']
    touched = changed.filter((f) => syncedPaths.has(f) || extra.includes(f))
  } catch {
    /* base ref unavailable (shallow clone) — skip the notice, never fail on it */
  }
}

// ── report ──────────────────────────────────────────────────────────────────
let failed = false

if (brokenPins.length) {
  failed = true
  console.error(`\n✗ ${brokenPins.length} componentSrcMap pin(s) point at files that no longer exist:\n`)
  for (const [name, p] of brokenPins) console.error(`    ${name}  →  ${p}`)
  console.error(
    '\n  The sync build fails on these. Update the path in .design-sync/config.json\n' +
      '  and the matching import in .design-sync/entry.tsx, or drop the component\n' +
      '  from both if it is gone for good.\n'
  )
}

if (unsynced.length) {
  failed = true
  console.error(`\n✗ ${unsynced.length} component(s) in synced directories are not in the design system:\n`)
  for (const c of unsynced) console.error(`    ${c.name}  (${c.path})`)
  console.error(
    '\n  These would be silently missing from the design system — the component\n' +
      '  list is a curated barrel, not a glob, so nothing else reports this.\n' +
      '\n  To SYNC one:    add an export to .design-sync/entry.tsx and a pin to\n' +
      '                  componentSrcMap in .design-sync/config.json, then re-sync\n' +
      '                  (runbook in .design-sync/NOTES.md) so it gets a preview card.\n' +
      '  To EXCLUDE one: add its name to .design-sync/drift-ignore.txt.\n'
  )
}

if (touched.length) {
  console.log(`\nℹ ${touched.length} synced source(s) changed in this PR:\n`)
  for (const f of touched) console.log(`    ${f}`)
  console.log(
    '\n  The design system will be stale until someone re-syncs. This is a\n' +
      '  notice, not a failure — see the re-sync runbook in .design-sync/NOTES.md.\n'
  )
}

if (!failed) {
  console.log(
    `✓ design-sync drift check passed — ${syncedNames.size} components synced, ` +
      `${ignored.size} deliberately excluded`
  )
}

process.exit(failed ? 1 : 0)
