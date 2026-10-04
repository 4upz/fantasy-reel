import TMDbAttribution from '@/components/TMDbAttribution'
import LegalLinks from './LegalLinks'
import SocialLinks from './SocialLinks'

interface Props {
  className?: string
}

/**
 * The footer row shared by the marketing pages and the signed-in app shell, so
 * the two footers cannot drift apart. Each caller keeps its own `<footer>`.
 *
 * Deliberately NOT tagged `@design-system`, for the same reason as SiteFooter:
 * TMDbAttribution's logo is served from public/ and would preview as broken.
 */
export default function SiteFooterContent({ className = '' }: Props): React.ReactElement {
  return (
    <div className={`max-w-7xl mx-auto flex flex-col items-center gap-4 md:flex-row md:justify-between ${className}`}>
      <TMDbAttribution variant="footer" />
      <div className="flex items-center gap-2">
        <LegalLinks />
        <SocialLinks />
      </div>
    </div>
  )
}
