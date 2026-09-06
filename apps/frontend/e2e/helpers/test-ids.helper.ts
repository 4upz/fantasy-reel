import { createHash, randomUUID } from 'crypto'

let workerIndex = 0
let testScope = ''

/** Initialized once by Playwright config and inherited by setup, workers and teardown. */
export function getRunId(): string {
  const runId = process.env.E2E_RUN_ID
  if (!runId || !/^[a-z0-9-]{8,40}$/.test(runId)) {
    throw new Error('E2E_RUN_ID must be an 8–40 character lowercase alphanumeric/hyphen identifier')
  }
  return runId
}

export function setWorkerIndex(index: number, scope = ''): void {
  workerIndex = index
  testScope = scope
}

export function getWorkerIndex(): number {
  return workerIndex
}

/** Positive PostgreSQL integers, deterministically hashed from the run and test scope. */
export function uniqueTmdbId(localId: number, shared = false): number {
  if (!Number.isInteger(localId) || localId < 0 || localId >= 10000) {
    throw new Error(`localId must be 0-9999, got ${localId}`)
  }
  const scope = shared ? 'shared' : `${workerIndex}:${testScope}`
  const hash = createHash('sha256').update(`${getRunId()}:${scope}:${localId}`).digest()
  return 1_000_000_000 + (hash.readUInt32BE(0) % 1_000_000_000)
}

export function getWorkerPrefix(): string {
  return `e2e-${getRunId()}-w${workerIndex}-`
}

export function isRunEmail(email: string | undefined, worker?: number): boolean {
  const workerPattern = worker === undefined ? '\\d+' : String(worker)
  return new RegExp(`^e2e-${getRunId()}-w${workerPattern}-[^@]+@test\\.local$`).test(email ?? '')
}

export function uniqueEmail(prefix: string): string {
  return `${getWorkerPrefix()}${prefix}-${randomUUID().slice(0, 8)}@test.local`
}

export function uniqueLeagueName(baseName: string): string {
  return `${baseName} [${getWorkerPrefix()}${randomUUID().slice(0, 8)}]`
}

export function uniqueToken(prefix: string): string {
  return `${getWorkerPrefix()}${prefix}-${randomUUID()}`
}

export function movieRunMarker(): string {
  return `E2E:${getRunId()}:`
}
