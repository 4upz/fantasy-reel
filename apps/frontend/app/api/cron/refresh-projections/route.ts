import { proxyCronRequest } from '../_lib/proxyCronRequest'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Daily: re-project league movies with the active model (no refit, no API quota). */
export async function GET(request: Request): Promise<Response> {
  return proxyCronRequest(request, 'fit-projection-model', { mode: 'refresh' })
}
