import BrandLogo from '../components/BrandLogo'

export default function ErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <div className="flex justify-center mb-4">
            <BrandLogo markOnly className="h-auto w-16" />
          </div>
          <h2 className="type-section text-foreground">
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
