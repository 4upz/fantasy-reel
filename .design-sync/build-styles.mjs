// Prepare the standalone design renderer from the app's current local sources.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '..')
const fonts = join(directory, 'fonts')
const assets = join(directory, 'assets')
const cache = join(directory, '.cache')
await Promise.all([fonts, assets, cache].map(path => mkdir(path, { recursive: true })))

for (const filename of ['bricolage.woff2', 'dm-sans.woff2']) {
  await copyFile(join(root, 'apps/frontend/app/fonts', filename), join(fonts, filename))
}

// The renderer has no Next public directory. Its image shim resolves these
// approved brand paths to SVG data URLs without changing the app component.
const brand = {}
for (const filename of ['logo-dark.svg', 'logo-compact-dark.svg', 'mark-gold.svg']) {
  const svg = await readFile(join(root, 'apps/frontend/public/brand/v1', filename))
  brand[`/brand/v1/${filename}`] = `data:image/svg+xml;base64,${svg.toString('base64')}`
}
await writeFile(join(assets, 'brand.json'), JSON.stringify(brand, null, 2) + '\n')

const entry = join(directory, 'tailwind-entry.css')
const output = join(cache, 'styles.css')
const result = await postcss([tailwind({ base: root })]).process(await readFile(entry, 'utf8'), {
  from: entry,
  to: output,
  map: false,
})
await writeFile(output, result.css)
for (const warning of result.warnings()) console.warn(warning.toString())
console.log('Prepared shared typography, two local fonts, and three embedded brand assets.')
