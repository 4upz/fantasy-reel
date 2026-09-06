import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { preflight, root, testEnvironment } from './test-preflight.mjs'

try {
  const status = await preflight()
  const task = process.argv[2] || 'test'
  const child = spawn('deno', ['task', task, ...process.argv.slice(3)], {
    cwd: resolve(root, 'supabase/functions'), env: testEnvironment(status), stdio: 'inherit',
  })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
