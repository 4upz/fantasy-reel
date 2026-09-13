import Link from 'next/link'
import { Menu, SunMoon } from 'lucide-react'
import BrandLogo from '../BrandLogo'
import styles from './MarketingHeader.module.css'
import ThemeSelector from '@/components/theme/ThemeSelector'

interface MarketingHeaderProps {
  currentPage?: 'how-to-play'
  transparent?: boolean
}

/** @design-system Landing */
export default function MarketingHeader({ currentPage, transparent = false }: MarketingHeaderProps): React.ReactElement {
  return (
    <header className={transparent ? 'bg-transparent' : 'border-b border-border/50 bg-background'}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 md:gap-6 md:py-4">
        <Link href="/" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm" aria-label="Fantasy Reel home">
          <span className="md:hidden"><BrandLogo markOnly className="h-auto w-8" /></span>
          <span className="hidden md:inline-flex"><BrandLogo className="h-auto w-44" /></span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
          <Link
            href="/how-to-play"
            className="btn btn-ghost min-h-11 px-2 md:px-3"
            aria-current={currentPage === 'how-to-play' ? 'page' : undefined}
          >
            How to play
          </Link>
          <Link href="/login" className="btn btn-ghost hidden min-h-11 px-3 md:inline-flex">
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-primary min-h-11 px-3 md:px-4">
            Sign up
          </Link>
          <button
            type="button"
            popoverTarget="marketing-menu"
            className={`btn btn-ghost hidden min-h-11 min-w-11 px-2 md:inline-flex ${styles.menuButton}`}
            aria-label="Change theme"
            title="Change theme"
            data-testid="marketing-theme-button"
          >
            <SunMoon size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            popoverTarget="marketing-menu"
            className={`btn btn-ghost min-h-11 min-w-11 px-2 md:hidden ${styles.menuButton}`}
            aria-label="Navigation menu"
            data-testid="marketing-menu-button"
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        </nav>
      </div>
      <div id="marketing-menu" popover="auto" className={styles.menu}>
        <nav className="grid gap-1 md:hidden" aria-label="More navigation">
          <Link href="/login" className="btn btn-ghost min-h-11 justify-start px-2">
            Sign in
          </Link>
        </nav>
        <div className="mt-3 border-t border-border pt-3 md:mt-0 md:border-t-0 md:pt-0">
          <ThemeSelector />
        </div>
      </div>
    </header>
  )
}
