import Link from 'next/link'

/** @design-system Landing */
export default function CTAFooter(): React.ReactElement {
  return (
    <section className="py-24 px-6 bg-surface">
      <div className="max-w-2xl mx-auto">
        <div className="cta-panel p-10 md:p-14 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
            Stop Arguing. Start Scoring.
          </h2>
          <p className="text-foreground-secondary mb-8">
            Create a league in 30 seconds. Drag your friends into it. Gloat when
            you&apos;re right.
          </p>

          <Link href="/signup" className="cta-button animate-glow-pulse">
            Start a League
          </Link>

          <p className="mt-6 text-sm text-foreground-muted">
            Already have an account?{' '}
            <Link
              href="/login"
              className="text-gold hover:text-gold-hover transition-colors"
            >
              Log in
            </Link>
            {' · '}
            <span className="text-foreground-muted">Got opinions?</span>{' '}
            <span className="text-gold">Good.</span>
          </p>
        </div>
      </div>
    </section>
  )
}
