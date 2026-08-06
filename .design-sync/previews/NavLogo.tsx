import { NavLogo } from 'fantasy-reel'

/** The film-reel mark and wordmark. "Fantasy" is bold, "Reel" light — the
    contrast is the wordmark, do not re-set it. */
export const Default = () => (
  <div className="flex items-start">
    <NavLogo />
  </div>
)

/** The mark links to the dashboard by default; point it elsewhere with `href`. */
export const CustomTarget = () => (
  <div className="flex items-start">
    <NavLogo href="/" />
  </div>
)

/** In situ: leading a top navigation bar. */
export const InANavBar = () => (
  <div className="flex items-center justify-between max-w-2xl px-4 py-3 rounded-lg bg-surface border border-border">
    <NavLogo />
    <div className="flex items-center gap-4 text-sm text-foreground-secondary">
      <span>Dashboard</span>
      <span>Movies</span>
      <span className="text-gold">My League</span>
    </div>
  </div>
)
