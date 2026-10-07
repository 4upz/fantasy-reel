import Link from 'next/link'
import { Menu } from 'lucide-react'
import BrandLogo from '../BrandLogo'
import styles from './MarketingHeader.module.css'
import ThemeMenu from '@/components/theme/ThemeMenu'
import ThemeSelector from '@/components/theme/ThemeSelector'
import GitHubIcon from '../icons/GitHubIcon'
import DiscordIcon from '../icons/DiscordIcon'
import { GITHUB_REPO_URL } from '../SocialLinks'
import { DISCORD_GUIDE_HREF } from '@/utils/discordBot'

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
          <Link
            href={DISCORD_GUIDE_HREF}
            className={`btn btn-ghost hidden min-h-11 min-w-11 px-2 md:inline-flex ${styles.menuButton}`}
            aria-label="Fantasy Reel Discord bot"
            title="Fantasy Reel Discord bot"
            data-testid="marketing-discord-bot-link"
          >
            <DiscordIcon className="h-5 w-5" />
          </Link>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn btn-ghost hidden min-h-11 min-w-11 px-2 md:inline-flex ${styles.menuButton}`}
            aria-label="Fantasy Reel on GitHub (opens in a new tab)"
            title="Fantasy Reel on GitHub"
            data-testid="marketing-github-link"
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
          <ThemeMenu className="hidden md:inline-flex" />
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
        <nav className="grid gap-1" aria-label="More navigation">
          <Link href="/login" className="btn btn-ghost min-h-11 justify-start px-2">
            Sign in
          </Link>
          {/* A same-page anchor would scroll under the still-open menu; How to Play links the section itself. */}
          {currentPage !== 'how-to-play' && (
            <Link href={DISCORD_GUIDE_HREF} className="btn btn-ghost min-h-11 justify-start gap-2 px-2">
              <DiscordIcon className="h-4 w-4" />
              Discord bot
            </Link>
          )}
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost min-h-11 justify-start gap-2 px-2"
          >
            <GitHubIcon className="h-4 w-4" />
            GitHub
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
        <div className="mt-3 border-t border-border pt-3">
          <ThemeSelector />
        </div>
      </div>
    </header>
  )
}
