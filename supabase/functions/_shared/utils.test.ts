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
} from './utils.ts'
import { corsHeaders } from './cors.ts'

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
