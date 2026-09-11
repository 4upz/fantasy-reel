/**
 * Unit tests for shared utility functions
 * Pure unit tests that don't require integration infrastructure
 */

import { assertEquals, assertExists } from '@std/assert'
import {
  jsonResponse,
  errorResponse,
  isValidUUID,
  isValidEmail,
  handleCorsPreflightRequest,
  generateJoinCode,
  isValidJoinCode,
  isServiceRoleRequest,
  authenticateRequest,
  authenticateUserOrServiceRole,
  isUpcomingMovie,
} from './utils.ts'
import { corsHeaders } from './cors.ts'
import { stubFetch } from './_mock-client.ts'

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

const INVALID_UUIDS = [
  '',
  'not-a-uuid',
  '12345',
  'a0eebc99-9c0b-4ef8-bb6d',
  'g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
]

const VALID_EMAILS = [
  'test@example.com',
  'user.name@domain.co.uk',
  'user+tag@example.org',
]

const INVALID_EMAILS = ['', 'not-an-email', '@example.com', 'user@', 'user@.com']

// ============================================================================
// Test Helpers
// ============================================================================

function createMockRequest(method = 'POST'): Request {
  return new Request('http://localhost/test', {
    method,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createMockOptionsRequest(): Request {
  return new Request('http://localhost/test', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
    },
  })
}

function assertHasCorsHeaders(response: Response): void {
  for (const [header, value] of Object.entries(corsHeaders)) {
    assertEquals(response.headers.get(header), value)
  }
}

// ============================================================================
// isValidUUID Tests
// ============================================================================

Deno.test('isValidUUID', async (t) => {
  await t.step('returns true for valid UUIDs', () => {
    assertEquals(isValidUUID(VALID_UUID), true)
    assertEquals(isValidUUID('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'), true)
    assertEquals(isValidUUID('550e8400-e29b-41d4-a716-446655440000'), true)
  })

  await t.step('returns false for invalid UUIDs', () => {
    for (const invalid of INVALID_UUIDS) {
      assertEquals(isValidUUID(invalid), false, `Expected "${invalid}" to be invalid`)
    }
  })

  await t.step('returns false for null/undefined-like inputs', () => {
    assertEquals(isValidUUID(''), false)
    assertEquals(isValidUUID('null'), false)
    assertEquals(isValidUUID('undefined'), false)
  })
})

// ============================================================================
// isValidEmail Tests
// ============================================================================

Deno.test('isValidEmail', async (t) => {
  await t.step('returns true for valid emails', () => {
    for (const email of VALID_EMAILS) {
      assertEquals(isValidEmail(email), true, `Expected "${email}" to be valid`)
    }
  })

  await t.step('returns false for invalid emails', () => {
    for (const email of INVALID_EMAILS) {
      assertEquals(isValidEmail(email), false, `Expected "${email}" to be invalid`)
    }
  })
})

// ============================================================================
// jsonResponse Tests
// ============================================================================

Deno.test('jsonResponse', async (t) => {
  await t.step('creates response with default 200 status', async () => {
    const data = { message: 'success' }
    const response = jsonResponse(data)

    assertEquals(response.status, 200)
    assertEquals(response.headers.get('Content-Type'), 'application/json')
    assertEquals(await response.json(), data)
  })

  await t.step('creates response with custom status', async () => {
    const data = { id: '123', created: true }
    const response = jsonResponse(data, 201)

    assertEquals(response.status, 201)
    assertEquals(await response.json(), data)
  })

  await t.step('includes CORS headers', () => {
    const response = jsonResponse({ test: true })
    assertHasCorsHeaders(response)
  })

  await t.step('handles complex nested data', async () => {
    const data = {
      league: { id: '123', name: 'Test' },
      participants: [{ id: '1' }, { id: '2' }],
      meta: { count: 2, page: 1 },
    }
    const response = jsonResponse(data)
    assertEquals(await response.json(), data)
  })

  await t.step('handles null and empty data', async () => {
    assertEquals(await jsonResponse(null).json(), null)
    assertEquals(await jsonResponse({}).json(), {})
    assertEquals(await jsonResponse([]).json(), [])
  })
})

// ============================================================================
// errorResponse Tests
// ============================================================================

Deno.test('errorResponse', async (t) => {
  await t.step('creates error response with default 500 status', async () => {
    const response = errorResponse('Something went wrong')

    assertEquals(response.status, 500)
    assertEquals(response.headers.get('Content-Type'), 'application/json')
    const body = await response.json()
    assertEquals(body.error, 'Something went wrong')
    assertEquals(typeof body.request_id, 'string')
  })

  await t.step('creates error response with custom status', async () => {
    const response = errorResponse('Not found', 404)

    assertEquals(response.status, 404)
    assertEquals(await response.json(), { error: 'Not found' })
  })

  await t.step('creates common HTTP error responses', async () => {
    const testCases = [
      { message: 'Unauthorized', status: 401 },
      { message: 'Invalid input', status: 400 },
      { message: 'Access denied', status: 403 },
    ]

    for (const { message, status } of testCases) {
      const response = errorResponse(message, status)
      assertEquals(response.status, status)
      assertEquals(await response.json(), { error: message })
    }
  })

  await t.step('includes CORS headers', () => {
    const response = errorResponse('Test error', 400)
    assertHasCorsHeaders(response)
  })
})

// ============================================================================
// handleCorsPreflightRequest Tests
// ============================================================================

Deno.test('handleCorsPreflightRequest', async (t) => {
  await t.step('returns Response for OPTIONS request', () => {
    const response = handleCorsPreflightRequest(createMockOptionsRequest())

    assertExists(response)
    assertEquals(response!.status, 200)
    assertHasCorsHeaders(response!)
  })

  await t.step('returns null for non-OPTIONS requests', () => {
    const methods = ['POST', 'GET', 'PUT', 'DELETE']

    for (const method of methods) {
      const response = handleCorsPreflightRequest(createMockRequest(method))
      assertEquals(response, null, `Expected null for ${method} request`)
    }
  })
})

// ============================================================================
// generateJoinCode Tests
// ============================================================================

Deno.test('generateJoinCode', async (t) => {
  await t.step('generates a 6-character code by default', () => {
    const code = generateJoinCode()
    assertEquals(code.length, 6)
  })

  await t.step('generates codes of custom length', () => {
    assertEquals(generateJoinCode(4).length, 4)
    assertEquals(generateJoinCode(8).length, 8)
    assertEquals(generateJoinCode(12).length, 12)
  })

  await t.step('generates only valid characters (excludes ambiguous)', () => {
    // Generate multiple codes and verify they only contain valid characters
    const validChars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    for (let i = 0; i < 100; i++) {
      const code = generateJoinCode()
      for (const char of code) {
        assertEquals(
          validChars.includes(char),
          true,
          `Code "${code}" contains invalid character "${char}"`
        )
      }
    }
  })

  await t.step('does not include ambiguous characters (0, O, I, 1, L)', () => {
    const ambiguousChars = ['0', 'O', 'I', '1', 'L']
    // Generate many codes to statistically check
    for (let i = 0; i < 100; i++) {
      const code = generateJoinCode()
      for (const ambiguous of ambiguousChars) {
        assertEquals(
          code.includes(ambiguous),
          false,
          `Code "${code}" contains ambiguous character "${ambiguous}"`
        )
      }
    }
  })

  await t.step('generates unique codes (statistically)', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 100; i++) {
      codes.add(generateJoinCode())
    }
    // With 29^6 possible codes, 100 codes should all be unique
    assertEquals(codes.size, 100, 'Expected 100 unique codes')
  })
})

