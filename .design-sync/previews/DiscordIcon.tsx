import { DiscordIcon } from 'fantasy-reel'

/** Inherits colour from `currentColor`, so it takes on whatever the parent sets. */
export const Sizes = () => (
  <div className="flex items-center gap-6 text-foreground">
    <DiscordIcon className="w-4 h-4" />
    <DiscordIcon className="w-6 h-6" />
    <DiscordIcon className="w-10 h-10" />
  </div>
)

export const Colours = () => (
  <div className="flex items-center gap-6">
    <DiscordIcon className="w-8 h-8 text-foreground" />
    <DiscordIcon className="w-8 h-8 text-gold" />
    <DiscordIcon className="w-8 h-8 text-foreground-muted" />
  </div>
)

/** Where it is actually used: the Discord OAuth entry point. */
export const OnAButton = () => (
  <button className="btn btn-secondary gap-2">
    <DiscordIcon className="w-5 h-5" />
    Continue with Discord
  </button>
)
