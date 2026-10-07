import type { Metadata } from 'next'
import BrandLogo from '../components/BrandLogo'

export const metadata: Metadata = { title: 'Sign-in error' }

export default function ErrorPage() {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <div className="flex justify-center mb-4">
            <BrandLogo markOnly className="h-auto w-16" />
          </div>
          <h1 className="type-section text-foreground">
            Something went wrong
          </h1>
          <p className="mt-2 text-foreground-secondary">
            An error occurred during authentication. Please try again.
          </p>
        </div>
        <div>
          <a
            href="/login"
            className="font-medium text-gold hover:text-gold-hover transition-colors"
          >
            Back to login
          </a>
        </div>
      </div>
    </main>
  )
}
