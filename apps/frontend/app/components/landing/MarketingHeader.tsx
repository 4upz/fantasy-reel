import Link from 'next/link'
import BrandLogo from '../BrandLogo'

interface MarketingHeaderProps {
  currentPage?: 'how-to-play'
}

export default function MarketingHeader({ currentPage }: MarketingHeaderProps): React.ReactElement {
  return (
    <header className="border-b border-border/50 bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:gap-6 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 shrink-0 items-center rounded-sm" aria-label="Fantasy Reel home">
          <BrandLogo />
        </Link>
        <nav className="flex w-full items-center justify-between gap-2 sm:w-auto" aria-label="Main navigation">
          <Link
            href="/how-to-play"
            className="btn btn-ghost min-h-11 px-3"
            aria-current={currentPage === 'how-to-play' ? 'page' : undefined}
          >
            How to play
          </Link>
          <Link href="/login" className="btn btn-ghost min-h-11 px-3">
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-primary min-h-11 px-4">
            Sign up
          </Link>
        </nav>
      </div>
    </header>
  )
}
