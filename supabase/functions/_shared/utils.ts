import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, getCorsHeaders } from './cors.ts'

/**
 * Create a service role Supabase client for admin operations.
 * Bypasses RLS — use only in Edge Functions for operations requiring elevated access.
 */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url) throw new Error('Missing SUPABASE_URL environment variable')
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  return createClient(url, key)
}

let _currentRequest: Request | undefined

export function setRequestContext(req: Request): void {
  _currentRequest = req
}

function getCurrentCorsHeaders(): Record<string, string> {
  if (_currentRequest) {
    return getCorsHeaders(_currentRequest)
  }
  return corsHeaders
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCurrentCorsHeaders(), 'Content-Type': 'application/json' }
  })
}

export interface AuthResult {
  user: User
  supabase: SupabaseClient
}

export async function authenticateRequest(req: Request): Promise<AuthResult | Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: { Authorization: req.headers.get('Authorization')! },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return errorResponse('Unauthorized', 401)
  }

  return { user, supabase }
}

export function isAuthError(result: AuthResult | Response): result is Response {
  return result instanceof Response
}

export function isInvitationExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date()
}

export function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...getCurrentCorsHeaders(), 'Content-Type': 'application/json' }
  })
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidUUID(id: string): boolean {
  return Boolean(id) && UUID_REGEX.test(id)
}

export function isValidEmail(email: string): boolean {
  return Boolean(email) && EMAIL_REGEX.test(email)
}

export function handleCorsPreflightRequest(req: Request): Response | null {
  setRequestContext(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  return null
}

export interface DraftEligibilityResult {
  valid: boolean
  reason?: string
}

export function isUpcomingMovie(releaseDate: string | null | undefined): DraftEligibilityResult {
  if (!releaseDate) {
    return { valid: false, reason: 'Movie has no release date' }
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const today = now.toISOString().split('T')[0]

  const releaseYear = parseInt(releaseDate.split('-')[0], 10)
  if (isNaN(releaseYear) || releaseYear < currentYear) {
    return { valid: false, reason: 'Movie was released in a previous year' }
  }

  if (releaseDate < today) {
    return { valid: false, reason: 'Movie has already been released' }
  }

  return { valid: true }
}

// Characters for join codes - excludes ambiguous chars (0, O, I, 1, L)
const JOIN_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateJoinCode(length = 6): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)]
  }
  return code
}

const JOIN_CODE_REGEX = /^[A-HJ-KM-NP-Z2-9]{6}$/

export function isValidJoinCode(code: string): boolean {
  return Boolean(code) && JOIN_CODE_REGEX.test(code.toUpperCase())
}
