import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const supabaseRoot = resolve(process.env.TEST_SUPABASE_WORKDIR || root)

export function localUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Tests require an HTTP local origin without credentials, paths or query strings.')
  }
  return url
}

export function migrationDifference(files, applied) {
  return {
    pending: files.filter(version => !applied.includes(version)),
    unexpected: applied.filter(version => !files.includes(version)),
  }
}

// Never include CLI output in errors: Supabase status contains secret keys.
function command(binary, args, failure) {
  try {
    return execFileSync(binary, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
  } catch {
    throw new Error(failure)
  }
}

export async function checkHttpServices(status, request = fetch) {
  const url = localUrl(status.API_URL).origin
  for (const key of ['ANON_KEY', 'SERVICE_ROLE_KEY']) {
    if (!status[key] || status[key] === 'null') throw new Error(`Local ${key} credentials are missing; inspect Supabase status.`)
  }
  const auth = await request(`${url}/auth/v1/health`, {
    headers: { apikey: status.ANON_KEY }, signal: AbortSignal.timeout(10_000),
  })
  if (!auth.ok) throw new Error('Local auth health or public credentials failed.')
  const database = await request(`${url}/rest/v1/leagues?select=id&limit=0`, {
    headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!database.ok) throw new Error('Local database or service-role credentials failed.')
  const edge = await request(`${url}/functions/v1/get-leagues`, {
    method: 'POST', headers: { apikey: status.ANON_KEY, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(15_000),
  })
  const body = await edge.json().catch(() => null)
  if (edge.status !== 401 || body?.error !== 'Unauthorized' || !edge.headers.get('x-request-id')) {
    throw new Error('Local Edge Runtime is unavailable or stale. Start it with npx supabase functions serve, then retry.')
  }
}

export async function checkFrontendPort(value) {
  const url = localUrl(value)
  await new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error(`Cannot reserve frontend port ${url.port || 80}. Stop its server or choose another E2E_BASE_URL; tests must start their own checkout.`)))
    server.listen(Number(url.port || 80), url.hostname === '[::1]' ? '::1' : url.hostname, () => server.close(resolvePromise))
  })
}

export async function preflight({ e2e = false } = {}) {
  const cli = resolve(root, 'node_modules/.bin/supabase')
  const raw = command(cli, ['--workdir', supabaseRoot, 'status', '--output', 'json'], 'Cannot inspect local Supabase. Ensure Docker is available and run npx supabase start.')
  let status
  try { status = JSON.parse(raw) } catch { throw new Error('Supabase status did not return valid JSON.') }
  localUrl(status.API_URL) // Reject remote targets before inspecting credentials.

  const config = readFileSync(resolve(supabaseRoot, 'supabase/config.toml'), 'utf8')
  const project = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1]
  if (!project) throw new Error('Cannot determine local Supabase project_id.')
  // CLI status can regenerate an equivalent JWT with a different expiry. The
  // functions' service-role guard compares the exact token used by their runtime.
  status.SERVICE_ROLE_KEY = command('docker', ['exec', `supabase_edge_runtime_${project}`, 'printenv', 'SUPABASE_SERVICE_ROLE_KEY'],
    'Cannot inspect local Edge Runtime credentials. Start npx supabase functions serve and retry.').trim()
  await checkHttpServices(status) // Verify this same runtime key also accesses the database.

  const applied = command('docker', ['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'],
    'Cannot inspect local migration history. Check the local database container.').trim().split(/\s+/).filter(Boolean)
  const files = readdirSync(resolve(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).map(name => name.split('_')[0])
  const { pending, unexpected } = migrationDifference(files, applied)
  if (pending.length || unexpected.length) {
    throw new Error(`Local migration mismatch. Pending: ${pending.join(', ') || 'none'}. Database-only: ${unexpected.join(', ') || 'none'}. Apply pending migrations with npx supabase migration up; use the matching checkout for database-only versions. Do not reset your data.`)
  }
  if (e2e) await checkFrontendPort(process.env.E2E_BASE_URL || 'http://localhost:3100')
  console.log('Local test preflight passed: auth, database credentials, Edge Runtime, migrations' + (e2e ? ', frontend port.' : '.'))
  return status
}

export function testEnvironment(status) {
  return {
    ...process.env,
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    INBUCKET_URL: status.INBUCKET_URL,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preflight({ e2e: process.argv.includes('--e2e') }).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
