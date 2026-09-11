import { addBreadcrumb } from '@/utils/sentry'

// SDK diagnostics can contain URLs or JWTs. Record bounded error text only,
// never subscribe/push/receive payloads or connection URLs (which contain keys).
export function realtimeErrorText(value: unknown): string | undefined {
  const message = value && typeof value === 'object' && 'message' in value ? value.message : value
  const text = typeof message === 'string' ? message : undefined
  return text?.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(apikey|access_token|token|authorization)["\s:=]+[^\s&,"}]+/gi, '$1=[redacted]')
    .slice(0, 300)
}

export const realtimeDiagnostics = {
  heartbeatCallback(status: string, latency?: number) {
    addBreadcrumb({
      category: 'realtime.heartbeat',
      message: status,
      level: status === 'timeout' || status === 'error' ? 'warning' : 'info',
      data: { latency_ms: latency, visibility: typeof document === 'undefined' ? undefined : document.visibilityState },
    })
  },
  logger(kind: string, message: string, data?: unknown) {
    if (kind !== 'transport') return
    if (message === 'close' && data && typeof data === 'object') {
      const event = data as { code?: number; reason?: string; wasClean?: boolean }
      addBreadcrumb({
        category: 'realtime.transport', message: 'closed', level: 'warning',
        data: { code: event.code, reason: realtimeErrorText(event.reason), was_clean: event.wasClean },
      })
    } else if (message.startsWith('connected to ')) {
      addBreadcrumb({ category: 'realtime.transport', message: 'connected', level: 'info' })
    } else if (message.startsWith('heartbeat timeout')) {
      addBreadcrumb({ category: 'realtime.transport', message: 'heartbeat timeout', level: 'warning' })
    }
  },
}