// ============================================================================
// isValidJoinCode Tests
// ============================================================================

Deno.test('isValidJoinCode', async (t) => {
  await t.step('returns true for valid 6-character codes', () => {
    const validCodes = ['ABC234', 'XYZHKM', '234567', 'ABCDEF', 'QRSTUV']
    for (const code of validCodes) {
      assertEquals(isValidJoinCode(code), true, `Expected "${code}" to be valid`)
    }
  })

  await t.step('returns true for lowercase codes (case-insensitive)', () => {
    assertEquals(isValidJoinCode('abc234'), true)
    assertEquals(isValidJoinCode('xyzHKM'), true)
    assertEquals(isValidJoinCode('AbCdEf'), true)
  })

  await t.step('returns false for codes with ambiguous characters', () => {
    const invalidCodes = ['ABC0DE', 'ABCO12', 'ABCI34', 'ABC1EF', 'ABCL23']
    for (const code of invalidCodes) {
      assertEquals(isValidJoinCode(code), false, `Expected "${code}" to be invalid (contains ambiguous char)`)
    }
  })

  await t.step('returns false for wrong length codes', () => {
    assertEquals(isValidJoinCode('ABC23'), false)   // 5 chars
    assertEquals(isValidJoinCode('ABC2345'), false) // 7 chars
    assertEquals(isValidJoinCode('AB'), false)      // 2 chars
    assertEquals(isValidJoinCode(''), false)        // empty
  })

  await t.step('returns false for codes with invalid characters', () => {
    assertEquals(isValidJoinCode('ABC-23'), false)  // dash
    assertEquals(isValidJoinCode('ABC 23'), false)  // space
    assertEquals(isValidJoinCode('ABC@23'), false)  // special char
  })

  await t.step('validates codes generated by generateJoinCode', () => {
    // Every code generated should be valid
    for (let i = 0; i < 100; i++) {
      const code = generateJoinCode()
      assertEquals(isValidJoinCode(code), true, `Generated code "${code}" should be valid`)
    }
  })
})

