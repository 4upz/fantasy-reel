import { NavLogo } from 'fantasy-reel'

/** The approved film-conversation symbol and outlined Bricolage wordmark.
    Keep the vector lockup intact rather than resetting its lettering. */
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
    <div className="flex items-center gap-4 type-control text-foreground-secondary">
      <span>Dashboard</span>
      <span>Movies</span>
      <span className="text-gold">My league</span>
    </div>
  </div>
)
