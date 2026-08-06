import { LockedMessage, SectionHeader } from 'fantasy-reel'
import { Gavel } from 'lucide-react'

/** Explains why a section is read-only. Always say what would unlock it. */
export const Default = () => (
  <div className="max-w-lg">
    <LockedMessage message="Draft settings are locked once the draft has started." />
  </div>
)

export const Reasons = () => (
  <div className="flex flex-col gap-3 max-w-lg">
    <LockedMessage message="Draft settings are locked once the draft has started." />
    <LockedMessage message="Only the league owner can change these settings." />
    <LockedMessage message="Bidding cannot be reconfigured while a bid window is open." />
  </div>
)

/** In situ: the pairing it is designed for — a locked SectionHeader above it. */
export const UnderALockedHeader = () => (
  <div className="max-w-lg card p-6">
    <SectionHeader
      icon={Gavel}
      title="Draft Settings"
      description="Draft type, rounds and pick timer."
      isLocked
    />
    <LockedMessage message="Draft settings are locked once the draft has started." />
  </div>
)
