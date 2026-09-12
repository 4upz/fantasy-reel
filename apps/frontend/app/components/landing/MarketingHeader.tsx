import Link from 'next/link'
import { Menu } from 'lucide-react'
import BrandLogo from '../BrandLogo'
import styles from './MarketingHeader.module.css'
import ThemeSelector from '@/components/theme/ThemeSelector'

interface MarketingHeaderProps {
  currentPage?: 'how-to-play'
}

/** @design-system Landing */
export default function MarketingHeader({ currentPage }: MarketingHeaderProps): React.ReactElement {
  return (
    <header className="border-b border-border/50 bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-6 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 shrink-0 items-center rounded-sm" aria-label="Fantasy Reel home">
          <BrandLogo className="h-auto w-32 max-w-full sm:w-44" />
        </Link>
        <div className="ml-auto">
          <ThemeSelector compact />
        </div>
        <nav className="hidden items-center gap-2 md:flex" aria-label="Main navigation">
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
        <div className="flex shrink-0 items-center gap-2 md:hidden">
          <Link href="/signup" className="btn btn-primary min-h-11 px-3 hidden sm:inline-flex">
            Sign up
          </Link>
          <button
            type="button"
            popoverTarget="marketing-mobile-navigation"
            className={`btn btn-ghost min-h-11 min-w-11 px-2 ${styles.menuButton}`}
            aria-label="Navigation menu"
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        </div>
      </div>
      <nav id="marketing-mobile-navigation" popover="auto" className={styles.mobileMenu} aria-label="Mobile navigation">
        <Link href="/signup" className="btn btn-primary min-h-11 px-3 sm:hidden">
          Sign up
        </Link>
        <Link
          href="/how-to-play"
          className="btn btn-ghost min-h-11 justify-end px-3 text-right"
          aria-current={currentPage === 'how-to-play' ? 'page' : undefined}
        >
          How to play
        </Link>
        <Link href="/login" className="btn btn-ghost min-h-11 justify-end px-3 text-right">
          Sign in
        </Link>
      </nav>
    </header>
  )
}
