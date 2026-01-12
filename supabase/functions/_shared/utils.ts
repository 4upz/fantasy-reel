import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from './cors.ts'

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

/**
 * Result of authenticating a request
 */
export interface AuthResult {
  user: User
  supabase: SupabaseClient
}

/**
 * Create an authenticated Supabase client and get the current user.
 * Returns an error response if authentication fails.
 */
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

/**
 * Type guard to check if auth result is an error response
 */
export function isAuthError(result: AuthResult | Response): result is Response {
  return result instanceof Response
}

/**
 * Check if an invitation is expired
 */
export function isInvitationExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date()
}

/**
 * Create an error response with CORS headers
 */
export function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

/**
 * Validate UUID format
 */
export function isValidUUID(id: string): boolean {
  if (!id) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Handle CORS preflight request
 */
export function handleCorsPreflightRequest(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

/**
 * Result of validating a movie's eligibility for drafting
 */
export interface DraftEligibilityResult {
  valid: boolean
  reason?: string
}

/**
 * Validates that a movie is eligible for drafting based on its release date.
 * Movies must:
 * - Have a release date
 * - Be from the current year or later
 * - Not have been released yet (release_date >= today)
 */
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
