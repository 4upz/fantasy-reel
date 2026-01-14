import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  buildInvitationEmailHtml,
  buildInvitationEmailText,
  sendInvitationEmail,
  type InvitationEmailData,
} from './email.ts'

// Test data
const mockEmailData: InvitationEmailData = {
  recipientEmail: 'test@example.com',
  inviterName: 'John Doe',
  leagueName: 'Movie Masters 2026',
  inviteUrl: 'http://localhost:3000/join?token=abc-123',
  expiresAt: '2026-01-21T00:00:00Z',
}

// Store original env and fetch for restoration
const originalEnv = Deno.env.get
const originalFetch = globalThis.fetch

function mockEnv(vars: Record<string, string | undefined>) {
  Deno.env.get = (key: string) => vars[key]
}

function restoreEnv() {
  Deno.env.get = originalEnv
}

function mockFetch(response: Response | (() => Response)) {
  globalThis.fetch = () => Promise.resolve(typeof response === 'function' ? response() : response)
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

// =============================================================================
// HTML Template Tests
// =============================================================================

Deno.test('buildInvitationEmailHtml - includes all required content', () => {
  const html = buildInvitationEmailHtml(mockEmailData)

  assertStringIncludes(html, 'FANTASY REEL')
  assertStringIncludes(html, "You're Invited!")
  assertStringIncludes(html, 'John Doe')
  assertStringIncludes(html, 'Movie Masters 2026')
  assertStringIncludes(html, 'http://localhost:3000/join?token=abc-123')
  assertStringIncludes(html, 'Join League')
})

Deno.test('buildInvitationEmailHtml - uses Cinematic Dark theme colors', () => {
  const html = buildInvitationEmailHtml(mockEmailData)

  // Check theme colors are present
  assertStringIncludes(html, '#0f0f0f') // background
  assertStringIncludes(html, '#1c1c1c') // surface
  assertStringIncludes(html, '#c9a227') // gold
  assertStringIncludes(html, '#e8e8e8') // foreground
  assertStringIncludes(html, '#b8b0a4') // foreground-secondary
})

Deno.test('buildInvitationEmailHtml - formats expiration date', () => {
  const html = buildInvitationEmailHtml(mockEmailData)

  // Should contain formatted date (Tuesday, January 21, 2026)
  assertStringIncludes(html, 'January')
  assertStringIncludes(html, '2026')
})

Deno.test('buildInvitationEmailHtml - escapes HTML in user content', () => {
  const dataWithHtml: InvitationEmailData = {
    ...mockEmailData,
    inviterName: '<script>alert("xss")</script>',
    leagueName: 'League & "Friends"',
  }

  const html = buildInvitationEmailHtml(dataWithHtml)

  // Should escape dangerous characters
  assertStringIncludes(html, '&lt;script&gt;')
  assertStringIncludes(html, '&amp;')
  assertStringIncludes(html, '&quot;')
  // Should NOT contain unescaped script tag
  assertEquals(html.includes('<script>'), false)
})

Deno.test('buildInvitationEmailHtml - handles unicode characters', () => {
  const dataWithUnicode: InvitationEmailData = {
    ...mockEmailData,
    inviterName: 'Jean-Pierre Légaré',
    leagueName: 'Ciné-Club Québec',
  }

  const html = buildInvitationEmailHtml(dataWithUnicode)

  assertStringIncludes(html, 'Jean-Pierre Légaré')
  assertStringIncludes(html, 'Ciné-Club Québec')
})

// =============================================================================
// Plain Text Template Tests
// =============================================================================

Deno.test('buildInvitationEmailText - includes all required content', () => {
  const text = buildInvitationEmailText(mockEmailData)

  assertStringIncludes(text, 'FANTASY REEL')
  assertStringIncludes(text, "You're Invited!")
  assertStringIncludes(text, 'John Doe')
  assertStringIncludes(text, 'Movie Masters 2026')
  assertStringIncludes(text, 'http://localhost:3000/join?token=abc-123')
})

Deno.test('buildInvitationEmailText - formats expiration date', () => {
  const text = buildInvitationEmailText(mockEmailData)

  assertStringIncludes(text, 'January')
  assertStringIncludes(text, '2026')
})

Deno.test('buildInvitationEmailText - is readable without HTML', () => {
  const text = buildInvitationEmailText(mockEmailData)

  // Should not contain HTML tags
  assertEquals(text.includes('<'), false)
  assertEquals(text.includes('>'), false)
})

Deno.test('buildInvitationEmailText - sanitizes newlines in user content', () => {
  const dataWithNewlines: InvitationEmailData = {
    ...mockEmailData,
    inviterName: 'Attacker\nInjected',
    leagueName: 'Fake\nLeague',
  }

  const text = buildInvitationEmailText(dataWithNewlines)

  // User content should have newlines replaced with spaces
  // This prevents content from breaking out of its context
  assertStringIncludes(text, 'Attacker Injected')
  assertStringIncludes(text, 'Fake League')
  // Verify no literal newlines within user content (template has its own newlines)
  assertEquals(text.includes('Attacker\n'), false)
  assertEquals(text.includes('Fake\n'), false)
})

// =============================================================================
// sendInvitationEmail Tests
// =============================================================================

Deno.test('sendInvitationEmail - returns error when API key not configured', async () => {
  mockEnv({})

  try {
    const result = await sendInvitationEmail(mockEmailData)

    assertEquals(result.success, false)
    assertEquals(result.error, 'RESEND_API_KEY not configured')
    assertEquals(result.messageId, undefined)
  } finally {
    restoreEnv()
  }
})

Deno.test('sendInvitationEmail - returns success with messageId on 200', async () => {
  mockEnv({
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'Test <test@example.com>',
  })
  mockFetch(new Response(JSON.stringify({ id: 'msg_123456' }), { status: 200 }))

  try {
    const result = await sendInvitationEmail(mockEmailData)

    assertEquals(result.success, true)
    assertEquals(result.messageId, 'msg_123456')
    assertEquals(result.error, undefined)
  } finally {
    restoreEnv()
    restoreFetch()
  }
})

Deno.test('sendInvitationEmail - handles 401 unauthorized error', async () => {
  mockEnv({ RESEND_API_KEY: 're_invalid_key' })
  mockFetch(new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 }))

  try {
    const result = await sendInvitationEmail(mockEmailData)

    assertEquals(result.success, false)
    // Error message should be generic to avoid information disclosure
    assertEquals(result.error, 'Email delivery failed')
  } finally {
    restoreEnv()
    restoreFetch()
  }
})

