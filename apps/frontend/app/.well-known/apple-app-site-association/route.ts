import { appleAppSiteAssociation } from '@/utils/app-links'

// Served at /.well-known/apple-app-site-association with no extension, as
// Apple requires. Must answer 200 JSON with no redirect, so the middleware
// matcher skips `.well-known`.
export const dynamic = 'force-static'

export function GET() {
  return Response.json(appleAppSiteAssociation)
}
