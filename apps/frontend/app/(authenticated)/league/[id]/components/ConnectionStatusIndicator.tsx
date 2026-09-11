export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'polling' | 'error'

const STATUS_CONFIG: Record<RealtimeStatus, { dot: string; text: string; textColor: string; title: string }> = {
  connecting: {
    dot: 'bg-warning animate-pulse',
    text: 'Connecting...',
    textColor: 'text-warning',
    title: 'Connecting to real-time updates...',
  },
  connected: {
    dot: 'bg-success',
    text: 'Live',
    textColor: 'text-success',
    title: 'Real-time updates active',
  },
  reconnecting: {
    dot: 'bg-warning animate-pulse',
    text: 'Reconnecting...',
    textColor: 'text-warning',
    title: 'Reconnecting to real-time updates...',
  },
  polling: {
    dot: 'bg-warning',
    text: 'Periodic updates',
    textColor: 'text-warning',
    title: 'Live connection unavailable. Checking the complete draft every 10 seconds.',
  },
  error: {
    dot: 'bg-error',
    text: 'Disconnected',
    textColor: 'text-error',
    title: 'Connection lost - updates via polling',
  },
}

interface Props {
  status: RealtimeStatus
}

/** @design-system Feedback */
export default function ConnectionStatusIndicator({ status }: Props): React.ReactElement {
  const config = STATUS_CONFIG[status]

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface border border-border"
      title={config.title}
      role="status"
      aria-live="polite"
      data-testid="draft-connection-status"
    >
      <span className={`w-2 h-2 rounded-full ${config.dot}`} />
      <span className={`type-meta ${config.textColor}`}>{config.text}</span>
    </div>
  )
}
