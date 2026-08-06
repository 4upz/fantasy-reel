import { SectionHeader } from 'fantasy-reel'
import { Settings, Users, Gavel } from 'lucide-react'

/** Takes a lucide icon component as `icon` — pass the component, not an element. */
export const Default = () => (
  <div className="max-w-lg">
    <SectionHeader
      icon={Settings}
      title="League Info"
      description="Name, description and visibility for this league."
    />
  </div>
)

/** `isLocked` swaps the icon for a padlock and drops the gold tint — use it
    when the league phase makes the section read-only. */
export const Locked = () => (
  <div className="max-w-lg">
    <SectionHeader
      icon={Gavel}
      title="Draft Settings"
      description="Draft type, rounds and pick timer."
      isLocked
    />
  </div>
)

export const UnlockedVsLocked = () => (
  <div className="max-w-lg">
    <SectionHeader icon={Users} title="Participants" description="Who is in this league." />
    <SectionHeader
      icon={Gavel}
      title="Draft Settings"
      description="Draft type, rounds and pick timer."
      isLocked
    />
  </div>
)

/** In situ: heading a settings card. */
export const OnASettingsCard = () => (
  <div className="max-w-lg card p-6">
    <SectionHeader
      icon={Settings}
      title="League Info"
      description="Name, description and visibility for this league."
    />
    <label className="block text-sm font-medium text-foreground mb-2">League name</label>
    <input className="input w-full" defaultValue="Summer Blockbusters" />
  </div>
)
