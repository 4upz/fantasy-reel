import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { preflight, root, testEnvironment } from './test-preflight.mjs'

try {
  const status = await preflight({ e2e: true })
  const child = spawn(resolve(root, 'node_modules/.bin/playwright'), ['test', ...process.argv.slice(2)], {
    cwd: resolve(root, 'apps/frontend'), env: testEnvironment(status), stdio: 'inherit',
  })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
