import { proxyCronRequest } from '../_lib/proxyCronRequest'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  return proxyCronRequest(request, 'complete-seasons')
}
