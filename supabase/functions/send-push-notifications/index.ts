import { createServiceClient, errorResponse, handleCorsPreflightRequest, internalErrorResponse, isAuthorizedCronRequest, jsonResponse } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun } from '../_shared/job-runs.ts'
import { apnsCredentialsFromEnv, sendPushNotifications } from '../_shared/push-notifications.ts'

const log = createLogger('send-push-notifications')
Deno.serve(async req => {
  const cors = handleCorsPreflightRequest(req)
  if (cors) return cors
  if (!isAuthorizedCronRequest(req)) return errorResponse('Forbidden', 403)
  const run = startJobRun('send-push-notifications')
  let client: ReturnType<typeof createServiceClient> | undefined
  try {
    client = createServiceClient()
    const result = await sendPushNotifications(client, apnsCredentialsFromEnv())
    const job_status = await run.finish(client, result)
    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (client) await run.fail(client, error)
    return internalErrorResponse(error, log)
  }
})