// ============================================================================
// isServiceRoleRequest / authenticateUserOrServiceRole Tests
//
// Stubbed Auth HTTP responses exercise the real SDK's error classification.
// Real JWT validation also lives in tests/movie-endpoints-auth.test.ts.
// ============================================================================

const TEST_SERVICE_ROLE_KEY = 'test-service-role-key-abcdef0123456789'

function requestWithAuthorization(authorization?: string): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
  })
}

/** Runs `body` with SUPABASE_SERVICE_ROLE_KEY set, restoring the env after. */
async function withServiceRoleKey(key: string | null, body: () => void | Promise<void>) {
  const previous = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (key === null) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
  else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', key)
  try {
    await body()
  } finally {
    if (previous === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previous)
  }
}

Deno.test('isServiceRoleRequest', async (t) => {
  await t.step('accepts the service role key as a bearer token', async () => {
    await withServiceRoleKey(TEST_SERVICE_ROLE_KEY, () => {
      assertEquals(
        isServiceRoleRequest(requestWithAuthorization(`Bearer ${TEST_SERVICE_ROLE_KEY}`)),
        true
      )
    })
  })

  await t.step('rejects other tokens, malformed headers, and no header', async () => {
    await withServiceRoleKey(TEST_SERVICE_ROLE_KEY, () => {
      assertEquals(isServiceRoleRequest(requestWithAuthorization()), false)
      assertEquals(isServiceRoleRequest(requestWithAuthorization('Bearer anon-key')), false)
      // Right secret, wrong scheme / no scheme.
      assertEquals(isServiceRoleRequest(requestWithAuthorization(TEST_SERVICE_ROLE_KEY)), false)
      assertEquals(
        isServiceRoleRequest(requestWithAuthorization(`Basic ${TEST_SERVICE_ROLE_KEY}`)),
        false
      )
      // A prefix of the key must not pass -- the comparison is length-aware.
      assertEquals(
        isServiceRoleRequest(requestWithAuthorization(`Bearer ${TEST_SERVICE_ROLE_KEY.slice(0, -1)}`)),
        false
      )
    })
  })

  await t.step('never authorizes when SUPABASE_SERVICE_ROLE_KEY is unset', async () => {
    await withServiceRoleKey(null, () => {
      assertEquals(isServiceRoleRequest(requestWithAuthorization('Bearer ')), false)
      assertEquals(isServiceRoleRequest(requestWithAuthorization('Bearer undefined')), false)
    })
  })
})

Deno.test('authenticateUserOrServiceRole', async (t) => {
  await t.step('lets a service role caller through', async () => {
    await withServiceRoleKey(TEST_SERVICE_ROLE_KEY, async () => {
      const result = await authenticateUserOrServiceRole(
        requestWithAuthorization(`Bearer ${TEST_SERVICE_ROLE_KEY}`)
      )
      assertEquals(result, null)
    })
  })

  await t.step('returns the standard 401 when no Authorization header is sent', async () => {
    await withServiceRoleKey(TEST_SERVICE_ROLE_KEY, async () => {
      const result = await authenticateUserOrServiceRole(requestWithAuthorization())

      assertExists(result)
      assertEquals(result!.status, 401)
      assertEquals(await result!.json(), { error: 'Unauthorized' })
      assertHasCorsHeaders(result!)
    })
  })
})

