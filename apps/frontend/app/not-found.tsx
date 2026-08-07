import Link from 'next/link'
import { Clapperboard } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card animate-fade-in w-full max-w-md space-y-6 p-8 text-center">
        <div className="flex justify-center">
          <Clapperboard className="h-16 w-16 text-gold" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold text-foreground">
            Page not found
          </h1>
          <p className="text-foreground-secondary">
            The page you&apos;re looking for doesn&apos;t exist or may have been moved.
          </p>
        </div>
        <Link href="/" className="btn btn-primary">
          Back to home
        </Link>
      </div>
    </div>
  )
}
