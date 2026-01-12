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
    assertEquals(await response.json(), { error: 'Something went wrong' })
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
