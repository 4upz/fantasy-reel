/**
 * Per-request state for the current Edge Function invocation: the inbound
 * Request (used to compute CORS headers) and a request ID for tracing.
 *
 * Module-level state -- safe because each Edge Function isolate handles one
 * request at a time.
 */

let _currentRequest: Request | undefined
let _requestId: string

export function setRequestContext(req: Request): void {
  _currentRequest = req
  _requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
}

export function getCurrentRequest(): Request | undefined {
  return _currentRequest
}

/**
 * The current request's ID. If setRequestContext was never called (an entry
 * point forgot to), lazily generates and stores one so callers always get a
 * usable ID.
 */
export function getRequestId(): string {
  if (!_requestId) {
    _requestId = crypto.randomUUID()
  }
  return _requestId
}