Deno.test({
  name: 'authenticateRequest distinguishes rejected credentials from Auth outages',
  sanitizeResources: false, // The real SDK clients own auth refresh intervals.
  sanitizeOps: false,
  fn: async (t) => {
    const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const
    const previous = keys.map(key => Deno.env.get(key))
    Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:1')
    Deno.env.set('SUPABASE_ANON_KEY', 'unit-test-anon-key')
    try {
      await t.step('missing credentials fail without contacting Auth', async () => {
        const { calls, restore } = stubFetch(() => { throw new Error('Auth must not be called') })
        try {
          const result = await authenticateRequest(requestWithAuthorization())
          assertEquals(result instanceof Response, true)
          assertEquals((result as Response).status, 401)
          assertEquals(await (result as Response).json(), { error: 'Unauthorized' })
          assertEquals(calls.length, 0)
        } finally { restore() }
      })

      await t.step('valid credentials return the verified user', async () => {
        const { calls, restore } = stubFetch(() => Response.json({ id: VALID_UUID, aud: 'authenticated' }))
        try {
          const result = await authenticateRequest(requestWithAuthorization('Bearer test-user-token'))
          if (result instanceof Response) throw new Error(`Unexpected status ${result.status}`)
          assertEquals(result.user.id, VALID_UUID)
          assertEquals(calls.length, 1)
          assertEquals(calls[0].url, 'http://127.0.0.1:1/auth/v1/user')
          await result.supabase.auth.stopAutoRefresh()
        } finally { restore() }
      })

      await t.step('invalid and expired credentials keep the standard 401', async () => {
        for (const status of [401, 403]) {
          const { restore } = stubFetch(() => Response.json({ message: 'Invalid or expired token' }, { status }))
          try {
            const result = await authenticateRequest(requestWithAuthorization('Bearer rejected-token'))
            assertEquals(result instanceof Response, true)
            assertEquals((result as Response).status, 401)
            assertEquals(await (result as Response).json(), { error: 'Unauthorized' })
          } finally { restore() }
        }
      })

      await t.step('Auth 5xx and network failures return safe retryable errors', async () => {
        for (const status of [500, 502, 503, 504, 0]) {
          const { calls, restore } = stubFetch(() => {
            if (status === 0) throw new TypeError('unit-test network failure')
            return Response.json({ message: 'private upstream diagnostic' }, { status })
          })
          const originalConsoleError = console.error
          const logs: unknown[] = []
          console.error = (...args: unknown[]) => { logs.push(...args) }
          try {
            const req = requestWithAuthorization('Bearer test-user-token')
            handleCorsPreflightRequest(req)
            const result = await authenticateUserOrServiceRole(req)
            assertExists(result)
            assertEquals(result.status, 503)
            assertHasCorsHeaders(result)
            const requestId = result.headers.get('X-Request-Id')
            assertExists(requestId)
            assertEquals(await result.json(), {
              error: 'Authentication service is temporarily unavailable. Please try again.',
              request_id: requestId,
            })
            assertEquals(calls.length, 1)
            const entry = logs.filter((value): value is string => typeof value === 'string')
              .map(value => JSON.parse(value)).find(value => value.fn === 'auth')
            assertExists(entry)
            assertEquals(entry.level, 'error')
            assertEquals(entry.status, status)
            assertEquals(entry.request_id, requestId)
            assertEquals('message' in entry, false)
            assertEquals(JSON.stringify(entry).includes('test-user-token'), false)
            assertEquals(JSON.stringify(entry).includes('private upstream diagnostic'), false)
          } finally {
            console.error = originalConsoleError
            restore()
          }
        }
      })
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) Deno.env.delete(key)
        else Deno.env.set(key, previous[index]!)
      })
    }
  },
})

// ============================================================================
// isUpcomingMovie -- season-relative draft/bid eligibility
// ============================================================================

Deno.test('isUpcomingMovie', async (t) => {
  // Fixed rather than derived from today: a relative fixture would stop
  // exercising the season-vs-wall-clock distinction on the days they agree.
  const THIS_YEAR = new Date().getFullYear()
  const NEXT_YEAR = THIS_YEAR + 1

  await t.step('rejects a movie with no release date', () => {
    assertEquals(isUpcomingMovie(null, THIS_YEAR), {
      valid: false,
      reason: 'Movie has no release date',
    })
    assertEquals(isUpcomingMovie(undefined, THIS_YEAR).valid, false)
    assertEquals(isUpcomingMovie('', THIS_YEAR).valid, false)
  })

  await t.step('rejects a movie from a year before the season', () => {
    const result = isUpcomingMovie(`${THIS_YEAR - 1}-06-15`, THIS_YEAR)
    assertEquals(result.valid, false)
    assertEquals(result.reason, 'Movie was released in a previous season')
  })

  await t.step('rejects an unparseable release year', () => {
    assertEquals(isUpcomingMovie('not-a-date', THIS_YEAR).valid, false)
  })

  await t.step('rejects a movie that is already out, even in its own season', () => {
    const result = isUpcomingMovie(`${THIS_YEAR}-01-01`, THIS_YEAR)
    assertEquals(result.valid, false)
    assertEquals(result.reason, 'Movie has already been released')
  })

  await t.step('accepts a movie still to come', () => {
    assertEquals(isUpcomingMovie(`${NEXT_YEAR}-06-15`, THIS_YEAR), { valid: true })
  })

  // The whole point of the season_year parameter: a season that runs past
  // New Year keeps judging its own movies, and one that has not started yet
  // does not accept last year\'s leftovers.
  await t.step('keys the year cutoff off the season, not the wall clock', () => {
    // A movie from this calendar year, seen by a season labelled next year:
    // out of season, even though the calendar has not moved.
    assertEquals(
      isUpcomingMovie(`${THIS_YEAR}-12-31`, NEXT_YEAR).reason,
      'Movie was released in a previous season',
    )

    // The same movie, seen by a season two years back, clears the year cutoff
    // and is judged only on whether it has actually released.
    assertEquals(isUpcomingMovie(`${NEXT_YEAR}-12-31`, THIS_YEAR - 1), { valid: true })
  })
})
