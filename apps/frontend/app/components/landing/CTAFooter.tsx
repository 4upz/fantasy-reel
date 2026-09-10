import Link from 'next/link'

export default function CTAFooter(): React.ReactElement {
  return (
    <section className="py-24 px-6 bg-surface">
      <div className="max-w-2xl mx-auto">
        <div className="cta-panel p-10 md:p-14 text-center">
          <h2 className="type-section text-foreground mb-4">
            Stop arguing. Start scoring.
          </h2>
          <p className="text-foreground-secondary mb-8">
            Create a league in 30 seconds. Drag your friends into it. Gloat when
            you&apos;re right.
          </p>

          <Link href="/signup" className="cta-button animate-glow-pulse">
            Start a league
          </Link>

          <p className="type-body-sm mt-6 text-foreground-secondary">
            Already have an account?{' '}
            <Link
              href="/login"
              className="text-gold hover:text-gold-hover transition-colors"
            >
              Log in
            </Link>
            {' · '}
            <span className="text-foreground-secondary">Got opinions?</span>{' '}
            <span className="text-foreground">Good.</span>
          </p>
        </div>
      </div>
    </section>
  )
}
