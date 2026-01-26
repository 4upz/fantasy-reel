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
      {/* Logo at top */}
      <div className="absolute top-6 left-6 z-20">
        <NavLogo href="/" />
      </div>

      {/* Auth links at top right */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-4">
        <Link
          href="/login"
          className="text-foreground-secondary hover:text-gold transition-colors font-medium"
        >
          Log in
        </Link>
        <Link href="/signup" className="btn btn-primary">
          Sign up
        </Link>
      </div>

      {/* Hero content - centered */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="relative z-10 text-center max-w-3xl mx-auto animate-fade-in">
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-foreground mb-6 tracking-tight leading-tight">
            Your Hot Takes,{' '}
            <span className="text-gold">Finally Worth Something</span>
          </h1>

          <p className="text-lg sm:text-xl md:text-2xl text-foreground-secondary mb-4 leading-relaxed">
            Draft upcoming movies. Outscore your friends when the reviews drop.
          </p>

          <p className="text-base sm:text-lg text-foreground-muted mb-10">
            Finally, a use for your strong opinions about Denis Villeneuve.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup" className="cta-button spotlight-glow">
              Start a League
            </Link>
            <a
              href="#how-it-works"
              className="btn btn-ghost text-foreground-secondary hover:text-gold"
            >
              See How It Works
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
