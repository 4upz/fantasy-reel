import Link from 'next/link'
import TMDbAttribution from '@/components/TMDbAttribution'
import DiscordIcon from './icons/DiscordIcon'
import LegalLinks from './LegalLinks'
import SocialLinks from './SocialLinks'
import { DISCORD_GUIDE_HREF } from '@/utils/discordBot'

interface Props {
  className?: string
  /** The Discord bot guide: the public How to Play page, or /help inside the app. */
  discordGuideHref?: string
}

/**
 * The footer row shared by the marketing pages and the signed-in app shell, so
 * the two footers cannot drift apart. Each caller keeps its own `<footer>`.
 *
 * Deliberately NOT tagged `@design-system`, for the same reason as SiteFooter:
 * TMDbAttribution's logo is served from public/ and would preview as broken.
 */
export default function SiteFooterContent({
  className = '',
  discordGuideHref = DISCORD_GUIDE_HREF,
}: Props): React.ReactElement {
  return (
    <div className={`max-w-7xl mx-auto flex flex-col items-center gap-4 md:flex-row md:justify-between ${className}`}>
      <TMDbAttribution variant="footer" />
      <div className="flex items-center gap-2">
        <LegalLinks />
        {/* Grouped with the GitHub icon, matching the social-links spacing. */}
        <div className="flex items-center gap-1">
          <Link
            href={discordGuideHref}
            prefetch={false}
            className="social-link"
            aria-label="Fantasy Reel Discord bot"
            title="Fantasy Reel Discord bot"
            data-testid="footer-discord-bot-link"
          >
            <DiscordIcon className="h-5 w-5" />
          </Link>
          <SocialLinks />
        </div>
      </div>
    </div>
  )
}
