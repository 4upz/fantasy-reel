import { TechnicalIssue } from '@/app/components/illustrations'

export default function ErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 text-center px-4">
        <div>
          <div className="mb-6">
            <TechnicalIssue size="md" />
          </div>
          <h2 className="text-3xl font-extrabold font-display text-foreground">
            Something went wrong
          </h2>
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
    </div>
  )
}