Deno.test('sendInvitationEmail - handles 429 rate limit error', async () => {
  mockEnv({ RESEND_API_KEY: 're_test_key' })
  mockFetch(new Response(JSON.stringify({ message: 'Rate limit exceeded' }), { status: 429 }))

  try {
    const result = await sendInvitationEmail(mockEmailData)

    assertEquals(result.success, false)
    // Error message should be generic to avoid information disclosure
    assertEquals(result.error, 'Email delivery failed')
  } finally {
    restoreEnv()
    restoreFetch()
  }
})

Deno.test('sendInvitationEmail - handles network errors gracefully', async () => {
  mockEnv({ RESEND_API_KEY: 're_test_key' })
  globalThis.fetch = () => Promise.reject(new Error('Network error'))

  try {
    const result = await sendInvitationEmail(mockEmailData)

    assertEquals(result.success, false)
    // Error message should be generic to avoid information disclosure
    assertEquals(result.error, 'Email delivery unavailable')
  } finally {
    restoreEnv()
    restoreFetch()
  }
})

Deno.test('sendInvitationEmail - rejects invalid recipient email', async () => {
  mockEnv({ RESEND_API_KEY: 're_test_key' })

  const invalidEmailData: InvitationEmailData = {
    ...mockEmailData,
    recipientEmail: 'not-an-email',
  }

  try {
    const result = await sendInvitationEmail(invalidEmailData)

    assertEquals(result.success, false)
    assertEquals(result.error, 'Invalid recipient email')
  } finally {
    restoreEnv()
  }
})

Deno.test('sendInvitationEmail - uses default from email when not configured', async () => {
  let capturedBody: string | undefined

  mockEnv({ RESEND_API_KEY: 're_test_key' }) // No RESEND_FROM_EMAIL
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string
    return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 })
  }

  try {
    await sendInvitationEmail(mockEmailData)

    const body = JSON.parse(capturedBody!)
    assertEquals(body.from, 'Fantasy Reel <noreply@fantasyreels.com>')
  } finally {
    restoreEnv()
    restoreFetch()
  }
})

Deno.test('sendInvitationEmail - sends correct email structure', async () => {
  let capturedBody: string | undefined

  mockEnv({
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'Custom <custom@example.com>',
  })
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string
    return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 })
  }

  try {
    await sendInvitationEmail(mockEmailData)

    const body = JSON.parse(capturedBody!)
    assertEquals(body.from, 'Custom <custom@example.com>')
    assertEquals(body.to, ['test@example.com'])
    assertStringIncludes(body.subject, 'Movie Masters 2026')
    assertStringIncludes(body.subject, 'Fantasy Reel')
    assertStringIncludes(body.html, 'FANTASY REEL')
    assertStringIncludes(body.text, 'FANTASY REEL')
  } finally {
    restoreEnv()
    restoreFetch()
  }
})

Deno.test('sendInvitationEmail - sanitizes header injection attempts in subject', async () => {
  let capturedBody: string | undefined

  mockEnv({ RESEND_API_KEY: 're_test_key' })
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string
    return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 })
  }

  const maliciousData: InvitationEmailData = {
    ...mockEmailData,
    leagueName: 'Fake\nLeague',
  }

  try {
    await sendInvitationEmail(maliciousData)

    const body = JSON.parse(capturedBody!)
    // Subject should not contain newlines (which would allow header injection)
    assertEquals(body.subject.includes('\n'), false)
    assertEquals(body.subject.includes('\r'), false)
    // Should still contain the league name with newline replaced by space
    assertStringIncludes(body.subject, 'Fake League')
  } finally {
    restoreEnv()
    restoreFetch()
  }
})
