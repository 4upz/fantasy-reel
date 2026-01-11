/**
 * Mock utilities for Supabase Edge Functions unit tests
 */

// deno-lint-ignore-file no-explicit-any

/**
 * Configuration for mock query builder responses
 */
export interface MockQueryConfig {
  data?: any
  error?: { message: string; code?: string } | null
  count?: number | null
}

/**
 * Configuration for mock table
 */
export interface MockTableConfig {
  select?: MockQueryConfig
  insert?: MockQueryConfig
  update?: MockQueryConfig
  upsert?: MockQueryConfig
  delete?: MockQueryConfig
}

/**
 * Configuration for mock Supabase client
 */
export interface MockSupabaseConfig {
  user?: any | null
  authError?: { message: string } | null
  tables?: Record<string, MockTableConfig>
  rpc?: Record<string, MockQueryConfig>
}

/**
 * Track method calls for assertions
 */
export interface MethodCall {
  method: string
  args: any[]
}

/**
 * Create a chainable mock query builder
 */
function createMockQueryBuilder(
  config: MockTableConfig,
  calls: MethodCall[],
  operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
): any {
  const opConfig = config[operation] || { data: [], error: null }

  const builder: any = {
    select: (...args: any[]) => {
      calls.push({ method: 'select', args })
      return builder
    },
    insert: (data: any) => {
      calls.push({ method: 'insert', args: [data] })
      return createMockQueryBuilder(config, calls, 'insert')
    },
    update: (data: any) => {
      calls.push({ method: 'update', args: [data] })
      return createMockQueryBuilder(config, calls, 'update')
    },
    upsert: (data: any, options?: any) => {
      calls.push({ method: 'upsert', args: [data, options] })
      return createMockQueryBuilder(config, calls, 'upsert')
    },
    delete: () => {
      calls.push({ method: 'delete', args: [] })
      return createMockQueryBuilder(config, calls, 'delete')
    },
    eq: (column: string, value: any) => {
      calls.push({ method: 'eq', args: [column, value] })
      return builder
    },
    neq: (column: string, value: any) => {
      calls.push({ method: 'neq', args: [column, value] })
      return builder
    },
    in: (column: string, values: any[]) => {
      calls.push({ method: 'in', args: [column, values] })
      return builder
    },
    or: (filter: string) => {
      calls.push({ method: 'or', args: [filter] })
      return builder
    },
    order: (column: string, options?: any) => {
      calls.push({ method: 'order', args: [column, options] })
      return builder
    },
    limit: (count: number) => {
      calls.push({ method: 'limit', args: [count] })
      return builder
    },
    single: () => {
      calls.push({ method: 'single', args: [] })
      return Promise.resolve({
        data: Array.isArray(opConfig.data) ? opConfig.data[0] : opConfig.data,
        error: opConfig.error || null,
      })
    },
    maybeSingle: () => {
      calls.push({ method: 'maybeSingle', args: [] })
      return Promise.resolve({
        data: Array.isArray(opConfig.data) ? opConfig.data[0] : opConfig.data,
        error: opConfig.error || null,
      })
    },
    then: (resolve: (value: any) => any) => {
      return resolve({
        data: opConfig.data,
        error: opConfig.error || null,
        count: opConfig.count ?? null,
      })
    },
  }

  return builder
}

/**
 * Create a mock Supabase client for testing
 */
export function createMockSupabaseClient(config: MockSupabaseConfig = {}) {
  const calls: MethodCall[] = []
  const tableCalls: Record<string, MethodCall[]> = {}

  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: config.user ?? null },
          error: config.authError ?? null,
        }),
    },
    from: (table: string) => {
      if (!tableCalls[table]) {
        tableCalls[table] = []
      }
      calls.push({ method: 'from', args: [table] })
      const tableConfig = config.tables?.[table] || {}
      return createMockQueryBuilder(tableConfig, tableCalls[table])
    },
    rpc: (fnName: string, params?: any) => {
      calls.push({ method: 'rpc', args: [fnName, params] })
      const rpcConfig = config.rpc?.[fnName] || { data: [], error: null }
      return Promise.resolve({
        data: rpcConfig.data,
        error: rpcConfig.error || null,
      })
    },
    // Track all calls for assertions
    _calls: calls,
    _tableCalls: tableCalls,
  }

  return client
}

/**
 * Create a mock Request object
 */
export function createMockRequest(
  options: {
    method?: string
    body?: any
    headers?: Record<string, string>
    url?: string
  } = {}
): Request {
  const { method = 'POST', body, headers = {}, url = 'http://localhost/test' } = options

  const requestHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  })

  return new Request(url, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/**
 * Create a mock Request with Authorization header
 */
export function createMockAuthRequest(
  body?: any,
  options: { method?: string; token?: string } = {}
): Request {
  return createMockRequest({
    method: options.method || 'POST',
    body,
    headers: {
      Authorization: `Bearer ${options.token || 'mock-jwt-token'}`,
    },
  })
}

/**
 * Create a mock OPTIONS request for CORS preflight
 */
export function createMockOptionsRequest(): Request {
  return createMockRequest({
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  })
}

/**
 * Mock environment variables for testing
 */
export function mockEnvVars(vars: Record<string, string>): () => void {
  const originalGet = Deno.env.get
  const mockGet = (key: string): string | undefined => vars[key]

  // @ts-ignore - Mocking Deno.env.get
  Deno.env.get = mockGet

  // Return cleanup function
  return () => {
    // @ts-ignore - Restoring Deno.env.get
    Deno.env.get = originalGet
  }
}

/**
 * Mock global fetch for API calls
 */
export function mockFetch(
  responses: Array<{
    url?: string | RegExp
    response: Response | (() => Response)
  }>
): () => void {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    for (const mock of responses) {
      if (!mock.url) {
        return typeof mock.response === 'function' ? mock.response() : mock.response
      }
      if (typeof mock.url === 'string' && url.includes(mock.url)) {
        return typeof mock.response === 'function' ? mock.response() : mock.response
      }
      if (mock.url instanceof RegExp && mock.url.test(url)) {
        return typeof mock.response === 'function' ? mock.response() : mock.response
      }
    }

    // Default: return a 404 response
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  }

  // Return cleanup function
  return () => {
    globalThis.fetch = originalFetch
  }
}

/**
 * Create a mock JSON Response
 */
export function mockJsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Helper to parse JSON response body
 */
export async function parseResponseBody<T = any>(response: Response): Promise<T> {
  return response.json()
}

/**
 * Helper to assert response status and body
 */
export async function assertResponse(
  response: Response,
  expectedStatus: number,
  expectedBody?: any
): Promise<void> {
  const { assertEquals } = await import('@std/assert')
  assertEquals(response.status, expectedStatus)

  if (expectedBody !== undefined) {
    const body = await response.json()
    assertEquals(body, expectedBody)
  }
}
