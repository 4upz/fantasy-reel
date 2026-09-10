import Link from 'next/link'
import NavLogo from '../navigation/NavLogo'
import DraftTicker from './DraftTicker'
import type { TickerEntry } from './data'

interface Props {
  tickerEntries: TickerEntry[]
}

export default function HeroSection({ tickerEntries }: Props): React.ReactElement {
  return (
    <section className="hero-gradient film-grain relative min-h-screen flex flex-col">
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 px-6 py-6">
        <NavLogo href="/" />
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="type-control text-foreground-secondary hover:text-gold transition-colors"
          >
            Log in
          </Link>
          <Link href="/signup" className="btn btn-primary">
            Sign up
          </Link>
        </div>
      </header>

      {/* Hero content - centered */}
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="relative z-10 text-center max-w-3xl mx-auto animate-fade-in">
          <h1 className="type-hero text-foreground mb-6">
            Your hot takes, finally worth something.
          </h1>

          <p className="type-lead text-foreground-secondary mb-4 max-w-2xl mx-auto">
            Draft upcoming movies. Outscore your friends when the reviews drop.
          </p>

          <p className="type-body text-foreground-secondary mb-10">
            Finally, a use for your strong opinions about Denis Villeneuve.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup" className="cta-button spotlight-glow">
              Start a league
            </Link>
            <a
              href="#how-it-works"
              className="btn btn-ghost text-foreground-secondary hover:text-gold"
            >
              See how it works
            </a>
          </div>
        </div>
      </div>

      {/* Draft ticker at bottom */}
      <div className="relative z-10">
        <DraftTicker entries={tickerEntries} />
      </div>
    </section>
  )
}
