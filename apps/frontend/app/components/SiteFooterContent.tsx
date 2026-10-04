import Link from 'next/link'
import TMDbAttribution from '@/components/TMDbAttribution'
import DiscordIcon from './icons/DiscordIcon'
import LegalLinks from './LegalLinks'
import SocialLinks from './SocialLinks'
import { DISCORD_GUIDE_ID } from '@/utils/discordBot'

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
  discordGuideHref = `/how-to-play#${DISCORD_GUIDE_ID}`,
}: Props): React.ReactElement {
  return (
    <div className={`max-w-7xl mx-auto flex flex-col items-center gap-4 md:flex-row md:justify-between ${className}`}>
      <TMDbAttribution variant="footer" />
      <div className="flex flex-wrap items-center justify-center gap-x-1">
        <Link
          href={discordGuideHref}
          prefetch={false}
          className="type-label footer-link"
          data-testid="footer-discord-bot-link"
        >
          <DiscordIcon className="h-4 w-4" />
          Discord bot
        </Link>
        <LegalLinks />
        <SocialLinks />
      </div>
    </div>
  )
}
