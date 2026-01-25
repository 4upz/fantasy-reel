const PRODUCTION_ORIGINS = [
  'https://fantasyreel.com',
  'https://www.fantasyreel.com',
  'https://fantasy-reel.vercel.app',
]

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]

function isLocalDevelopment(): boolean {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  return supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')
}

function getAllowedOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) {
    return PRODUCTION_ORIGINS[0]
  }

  if (PRODUCTION_ORIGINS.includes(requestOrigin)) {
    return requestOrigin
  }

  if (isLocalDevelopment() && DEV_ORIGINS.includes(requestOrigin)) {
    return requestOrigin
  }

  return PRODUCTION_ORIGINS[0]
}

export function getCorsHeaders(request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(request.headers.get('origin')),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  }
}

/**
 * @deprecated Use getCorsHeaders(request) for proper origin validation.
 * This static export defaults to production origin for backward compatibility.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': PRODUCTION_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}