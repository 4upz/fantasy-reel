import TMDbAttribution from '@/components/TMDbAttribution'
import LegalLinks from '../LegalLinks'
import SocialLinks from '../SocialLinks'

/**
 * Deliberately NOT tagged `@design-system`: a thin wrapper around
 * TMDbAttribution, so it inherits the same public/-served logo problem and
 * would preview as a broken image.
 */
export default function SiteFooter(): React.ReactElement {
  return (
    <footer className="py-8 px-6 bg-background border-t border-border">
      <div className="max-w-7xl mx-auto flex flex-col items-center gap-4 md:flex-row md:justify-between">
        <TMDbAttribution variant="footer" />
        <div className="flex items-center gap-2">
          <LegalLinks />
          <SocialLinks />
        </div>
      </div>
    </footer>
  )
}
