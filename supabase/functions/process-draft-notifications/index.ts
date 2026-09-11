import { createServiceClient, errorResponse, handleCorsPreflightRequest, internalErrorResponse, isAuthorizedCronRequest, jsonResponse } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun } from '../_shared/job-runs.ts'
import { processDraftNotifications } from '../_shared/draft-notifications.ts'

const log = createLogger('process-draft-notifications')
Deno.serve(async req => {
  const cors = handleCorsPreflightRequest(req)
  if (cors) return cors
  if (!isAuthorizedCronRequest(req)) return errorResponse('Forbidden', 403)
  const run = startJobRun('process-draft-notifications')
  let client: ReturnType<typeof createServiceClient> | undefined
  try {
    client = createServiceClient()
    const result = await processDraftNotifications(client)
    const job_status = await run.finish(client, result)
    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (client) await run.fail(client, error)
    return internalErrorResponse(error, log)
  }
})
