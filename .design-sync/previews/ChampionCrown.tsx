import { ChampionCrown } from 'fantasy-reel'

/** Sized for a name row: 14px, monochrome, with a screen-reader label. */
export const Default = () => (
  <div className="flex items-center gap-2">
    <span className="font-display font-semibold text-foreground">Academy Aces</span>
    <ChampionCrown seasonYear={2026} />
  </div>
)
