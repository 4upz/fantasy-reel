import Link from 'next/link'
import { ArrowDown } from 'lucide-react'
import NavLogo from '../navigation/NavLogo'

export default function HeroSection(): React.ReactElement {
  return (
    <section className="hero-gradient film-grain relative min-h-screen flex flex-col items-center justify-center px-6">
      {/* Logo at top */}
      <div className="absolute top-6 left-6">
        <NavLogo href="/" />
      </div>

      {/* Auth links at top right */}
      <div className="absolute top-6 right-6 flex items-center gap-4">
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

      {/* Hero content */}
      <div className="relative z-10 text-center max-w-3xl mx-auto animate-fade-in">
        <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-bold text-foreground mb-6 tracking-tight">
          Fantasy Leagues for{' '}
          <span className="text-gold">Film Buffs</span>
        </h1>

        <p className="text-xl md:text-2xl text-foreground-secondary mb-10 leading-relaxed">
          Draft upcoming movies. Score points from critic reviews. Compete with friends.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/signup" className="cta-button spotlight-glow">
            Get Started
          </Link>
          <a
            href="#how-it-works"
            className="btn btn-ghost text-foreground-secondary hover:text-gold"
          >
            Learn How It Works
          </a>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <ArrowDown className="w-6 h-6 text-foreground-muted" />
      </div>
    </section>
  )
}
