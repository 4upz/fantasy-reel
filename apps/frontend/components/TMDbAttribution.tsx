/**
 * TMDb Attribution Component
 *
 * Required attribution for using the TMDb API.
 * Displays the official TMDb logo with required disclaimer text.
 *
 * @see https://www.themoviedb.org/about/logos-attribution
 * @see https://developer.themoviedb.org/docs/faq#what-are-the-attribution-requirements
 *
 * Deliberately NOT tagged `@design-system`: its entire visual is a logo served
 * from the app's public/ dir, which cannot ship in a component bundle, so its
 * preview card would be a broken image in every design built from it.
 */

import Image from 'next/image'

interface Props {
  variant?: 'footer' | 'powered-by'
  className?: string
}

const LOGO_ASPECT_RATIO = 273.42 / 35.52

function TMDbLogo({ size = 'medium' }: { size?: 'medium' | 'large' }) {
  const height = size === 'large' ? 28 : 20
  const width = Math.round(height * LOGO_ASPECT_RATIO)

  return (
    <Image
      src="/images/tmdb-logo.svg"
      alt="TMDB"
      width={width}
      height={height}
      unoptimized
      aria-hidden="true"
    />
  )
}

export default function TMDbAttribution({
  variant = 'footer',
  className = '',
}: Props): React.ReactElement {
  if (variant === 'powered-by') {
    return (
      <div className={`flex flex-col items-center gap-3 ${className}`}>
        <span className="text-xs uppercase tracking-widest text-foreground-muted font-medium">
          Powered by
        </span>
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-opacity hover:opacity-80"
          aria-label="The Movie Database (TMDb)"
        >
          <TMDbLogo size="large" />
        </a>
        <p className="text-xs text-foreground-muted max-w-xs text-center leading-relaxed">
          This product uses the{' '}
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#01b4e4] hover:text-[#90cea1] transition-colors"
          >
            TMDb
          </a>{' '}
          API but is not endorsed or certified by TMDb.
        </p>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <a
        href="https://www.themoviedb.org"
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 transition-opacity hover:opacity-80"
        aria-label="The Movie Database (TMDb)"
      >
        <TMDbLogo size="medium" />
      </a>
      <p className="text-xs text-foreground-muted leading-snug">
        This product uses the{' '}
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#01b4e4] hover:text-[#90cea1] transition-colors"
        >
          TMDb
        </a>{' '}
        API but is not endorsed or certified by TMDb.
      </p>
    </div>
  )
}
