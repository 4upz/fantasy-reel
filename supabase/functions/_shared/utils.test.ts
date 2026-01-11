/**
 * Unit tests for shared utility functions
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
import {
  validUUID,
  invalidUUIDs,
  validEmails,
  invalidEmails,
} from '../_test_utils/fixtures.ts'
import { createMockRequest, createMockOptionsRequest } from '../_test_utils/mocks.ts'

// ============================================================================
// isValidUUID Tests
// ============================================================================

Deno.test('isValidUUID', async (t) => {
  await t.step('returns true for valid UUIDs', () => {
    assertEquals(isValidUUID(validUUID), true)
    assertEquals(isValidUUID('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'), true)
    assertEquals(isValidUUID('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'), true) // uppercase
    assertEquals(isValidUUID('550e8400-e29b-41d4-a716-446655440000'), true)
  })

  await t.step('returns false for invalid UUIDs', () => {
    for (const invalid of invalidUUIDs) {
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
    for (const email of validEmails) {
      assertEquals(isValidEmail(email), true, `Expected "${email}" to be valid`)
    }
  })

  await t.step('returns false for invalid emails', () => {
    for (const email of invalidEmails) {
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

    const body = await response.json()
    assertEquals(body, data)
  })

  await t.step('creates response with custom status', async () => {
    const data = { id: '123', created: true }
    const response = jsonResponse(data, 201)

    assertEquals(response.status, 201)

    const body = await response.json()
    assertEquals(body, data)
  })

  await t.step('includes CORS headers', () => {
    const response = jsonResponse({ test: true })

    for (const [header, value] of Object.entries(corsHeaders)) {
      assertEquals(response.headers.get(header), value)
    }
  })

  await t.step('handles complex nested data', async () => {
    const data = {
      league: { id: '123', name: 'Test' },
      participants: [{ id: '1' }, { id: '2' }],
      meta: { count: 2, page: 1 },
    }
    const response = jsonResponse(data)

    const body = await response.json()
    assertEquals(body, data)
  })

  await t.step('handles null and empty data', async () => {
    assertEquals((await jsonResponse(null).json()), null)
    assertEquals((await jsonResponse({}).json()), {})
    assertEquals((await jsonResponse([]).json()), [])
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
    assertEquals(body, { error: 'Something went wrong' })
  })

  await t.step('creates error response with custom status', async () => {
    const response = errorResponse('Not found', 404)

    assertEquals(response.status, 404)

    const body = await response.json()
    assertEquals(body, { error: 'Not found' })
  })

  await t.step('creates common error responses', async () => {
    const unauthorized = errorResponse('Unauthorized', 401)
    assertEquals(unauthorized.status, 401)
    assertEquals((await unauthorized.json()), { error: 'Unauthorized' })

    const badRequest = errorResponse('Invalid input', 400)
    assertEquals(badRequest.status, 400)
    assertEquals((await badRequest.json()), { error: 'Invalid input' })

    const forbidden = errorResponse('Access denied', 403)
    assertEquals(forbidden.status, 403)
    assertEquals((await forbidden.json()), { error: 'Access denied' })
  })

  await t.step('includes CORS headers', () => {
    const response = errorResponse('Test error', 400)

    for (const [header, value] of Object.entries(corsHeaders)) {
      assertEquals(response.headers.get(header), value)
    }
  })
})

// ============================================================================
// handleCorsPreflightRequest Tests
// ============================================================================

Deno.test('handleCorsPreflightRequest', async (t) => {
  await t.step('returns Response for OPTIONS request', () => {
    const optionsRequest = createMockOptionsRequest()
    const response = handleCorsPreflightRequest(optionsRequest)

    assertExists(response)
    assertEquals(response!.status, 200)
  })

  await t.step('returns null for non-OPTIONS requests', () => {
    const postRequest = createMockRequest({ method: 'POST' })
    const getRequest = createMockRequest({ method: 'GET' })
    const putRequest = createMockRequest({ method: 'PUT' })
    const deleteRequest = createMockRequest({ method: 'DELETE' })

    assertEquals(handleCorsPreflightRequest(postRequest), null)
    assertEquals(handleCorsPreflightRequest(getRequest), null)
    assertEquals(handleCorsPreflightRequest(putRequest), null)
    assertEquals(handleCorsPreflightRequest(deleteRequest), null)
  })

  await t.step('includes CORS headers in preflight response', () => {
    const optionsRequest = createMockOptionsRequest()
    const response = handleCorsPreflightRequest(optionsRequest)

    assertExists(response)
    for (const [header, value] of Object.entries(corsHeaders)) {
      assertEquals(response!.headers.get(header), value)
    }
  })
})
