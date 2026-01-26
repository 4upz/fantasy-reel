import Link from 'next/link'

export default function CTAFooter(): React.ReactElement {
  return (
    <section className="py-24 px-6 bg-background">
      <div className="max-w-2xl mx-auto">
        <div className="cta-panel p-10 md:p-14 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
            Ready to draft your team?
          </h2>
          <p className="text-foreground-secondary mb-8">
            Join thousands of film fans competing in fantasy movie leagues.
          </p>

          <Link href="/signup" className="cta-button animate-glow-pulse">
            Sign Up Free
          </Link>

          <p className="mt-6 text-sm text-foreground-muted">
            Already have an account?{' '}
            <Link href="/login" className="text-gold hover:text-gold-hover transition-colors">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </section>
  )
}
