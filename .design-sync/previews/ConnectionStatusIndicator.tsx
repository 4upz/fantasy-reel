import { ConnectionStatusIndicator } from 'fantasy-reel'

/** All four realtime states. Green is live; amber is in flight; red is degraded
    to polling. */
export const States = () => (
  <div className="flex flex-col items-start gap-3">
    <ConnectionStatusIndicator status="connected" />
    <ConnectionStatusIndicator status="connecting" />
    <ConnectionStatusIndicator status="reconnecting" />
    <ConnectionStatusIndicator status="error" />
  </div>
)

/** The pill is a flex block, so give it a flex parent — a plain block parent
    stretches it to full width. */
export const Connected = () => (
  <div className="flex items-start">
    <ConnectionStatusIndicator status="connected" />
  </div>
)

/** Where it actually sits: trailing a draft board header. */
export const InAHeader = () => (
  <div className="flex items-center justify-between max-w-lg p-3 rounded-lg bg-surface border border-border">
    <h3 className="font-display font-semibold text-foreground">Round 3 · Pick 5</h3>
    <ConnectionStatusIndicator status="connected" />
  </div>
)
