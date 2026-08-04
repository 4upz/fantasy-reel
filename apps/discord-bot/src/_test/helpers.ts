import { vi } from 'vitest'

/**
 * Test harness for bot commands: a fake interaction object and a chainable
 * Supabase mock. Both are intentionally loose (`any`-heavy) since they only
 * need to satisfy the subset of the real APIs our commands call.
 */

export interface TableResponse {
  data?: unknown
  error?: unknown
  count?: number | null
}

export interface MockSupabaseConfig {
  tables?: Record<string, TableResponse>
  rpc?: Record<string, TableResponse>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createQueryBuilder(response: TableResponse): any {
  const result = {
    data: response.data ?? null,
    error: response.error ?? null,
    count: response.count ?? null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    returns: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: result.data, error: result.error })),
    single: vi.fn(() => Promise.resolve({ data: result.data, error: result.error })),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject),
  }

  return builder
}

export function createMockSupabaseClient(config: MockSupabaseConfig = {}) {
  const tables = config.tables || {}
  const rpc = config.rpc || {}
  // Every builder created per table, in call order -- lets tests assert which
  // filters (.eq/.is/etc.) a specific query actually applied.
  const buildersByTable: Record<string, ReturnType<typeof createQueryBuilder>[]> = {}

  const from = vi.fn((table: string) => {
    const builder = createQueryBuilder(tables[table] || { data: null, error: null })
    ;(buildersByTable[table] ||= []).push(builder)
    return builder
  })

  return {
    from,
    rpc: vi.fn((fnName: string) => {
      const resp = rpc[fnName] || { data: null, error: null }
      return Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null })
    }),
    /** The Nth (default: first) query builder created for `.from(table)`. */
    getBuilder(table: string, callIndex = 0) {
      return buildersByTable[table]?.[callIndex]
    },
  }
}

export interface InteractionOverrides {
  channelId?: string
  guildId?: string
  userId?: string
  stringOptions?: Record<string, string | null>
  focused?: string
}

export function makeInteraction(overrides: InteractionOverrides = {}) {
  const stringOptions = overrides.stringOptions || {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const interaction: any = {
    channelId: overrides.channelId ?? 'channel-1',
    guildId: overrides.guildId ?? 'guild-1',
    user: { id: overrides.userId ?? 'discord-user-1' },
    replied: false,
    deferred: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    respond: vi.fn().mockResolvedValue(undefined),
    options: {
      getString: vi.fn((name: string, required?: boolean) => {
        const value = stringOptions[name]
        if (value === undefined) return required ? '' : null
        return value
      }),
      getFocused: vi.fn(() => overrides.focused ?? ''),
    },
  }

  return interaction
}
